"""文件上传：把 txt/md/csv/json/pdf 等附件存盘并在上传时抽取正文，供聊天注入上下文。"""

import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
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
ALLOWED_EXTS = TEXT_EXTS | PDF_EXTS
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
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    name = file.filename or "unnamed"
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(
            400,
            f"不支持的文件类型 {ext or '(无扩展名)'}，支持：txt/md/csv/json/log/py/js/ts/html/pdf",
        )
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(400, f"文件超过 {MAX_BYTES // 1024 // 1024}MB 限制")

    user_dir = UPLOAD_ROOT / f"u{current_user.id}"
    user_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{ext}"
    stored_path = user_dir / stored_name
    stored_path.write_bytes(data)

    content = _extract_text(data, ext)
    if len(content) > MAX_CONTENT_CHARS:
        content = content[:MAX_CONTENT_CHARS] + "\n…（内容过长已截断）"

    item = FileItem(
        user_id=current_user.id,
        filename=name,
        stored_path=str(stored_path.relative_to(UPLOAD_ROOT.parent)),
        size=len(data),
        content=content,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
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
