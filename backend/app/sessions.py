"""会话 CRUD 路由：列表 / 新建 / 历史消息 / 删除。"""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import config
from app.agent_manager import evict_agent
from app.database import get_db
from app.deps import get_current_user
from app.models import Conversation, FileItem, Message
from app.schemas import MessageOut, RefFile, SessionCreate, SessionOut, SessionUpdate


def _evict_if_skills_changed(session_id: int):
    """会话启用技能变化后，清掉该会话缓存的 Agent，下次发言按新技能重建。"""
    evict_agent(session_id)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def get_owned_conversation(db: Session, session_id: int, user_id: int) -> Conversation:
    """归属校验：查不到就 404，防止越权访问他人会话。"""
    conv = (
        db.query(Conversation)
        .filter(Conversation.id == session_id, Conversation.user_id == user_id)
        .first()
    )
    if not conv:
        raise HTTPException(404, "会话不存在")
    return conv


@router.get("", response_model=list[SessionOut])
def list_sessions(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(Conversation)
        .filter(Conversation.user_id == current_user.id)
        .order_by(Conversation.updated_at.desc())
        .all()
    )


@router.post("", response_model=SessionOut)
def create_session(
    payload: SessionCreate | None = None,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    title = (payload.title if payload and payload.title else None) or "新对话"
    conv = Conversation(user_id=current_user.id, title=title)
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


@router.get("/{session_id}/messages", response_model=list[MessageOut])
def get_messages(
    session_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_conversation(db, session_id, current_user.id)
    msgs = (
        db.query(Message)
        .filter(Message.conversation_id == session_id)
        .order_by(Message.created_at.asc())
        .all()
    )
    result: list[MessageOut] = []
    for m in msgs:
        ref_files: list[RefFile] = []
        if m.role == "user" and m.ref_file_ids:
            try:
                ids = [int(x) for x in json.loads(m.ref_file_ids) if str(x).isdigit()]
            except (ValueError, TypeError):
                ids = []
            if ids:
                files = (
                    db.query(FileItem)
                    .filter(FileItem.id.in_(ids), FileItem.user_id == current_user.id)
                    .all()
                )
                ref_files = [RefFile(id=f.id, filename=f.filename, size=f.size) for f in files]
        result.append(
            MessageOut(role=m.role, content=m.content, created_at=m.created_at, ref_files=ref_files)
        )
    return result


@router.patch("/{session_id}", response_model=SessionOut)
def update_session(
    session_id: int,
    payload: SessionUpdate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """切换会话使用的模型 / 标题。仅本人会话可改。"""
    conv = get_owned_conversation(db, session_id, current_user.id)
    if payload.title is not None:
        conv.title = payload.title
    if payload.provider is not None:
        p = payload.provider.strip().lower()
        if p not in ("ollama", "cloud"):
            raise HTTPException(400, "不支持的模型提供方")
        if p == "cloud" and not (config.CLOUD_API_KEY and config.CLOUD_BASE_URL):
            raise HTTPException(400, "云端模型未配置：请在 backend/.env 设置 CLOUD_API_KEY 与 CLOUD_BASE_URL")
        conv.provider = p
        conv.model = payload.model or (config.OLLAMA_MODEL if p == "ollama" else config.CLOUD_MODEL)
    elif payload.model is not None:
        conv.model = payload.model
    if payload.active_skill_ids is not None:
        conv.active_skill_ids = payload.active_skill_ids
        _evict_if_skills_changed(session_id)
    db.commit()
    db.refresh(conv)
    return conv


@router.delete("/{session_id}")
def delete_session(
    session_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conv = get_owned_conversation(db, session_id, current_user.id)
    db.query(Message).filter(Message.conversation_id == session_id).delete()
    db.delete(conv)
    db.commit()
    evict_agent(session_id)  # 同步清理 Agent 内存记忆
    return {"status": "deleted"}
