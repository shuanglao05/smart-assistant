"""智能笔记 API：按天归档笔记的增删改查，外加一键让 AI 归纳某天的笔记。

- 给人用的 REST 接口（前端笔记页面）；
- 数据落在 notes 表，按 user_id 隔离；
- /summarize 会调用当前配置的大模型，把某天的若干条笔记浓缩成要点。
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import config
from app.agent_manager import build_llm
from app.database import get_db
from app.deps import get_current_user
from app.models import Note
from app.schemas import NoteCreate, NoteOut, NoteSummarizeRequest, NoteUpdate

router = APIRouter(prefix="/api/notes", tags=["notes"])


def _today() -> str:
    return date.today().isoformat()


def _get_owned(db: Session, note_id: int, user_id: int) -> Note:
    note = db.query(Note).filter(Note.id == note_id, Note.user_id == user_id).first()
    if not note:
        raise HTTPException(404, "笔记不存在")
    return note


@router.get("", response_model=list[NoteOut])
def list_notes(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(Note)
        .filter(Note.user_id == current_user.id)
        .order_by(Note.day.desc(), Note.updated_at.desc())
        .all()
    )


@router.post("", response_model=NoteOut)
def create_note(
    payload: NoteCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    note = Note(
        user_id=current_user.id,
        title=(payload.title or "").strip(),
        content=payload.content or "",
        day=(payload.day or _today()).strip(),
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


@router.patch("/{note_id}", response_model=NoteOut)
def update_note(
    note_id: int,
    payload: NoteUpdate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    note = _get_owned(db, note_id, current_user.id)
    if payload.title is not None:
        note.title = payload.title.strip()
    if payload.content is not None:
        note.content = payload.content
    if payload.day is not None and payload.day.strip():
        note.day = payload.day.strip()
    db.commit()
    db.refresh(note)
    return note


@router.delete("/{note_id}")
def delete_note(
    note_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    note = _get_owned(db, note_id, current_user.id)
    db.delete(note)
    db.commit()
    return {"status": "deleted"}


@router.post("/summarize")
def summarize_notes(
    payload: NoteSummarizeRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """让当前大模型把某天的笔记归纳成一段要点。"""
    notes = (
        db.query(Note)
        .filter(Note.user_id == current_user.id, Note.day == payload.day)
        .order_by(Note.created_at.asc())
        .all()
    )
    if not notes:
        raise HTTPException(400, "这一天还没有笔记")
    joined = "\n\n".join(
        f"- {n.title}：{n.content}".strip() for n in notes
    )
    prompt = (
        f"请把下面这些《{payload.day}》的笔记归纳成 3~6 条要点，用简洁的中文，"
        f"可以用 Markdown 列表：\n\n{joined}"
    )
    try:
        llm = build_llm(payload.provider or config.LLM_PROVIDER, payload.model)
        resp = llm.invoke([{"role": "user", "content": prompt}])
        text = resp.content if isinstance(resp.content, str) else str(resp.content)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"AI 归纳失败：{e}")
    return {"day": payload.day, "summary": text, "count": len(notes)}
