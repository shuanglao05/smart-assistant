"""聊天路由：核心接口 POST /api/chat（非流式）与 POST /api/chat/stream（SSE 流式）。

支持：
- regenerate=true：不新增用户消息，删掉最后一个问题之后的 assistant 回答，重新生成；
- file_ids=[...]：把该用户已上传附件（files 表）的正文拼进给模型的消息（不落库，一问一答注入）。
"""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessageChunk
from sqlalchemy.orm import Session

from app.agent_manager import get_agent_for_conversation
from app.database import get_db
from app.deps import get_current_user
from app.models import Conversation, FileItem, Message
from app.schemas import ChatRequest, ChatResponse

router = APIRouter(prefix="/api", tags=["chat"])


def _attachment_context(db: Session, user_id: int, file_ids: list[int] | None) -> str:
    """把附件正文拼成注入文本；文件必须属于当前用户。"""
    if not file_ids:
        return ""
    files = (
        db.query(FileItem)
        .filter(FileItem.id.in_(file_ids), FileItem.user_id == user_id)
        .all()
    )
    blocks = []
    for f in files:
        text = (f.content or "").strip()
        if text:
            blocks.append(f"[附件：{f.filename}]\n{text}")
        else:
            blocks.append(f"[附件：{f.filename}]（无内容可读取）")
    if not blocks:
        return ""
    return "\n\n".join(blocks) + "\n\n"


def _prepare_conversation(
    db: Session, user_id: int, conv: Conversation, payload: ChatRequest
) -> str:
    """写用户消息 / 处理 regenerate，返回要交给模型的问题原文。"""
    msg_count = db.query(Message).filter(Message.conversation_id == conv.id).count()

    if payload.regenerate:
        last_user = (
            db.query(Message)
            .filter(Message.conversation_id == conv.id, Message.role == "user")
            .order_by(Message.id.desc())
            .first()
        )
        if not last_user:
            raise HTTPException(400, "没有可重新生成的问题")
        # 删掉最后一个问题之后的所有 assistant 回答（可能多条/半截）
        db.query(Message).filter(
            Message.conversation_id == conv.id,
            Message.role == "assistant",
            Message.id > last_user.id,
        ).delete(synchronize_session=False)
        return last_user.content

    text = (payload.message or "").strip()
    if not text:
        raise HTTPException(400, "消息不能为空")
    ref_ids = payload.file_ids or []
    db.add(
        Message(
            conversation_id=conv.id,
            role="user",
            content=text,
            ref_file_ids=json.dumps(ref_ids) if ref_ids else None,
        )
    )
    if msg_count == 0 and conv.title == "新对话":
        conv.title = text[:20]
    return text


@router.post("/chat", response_model=ChatResponse)
def chat(
    payload: ChatRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conv = (
        db.query(Conversation)
        .filter(
            Conversation.id == payload.session_id,
            Conversation.user_id == current_user.id,
        )
        .first()
    )
    if not conv:
        raise HTTPException(404, "会话不存在")

    question = _prepare_conversation(db, current_user.id, conv, payload)
    conv.updated_at = datetime.now(timezone.utc)
    db.commit()

    context = _attachment_context(db, current_user.id, payload.file_ids)
    agent_input = f"{context}{question}" if context else question

    # 拿到这个会话对应的 ReAct 智能体（带 MemorySaver 记忆）
    agent = get_agent_for_conversation(conv.id, current_user.id, provider=conv.provider, model=conv.model)
    try:
        # agent.invoke：一次性跑完整个"思考→调工具→再思考→回答"循环，返回最终结果。
        #   {"messages": [("user", agent_input)]}  —— 这就是喂给模型的"用户消息"。
        #   config 里的 thread_id 是 LangGraph 记忆的"身份证"：相同 thread_id 的多次调用
        #   会共享同一段对话历史（MemorySaver 存的就是它），所以多轮对话能接得上。
        #   这里用会话 id 当 thread_id，天然实现"每个会话各记各的"。
        result = agent.invoke(
            {"messages": [("user", agent_input)]},
            config={"configurable": {"thread_id": str(conv.id)}},
        )
        # 结果里 messages 是完整消息链，最后一条就是模型的最终回答
        reply = result["messages"][-1].content
        if not reply:
            reply = "（模型没有返回内容，请重试或检查 Ollama 服务状态）"
    except Exception as e:
        reply = f"出错了: {e}"

    db.add(Message(conversation_id=conv.id, role="assistant", content=reply))
    conv.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {"reply": reply}


@router.post("/chat/stream")
def chat_stream(
    payload: ChatRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """流式版本：逐 token 推送给前端，实现打字机效果。

    前端用 fetch POST 读取 text/event-stream，每个事件为
    `data: {"token": "..."}`（增量文本）或 `data: {"done": true}`（结束）。
    """
    conv = (
        db.query(Conversation)
        .filter(
            Conversation.id == payload.session_id,
            Conversation.user_id == current_user.id,
        )
        .first()
    )
    if not conv:
        raise HTTPException(404, "会话不存在")

    # regenerate / 普通提问：在此阶段完成落库与校验（HTTPException 才能正确返回）
    question = _prepare_conversation(db, current_user.id, conv, payload)
    context = _attachment_context(db, current_user.id, payload.file_ids)
    agent_input = f"{context}{question}" if context else question
    conv.updated_at = datetime.now(timezone.utc)
    db.commit()

    # 拿到这个会话对应的 ReAct 智能体（与上面非流式版本共用同一个记忆）
    agent = get_agent_for_conversation(conv.id, current_user.id, provider=conv.provider, model=conv.model)

    def gen():
        """生成器函数：被 StreamingResponse 逐段取出，形成 SSE 流式推送。"""
        full: list[str] = []
        try:
            # agent.stream：和 invoke 一样跑完整循环，但不等全部结束，而是每产生一点
            # 模型文本就 yield 出来，前端就能实现"打字机"逐字显示。
            #   stream_mode="messages" 表示按"消息增量"为单位吐出；
            #   同样的 thread_id 保证流式对话也接得上之前的历史。
            for msg, _meta in agent.stream(
                {"messages": [("user", agent_input)]},
                config={"configurable": {"thread_id": str(conv.id)}},
                stream_mode="messages",
            ):
                # 只把大模型的文本增量推给前端；工具调用阶段（非 AIMessageChunk）不干扰显示
                # AIMessageChunk 是 LangChain 流式输出的"文本片段"类型
                if isinstance(msg, AIMessageChunk) and isinstance(msg.content, str) and msg.content:
                    full.append(msg.content)
                    yield f"data: {json.dumps({'token': msg.content}, ensure_ascii=False)}\n\n"
            reply = "".join(full) or "（模型没有返回内容）"
        except Exception as e:
            reply = f"出错了: {e}"
            yield f"data: {json.dumps({'token': reply}, ensure_ascii=False)}\n\n"

        db.add(Message(conversation_id=conv.id, role="assistant", content=reply))
        conv.updated_at = datetime.now(timezone.utc)
        db.commit()
        yield f"data: {json.dumps({'done': True}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
