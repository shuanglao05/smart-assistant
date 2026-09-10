"""会话（Conversation）路由：列表 / 新建 / 历史消息 / 改名 / 删除 / 切换设定。

- PATCH 可改：标题、provider+model（切换本会话用的大模型）、启用技能（active_skill_ids）、
  参与检索的知识库（active_kb_ids）；
- 拉取历史消息时把 Message.ref_file_ids 还原成 ref_files（附件 id + 文件名 + 大小），
  并把每条助手回答的 provider/model 一并返回（前端在回答下方标注"这段是哪个模型答的"）；
- 删除会话时同步清理该会话缓存的 Agent 与共享记忆里的历史（避免内存泄漏）。
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import config
from app.agent_manager import clear_conversation_memory, evict_agent
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
            MessageOut(
                role=m.role,
                content=m.content,
                created_at=m.created_at,
                ref_files=ref_files,
                provider=m.provider,
                model=m.model,
            )
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
    if payload.active_kb_ids is not None:
        conv.active_kb_ids = payload.active_kb_ids
        evict_agent(session_id)  # 知识库选择变化：清缓存，下次按新库重建
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
    evict_agent(session_id)  # 清理该会话缓存的 Agent
    clear_conversation_memory(session_id)  # 清掉共享记忆里该会话的历史，避免泄漏
    return {"status": "deleted"}
