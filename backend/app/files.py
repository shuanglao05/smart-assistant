"""文件上传：附件存盘 + 上传即建知识库索引，供问答与 RAG 检索使用。

支持的类型：
  文本类  .txt/.md/.markdown/.csv/.json/.log/.py/.js/.ts/.html（直接读取正文）
  文档类  .pdf（pypdf 抽取文字）、.docx（标准库 zip+XML 提取，零新增依赖）
  图片类  .png/.jpg/.jpeg/.webp/.gif/.bmp（不抽正文，交给多模态模型直接看图）

上限：单文件 ≤ config.MAX_UPLOAD_MB（默认 50MB，可在 .env 调整）；
抽取正文截断到 config.MAX_CONTENT_CHARS（默认 50 万字符，防爆上下文）。
上传成功后会调用 rag.index_file() 建立向量索引（图片除外）；索引失败不影响上传本身。
"""

import io
import re
import uuid
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import config
from app.database import get_db
from app.deps import get_current_user
from app.models import FileItem
from app.schemas import FileDetail, FileOut

router = APIRouter(prefix="/api/files", tags=["files"])

# backend/uploads/<user_id>/...
UPLOAD_ROOT = Path(__file__).resolve().parent.parent / "uploads"

TEXT_EXTS = {".txt", ".md", ".markdown", ".csv", ".json", ".log", ".py", ".js", ".ts", ".html"}
PDF_EXTS = {".pdf"}
DOCX_EXTS = {".docx"}  # .doc（老格式）不支持，提示用户另存为 .docx
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}  # 图片交给多模态模型直接看
ALLOWED_EXTS = TEXT_EXTS | PDF_EXTS | DOCX_EXTS | IMAGE_EXTS
MAX_BYTES = config.MAX_UPLOAD_MB * 1024 * 1024
MAX_CONTENT_CHARS = config.MAX_CONTENT_CHARS

_TEXT_PREFIX = re.compile(rb"^(\xef\xbb\xbf|\xff\xfe|\xfe\xff)?")

# 供前端展示的说明文案（保证与后端实际限制一致，不靠前端硬编码）
_TYPE_GROUPS = [
    {"label": "PDF 文档", "exts": sorted(PDF_EXTS)},
    {"label": "Word 文档", "exts": sorted(DOCX_EXTS)},
    {"label": "文本 / 代码", "exts": sorted(TEXT_EXTS)},
    {"label": "图片（交给视觉模型）", "exts": sorted(IMAGE_EXTS)},
]


def _extract_docx(data: bytes) -> str:
    """从 .docx 提取正文（零新增依赖：docx 本质是 zip 包 + WordprocessingML）。

    只读 word/document.xml 里的 <w:p> 段落与 <w:t> 文本节点，
    表格单元格内的段落同样会被遍历到。解析失败返回可读的说明文字。
    """
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            xml = z.read("word/document.xml")
    except Exception as e:
        return f"（Word 文档解析失败：{e}）"
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    try:
        root = ET.fromstring(xml)
    except Exception as e:
        return f"（Word 文档解析失败：{e}）"
    paras: list[str] = []
    for p in root.iter(f"{ns}p"):
        paras.append("".join(t.text or "" for t in p.iter(f"{ns}t")))
    text = "\n".join(paras).strip()
    return text or "（Word 文档未提取到文本，可能是空文档）"


def _extract_text(data: bytes, ext: str) -> str:
    """抽取正文；pdf 用 pypdf、docx 用标准库，其余按文本读取。"""
    if ext in PDF_EXTS:
        try:
            from pypdf import PdfReader
        except ImportError:
            return "（PDF 解析库 pypdf 未安装，无法读取内容；请转存为 txt/md 后上传）"
        try:
            reader = PdfReader(io.BytesIO(data))
            text = "\n".join((page.extract_text() or "") for page in reader.pages)
            return text or "（PDF 未提取到文本，可能是扫描件；可先用 OCR 转成文本再上传）"
        except Exception as e:
            return f"（PDF 解析失败：{e}）"
    if ext in DOCX_EXTS:
        return _extract_docx(data)
    try:
        text = data.decode("utf-8", errors="replace").lstrip("\ufeff")
    except Exception:
        text = data.decode("latin-1", errors="replace")
    return text


@router.get("/limits")
def get_limits(_current_user=Depends(get_current_user)):
    """返回上传限制说明，供前端展示（避免前后端各写一份导致不一致）。"""
    return {
        "max_mb": config.MAX_UPLOAD_MB,
        "max_content_chars": config.MAX_CONTENT_CHARS,
        "groups": _TYPE_GROUPS,
        "all_exts": sorted(ALLOWED_EXTS),
        "top_k": config.RAG_TOP_K,
        "chunk_size": config.RAG_CHUNK_SIZE,
        "chunk_overlap": config.RAG_CHUNK_OVERLAP,
    }


@router.post("", response_model=FileOut)
async def upload_file(
    file: UploadFile,
    collection_id: int | None = Form(None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    name = file.filename or "unnamed"
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_EXTS:
        if ext == ".doc":
            raise HTTPException(400, "暂不支持旧版 .doc，请在 Word 中另存为 .docx 后再上传")
        raise HTTPException(
            400,
            f"不支持的文件类型 {ext or '(无扩展名)'}。支持："
            "PDF、Word(.docx)、txt/md/csv/json/log/py/js/ts/html、图片(png/jpg/jpeg/webp/gif/bmp)",
        )

    # 先看声明的大小：超限直接拒绝，避免把大文件整个读进内存
    if file.size is not None and file.size > MAX_BYTES:
        raise HTTPException(
            400, f"文件 {file.size / 1024 / 1024:.1f}MB 超过 {config.MAX_UPLOAD_MB}MB 限制"
        )

    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(
            400, f"文件 {len(data) / 1024 / 1024:.1f}MB 超过 {config.MAX_UPLOAD_MB}MB 限制"
        )

    user_dir = UPLOAD_ROOT / f"u{current_user.id}"
    user_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{ext}"
    stored_path = user_dir / stored_name
    stored_path.write_bytes(data)

    if ext in IMAGE_EXTS:
        content = ""  # 图片不抽正文，交给多模态模型直接看图
    else:
        # 解析放线程池：长 PDF / 大 Word 很吃 CPU，不能阻塞事件循环（否则整个服务卡住）
        content = await run_in_threadpool(_extract_text, data, ext)
        if len(content) > MAX_CONTENT_CHARS:
            content = content[:MAX_CONTENT_CHARS] + "\n…（内容过长已截断）"

    item = FileItem(
        user_id=current_user.id,
        collection_id=collection_id,
        filename=name,
        stored_path=str(stored_path.relative_to(UPLOAD_ROOT.parent)),
        size=len(data),
        content=content,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    # 上传即建立 RAG 索引（切分+向量化）。图片不进库；失败不影响上传本身。
    # 同样放线程池：长文档要切几百上千段并逐批向量化，同步跑会把事件循环堵住。
    if ext not in IMAGE_EXTS:
        try:
            from app.rag import index_file

            await run_in_threadpool(index_file, current_user.id, item.id, content, collection_id)
        except Exception:
            pass

    return item


@router.get("", response_model=list[FileOut])
def list_files(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(FileItem)
        .filter(FileItem.user_id == current_user.id)
        .order_by(FileItem.created_at.desc())
        .limit(50)
        .all()
    )


@router.get("/{file_id}", response_model=FileDetail)
def get_file(
    file_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """文档详情：返回文件名、大小、时间与抽取的正文，供前端在右侧面板中查看。"""
    item = (
        db.query(FileItem)
        .filter(FileItem.id == file_id, FileItem.user_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(404, "文档不存在或无权访问")
    return item


@router.post("/{file_id}/reindex", response_model=FileOut)
def reindex_file(
    file_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """对已上传的文档重建知识库索引（用于 RAG 上线前上传的老文件）。"""
    item = (
        db.query(FileItem)
        .filter(FileItem.id == file_id, FileItem.user_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(404, "文档不存在或无权访问")
    try:
        from app.rag import index_file

        n = index_file(current_user.id, item.id, item.content or "", item.collection_id)
    except Exception as e:
        raise HTTPException(500, f"索引失败：{e}")
    if n == 0:
        raise HTTPException(400, "该文档没有可索引的正文（可能是扫描版 PDF）")
    return item


@router.delete("/{file_id}")
def delete_file(
    file_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除文档：同时清理知识库片段与磁盘上的原始文件。"""
    item = (
        db.query(FileItem)
        .filter(FileItem.id == file_id, FileItem.user_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(404, "文档不存在或无权访问")

    # 先清理该文档的知识库片段（失败不阻塞删除）
    try:
        from app.rag import drop_file

        drop_file(current_user.id, item.id)
    except Exception:
        pass

    # 删除磁盘文件（stored_path 形如 uploads/u1/xxx.md，相对 backend 目录）
    try:
        path = UPLOAD_ROOT.parent / item.stored_path
        if path.exists():
            path.unlink()
    except Exception:
        pass

    db.delete(item)
    db.commit()
    return {"ok": True}
