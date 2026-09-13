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

# 上传文件根目录：backend/data/uploads/<u{user_id}>/...
# （统一放 data/ 下便于管理；stored_path 存相对 data/ 的路径，如 uploads/u1/xxx）
UPLOAD_ROOT = config.DATA_UPLOADS

TEXT_EXTS = {".txt", ".md", ".markdown", ".csv", ".json", ".log", ".py", ".js", ".ts", ".html"}
PDF_EXTS = {".pdf"}
DOCX_EXTS = {".docx"}  # .doc（老格式）不支持，提示用户另存为 .docx
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}  # 图片交给多模态模型直接看
ALLOWED_EXTS = TEXT_EXTS | PDF_EXTS | DOCX_EXTS | IMAGE_EXTS
MAX_BYTES = config.MAX_UPLOAD_MB * 1024 * 1024
MAX_CONTENT_CHARS = config.MAX_CONTENT_CHARS

_TEXT_PREFIX = re.compile(rb"^(\xef\xbb\xbf|\xff\xfe|\xfe\xff)?")

# PDF 清洗用：判断一行是否像「新的结构块起点」（章节/条款/编号列表）。
# 命中则说明它与上一行不是同一段，应另起一段 —— 与 rag._HEADING_RE 保持同一套特征。
_PDF_HEADING_RE = re.compile(
    r"^(?:"
    r"第[一二三四五六七八九十百千零〇\d]+[章节条款部分篇]"
    r"|[一二三四五六七八九十]+[、．.]"
    r"|（[一二三四五六七八九十\d]+）"
    r"|\([一二三四五六七八九十\d]+\)"
    r"|\d+(?:\.\d+)*[、．.]?\s"
    r"|附\s*录"
    r"|#{1,6}\s"
    r")"
)


def _looks_like_heading(line: str) -> bool:
    """整行是否"短得像个标题"。必须限长，否则 '第一条 为了维护……' 这类
    条文正文也会以 '第一条' 命中特征，被误判成标题而截断句子。"""
    s = line.strip()
    return bool(s) and len(s) <= 30 and bool(_PDF_HEADING_RE.match(s))

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


def _clean_pdf_text(raw: str) -> str:
    """归一化 pypdf 抽出的正文，把「版式换行」还原成「语义段落」。

    为什么必须清洗：pypdf 按页面视觉排版抽文字，一行到了纸张右边缘就换行，
    于是一句话常被拆成两三行。这会带来两个连锁问题：
      ① 分片器找断点时优先命中这些"假换行"，把句子切碎；
      ② 段落结构丢失，检索出来的片段看不出上下文关系。

    中文与英文的判定规则不同（实测两者换行特征相反）：
      - 中文行末若无标点 → 几乎必然是版式换行，接回下一行；
      - 英文行末若无标点 → 是常态（word wrap），同样接回，但用空格连接；
      - 中文行末若已是句末标点、且下一行以引号/编号/标题开头 → 断段。
    合并后段落之间用空行分隔，正好对接 split_text 的段落优先切分。
    """
    if not raw:
        return ""
    # 统一换行符与全角空格
    text = raw.replace("\r\n", "\n").replace("\r", "\n").replace("\u3000", " ")
    # 去掉页眉页脚常见的"第 N 页 / - N -"，它们会污染分片
    text = re.sub(r"^\s*[-—－]?\s*\d+\s*[-—－]?\s*$", "", text, flags=re.MULTILINE)
    text = re.sub(
        r"^\s*第\s*\d+\s*页(?:\s*/\s*共\s*\d+\s*页)?\s*$", "", text, flags=re.MULTILINE
    )
    text = re.sub(r"^\s*Page\s+\d+(?:\s+of\s+\d+)?\s*$", "", text, flags=re.MULTILINE | re.IGNORECASE)

    lines = [ln.rstrip() for ln in text.split("\n")]

    # ① 英文断词合并：行尾 "-" 且下一行以小写字母开头 → 去掉连字符直接接
    merged: list[str] = []
    i = 0
    while i < len(lines):
        cur = lines[i]
        if cur.endswith("-") and i + 1 < len(lines) and re.match(r"^[a-z]", lines[i + 1].lstrip()):
            lines[i] = cur[:-1] + lines[i + 1].lstrip()
            del lines[i + 1]
            continue
        merged.append(cur)
        i += 1

    # ② 逐行判断是否与上一行属于同一段
    paras: list[str] = []
    for line in merged:
        s = line.strip()
        if not s:
            if paras and paras[-1] != "":
                paras.append("")  # 保留空行为段落分隔
            continue
        if not paras or paras[-1] == "":
            paras.append(s)
            continue

        prev = paras[-1]
        prev_tail = prev[-1]
        # 2a 上一行是短标题（章节/条款/编号）→ 标题独立成段
        if _looks_like_heading(prev):
            paras.append(s)
            continue
        # 2b 本行是短标题 → 独立成段
        if _looks_like_heading(s):
            paras.append(s)
            continue
        # 2c 上一行以"明显未结束"的字符收尾 → 同一段（中英文都适用）
        if prev_tail in "，,、：:（(【[《\u201c\u2018;；—-–":
            paras[-1] = _join_lines(prev, s)
            continue
        # 2d 上一行已完整收句，且本行以引号/括号/大写英文词开头 → 断段
        if prev_tail in "。！？!?…\u201d\u300d\u300f）)】]》.":
            paras.append(s)
            continue
        # 2e 其余（典型：英文行末无标点的 word wrap；中文行末无标点的版式换行）
        #    → 接回同一段
        paras[-1] = _join_lines(prev, s)
    return "\n".join(paras).strip()


def _join_lines(prev: str, nxt: str) -> str:
    """拼接被版式换行断开的两行。

    - 英文/数字之间补空格（word wrap 语义）；
    - 中文与中文直接相接（版式换行不含空格）；
    - 中文与英文交界处，判断是否本就需要空格（如 "…law,and" 这种
      英文标点后的续写 → 补空格；"第 3 章" 这种 → 保持原样）。
    """
    if not prev:
        return nxt
    a, b = prev[-1], nxt[0]
    # 英文标点后接英文字母：补空格（"law,and" → "law, and"）
    if a in ",;:." and b.isascii() and b.isalnum():
        return prev + " " + nxt
    ascii_a = a.isascii() and a.isalnum()
    ascii_b = b.isascii() and b.isalnum()
    if ascii_a and ascii_b:
        return prev + " " + nxt
    return prev + nxt


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
            if not text.strip():
                return "（PDF 未提取到文本，可能是扫描件；可先用 OCR 转成文本再上传）"
            # PDF 的版式换行必须清洗，否则一句话被拆成多行、分片会随之碎片化
            return _clean_pdf_text(text)
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
