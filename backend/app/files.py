"""文件上传：附件存盘 + 上传即建知识库索引，供问答与 RAG 检索使用。

支持的类型：
  文本类  .txt/.md/.markdown/.csv/.json/.log/.py/.js/.ts/.html（直接读取正文）
  文档类  .pdf（抽取文字）
  图片类  .png/.jpg/.jpeg/.webp/.gif/.bmp（不抽正文，交给多模态模型直接看图）

上限：单文件 ≤ 8MB；抽取的正文截断到 200000 字符（防爆上下文）。
上传成功后会调用 rag.index_file() 建立向量索引（图片除外）；索引失败不影响上传本身。
"""

import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import FileItem
from app.schemas import FileDetail, FileOut

router = APIRouter(prefix="/api/files", tags=["files"])

# backend/uploads/<user_id>/...
UPLOAD_ROOT = Path(__file__).resolve().parent.parent / "uploads"

TEXT_EXTS = {".txt", ".md", ".markdown", ".csv", ".json", ".log", ".py", ".js", ".ts", ".html"}
PDF_EXTS = {".pdf"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}  # 图片交给多模态模型直接看
ALLOWED_EXTS = TEXT_EXTS | PDF_EXTS | IMAGE_EXTS
MAX_BYTES = 8 * 1024 * 1024  # 8MB
MAX_CONTENT_CHARS = 200_000  # 注入上下文的正文上限，防止爆 context

_TEXT_PREFIX = re.compile(rb"^(\xef\xbb\xbf|\xff\xfe|\xfe\xff)?")


def _extract_text(data: bytes, ext: str) -> str:
    """抽取正文；pdf 用 pypdf（可选），其余按文本读取。"""
    if ext in PDF_EXTS:
        try:
            from pypdf import PdfReader
        except ImportError:
            return "（PDF 解析库 pypdf 未安装，无法读取内容；请转存为 txt/md 后上传）"
        try:
            import io

            reader = PdfReader(io.BytesIO(data))
            text = "\n".join((page.extract_text() or "") for page in reader.pages)
            return text or "（PDF 未提取到文本，可能是扫描件）"
        except Exception as e:
            return f"（PDF 解析失败：{e}）"
    try:
        text = data.decode("utf-8", errors="replace").lstrip("\ufeff")
    except Exception:
        text = data.decode("latin-1", errors="replace")
    return text


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
        raise HTTPException(
            400,
            f"不支持的文件类型 {ext or '(无扩展名)'}，支持：txt/md/csv/json/log/py/js/ts/html/pdf/png/jpg/jpeg/webp/gif/bmp",
        )
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(400, f"文件超过 {MAX_BYTES // 1024 // 1024}MB 限制")

    user_dir = UPLOAD_ROOT / f"u{current_user.id}"
    user_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{ext}"
    stored_path = user_dir / stored_name
    stored_path.write_bytes(data)

    if ext in IMAGE_EXTS:
        content = ""  # 图片不抽正文，交给多模态模型直接看图
    else:
        content = _extract_text(data, ext)
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

    # 上传即建立 RAG 索引（切分+向量化）。图片不进库；失败不影响上传本身
    if ext not in IMAGE_EXTS:
        try:
            from app.rag import index_file

            index_file(current_user.id, item.id, content, collection_id)
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
