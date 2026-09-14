"""聊天路由：核心接口 POST /api/chat（非流式）与 POST /api/chat/stream（SSE 流式）。

支持：
- regenerate=true：不新增用户消息，删掉最后一个问题之后的 assistant 回答，重新生成；
- file_ids=[...]：把该用户已上传附件（files 表）注入本次提问（不落库，一问一答）：
    · 文本/PDF  → 抽出正文拼到问题前面（_attachment_context）
    · 图片      → 转成多模态消息块，交给视觉模型直接看图（_image_blocks，此时不走 Agent）
- 流式事件类型：{"token":...} 正文增量 / {"reasoning":...} 思考过程增量 /
  {"sources":[...]} 知识库命中来源 / {"done":true, provider, model} 结束（带回本条用的模型）；
- 思考过程：推理模型思考内容若混在正文的  thinking…<｜end▁of▁thinking｜> 里，由 _ThinkSplitter 流式剥离，
  与正文分开推送，避免污染回答。
"""

import base64
import json
import mimetypes
import re
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessageChunk, HumanMessage, ToolMessage
from sqlalchemy.orm import Session

from app import config
from app.agent_manager import build_llm, get_agent_for_conversation
from app.database import SessionLocal, get_db
from app.deps import get_current_user
from app.files import IMAGE_EXTS, UPLOAD_ROOT
from app.models import Conversation, FileItem, Message
from app.schemas import ChatRequest, ChatResponse

router = APIRouter(prefix="/api", tags=["chat"])

# 从知识库工具返回文本里提取来源文件名（工具按「【文件名】正文」格式拼装）
_SRC_RE = re.compile(r"【(.+?)】")


def _clear_session_memory(conv_id: int) -> None:
    """丢弃某会话的 LangGraph 记忆（checkpointer 里的对话状态）。

    为什么需要：模型调用若在网络异常 / 用户中断时半途终止（尤其是「工具调用」进行到一半），
    checkpointer 会残留一条「AIMessage 带 tool_calls、却没有对应 ToolMessage」的半截历史。
    此后该会话的每次请求都会在【历史校验阶段】报错：
        ValueError: Found AIMessages with tool_calls that do not have a corresponding ToolMessage
    关键：这个错误发生在「调用模型之前」，所以【换成本地模型也一样失败】——只能清掉该会话记忆。

    清掉后的影响：前端消息记录（messages 表）不受影响，历史照样看得到；
    只是 AI 的上下文记忆被重置（相当于这个会话「失忆」，但不影响继续使用）。
    """
    try:
        from app.agent_manager import _CHECKPOINTER

        _CHECKPOINTER.delete_thread(str(conv_id))
    except Exception:
        pass  # 清理失败不能影响主流程（此时响应已产出）


def _extract_sources(text: str) -> list[str]:
    """从工具结果里抽出命中的来源文件名（去重，保持出现顺序）。"""
    out: list[str] = []
    seen: set[str] = set()
    for name in _SRC_RE.findall(text or ""):
        if name not in seen:
            seen.add(name)
            out.append(name)
    return out


_THINK_OPEN = " thinking"
_THINK_CLOSE = "<｜end▁of▁thinking｜>"


class _ThinkSplitter:
    """把流式正文里的  thinking...<｜end▁of▁thinking｜> 拆成「思考」与「回答」两路。

    部分推理模型（如本地 qwen3 开启 think）会把思考过程用  thinking 标签混在正文里，
    这里做流式拆分，好让前端把思考过程单独展示。标签可能跨 chunk，故保留尾巴缓冲。
    """

    def __init__(self) -> None:
        self._buf = ""
        self._in_think = False

    def feed(self, text: str) -> tuple[str, str]:
        """喂入一段增量文本，返回 (思考增量, 回答增量)。"""
        self._buf += text
        think_parts: list[str] = []
        answer_parts: list[str] = []
        while self._buf:
            if not self._in_think:
                i = self._buf.find(_THINK_OPEN)
                if i >= 0:
                    answer_parts.append(self._buf[:i])
                    self._buf = self._buf[i + len(_THINK_OPEN):]
                    self._in_think = True
                    continue
                # 末尾可能是半个开标签，先留着不输出
                keep = len(_THINK_OPEN) - 1
                if len(self._buf) > keep:
                    answer_parts.append(self._buf[:-keep])
                    self._buf = self._buf[-keep:]
                break
            j = self._buf.find(_THINK_CLOSE)
            if j >= 0:
                think_parts.append(self._buf[:j])
                self._buf = self._buf[j + len(_THINK_CLOSE):]
                self._in_think = False
                continue
            keep = len(_THINK_CLOSE) - 1
            if len(self._buf) > keep:
                think_parts.append(self._buf[:-keep])
                self._buf = self._buf[-keep:]
            break
        return "".join(think_parts), "".join(answer_parts)

    def flush(self) -> tuple[str, str]:
        """流结束：把缓冲里剩余的内容吐出（仍处于思考态则算思考）。"""
        rest, self._buf = self._buf, ""
        return (rest, "") if self._in_think else ("", rest)


def _attachment_context(
    db: Session,
    user_id: int,
    file_ids: list[int] | None,
    exclude_ids: set[int] | None = None,
) -> str:
    """把附件正文拼成注入文本；文件必须属于当前用户。

    图片附件走多模态消息（见 _image_blocks），这里用 exclude_ids 跳过，
    避免把图片拼成"无内容可读取"的占位文案。
    """
    if not file_ids:
        return ""
    files = (
        db.query(FileItem)
        .filter(FileItem.id.in_(file_ids), FileItem.user_id == user_id)
        .all()
    )
    blocks = []
    for f in files:
        if exclude_ids and f.id in exclude_ids:
            continue
        text = (f.content or "").strip()
        if text:
            blocks.append(f"[附件：{f.filename}]\n{text}")
        else:
            blocks.append(f"[附件：{f.filename}]（无内容可读取）")
    if not blocks:
        return ""
    return "\n\n".join(blocks) + "\n\n"


def _image_blocks(
    db: Session, user_id: int, file_ids: list[int] | None
) -> tuple[list[dict], set[int]]:
    """把用户上传的图片附件转成多模态 content blocks（data URL）。

    返回 (blocks, image_ids)：blocks 直接塞进 HumanMessage 的 content；
    image_ids 用于在文本注入里排除这些图片。文件必须属于当前用户。
    """
    if not file_ids:
        return [], set()
    files = (
        db.query(FileItem)
        .filter(FileItem.id.in_(file_ids), FileItem.user_id == user_id)
        .all()
    )
    blocks: list[dict] = []
    ids: set[int] = set()
    for f in files:
        if Path(f.stored_path).suffix.lower() not in IMAGE_EXTS:
            continue
        try:
            data = (UPLOAD_ROOT.parent / f.stored_path).read_bytes()
        except Exception:
            continue
        mime = mimetypes.guess_type(f.filename)[0] or "image/png"
        b64 = base64.b64encode(data).decode()
        blocks.append(
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}}
        )
        ids.add(f.id)
    return blocks, ids


def _prepare_conversation(
    db: Session, user_id: int, conv: Conversation, payload: ChatRequest
) -> tuple[str, int | None]:
    """写用户消息 / 处理 regenerate，返回 (问题原文, 本条用户消息的 id)。

    返回 user_msg_id 是为了让流式结束事件能把它和助手回答的 id 一起回传前端，
    前端据此给刚生成的这轮问答补上后端 id（否则新发的消息没有 id，单条删除按钮不会显示）。
    """
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
        return last_user.content, last_user.id

    text = (payload.message or "").strip()
    if not text:
        raise HTTPException(400, "消息不能为空")
    ref_ids = payload.file_ids or []
    row = Message(
        conversation_id=conv.id,
        role="user",
        content=text,
        ref_file_ids=json.dumps(ref_ids) if ref_ids else None,
    )
    db.add(row)
    db.flush()  # 拿到刚插入的用户消息 id（不急着 commit，外层统一提交）
    uid = row.id
    if msg_count == 0 and conv.title == "新对话":
        conv.title = text[:20]
    return text, uid


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

    question, _ = _prepare_conversation(db, current_user.id, conv, payload)
    conv.updated_at = datetime.now(timezone.utc)
    db.commit()

    image_blocks, image_ids = _image_blocks(db, current_user.id, payload.file_ids)
    context = _attachment_context(db, current_user.id, payload.file_ids, exclude_ids=image_ids)
    agent_input = f"{context}{question}" if context else question

    if image_blocks:
        # 含图片：直接多模态调用（不走 Agent，避免"工具调用 + 视觉"不兼容）
        try:
            llm = build_llm(conv.provider, conv.model)
            msg = HumanMessage(
                content=[
                    {"type": "text", "text": agent_input or "请描述这张图片的内容。"},
                    *image_blocks,
                ]
            )
            resp = llm.invoke([msg])
            reply = resp.content if isinstance(resp.content, str) else str(resp.content)
            if not reply:
                reply = "（模型没有返回内容）"
        except Exception as e:
            reply = f"出错了: {e}"
    else:
        # 拿到这个会话对应的 ReAct 智能体（带 MemorySaver 记忆）
        agent = get_agent_for_conversation(conv.id, current_user.id, provider=conv.provider, model=conv.model)
        try:
            # agent.invoke：一次性跑完整个"思考→调工具→再思考→回答"循环，返回最终结果。
            #   config 里的 thread_id 是 LangGraph 记忆的"身份证"：相同 thread_id 的多次调用
            #   会共享同一段对话历史（MemorySaver 存的就是它），所以多轮对话能接得上。
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

    db.add(
        Message(
            conversation_id=conv.id,
            role="assistant",
            content=reply,
            provider=conv.provider,
            model=conv.model,
        )
    )
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
    question, user_msg_id = _prepare_conversation(db, current_user.id, conv, payload)
    image_blocks, image_ids = _image_blocks(db, current_user.id, payload.file_ids)
    context = _attachment_context(db, current_user.id, payload.file_ids, exclude_ids=image_ids)
    agent_input = f"{context}{question}" if context else question
    conv.updated_at = datetime.now(timezone.utc)
    db.commit()

    # 含图片时用多模态模型直连；否则用带记忆的 ReAct 智能体（与上面非流式版本共用记忆）。
    # 深度思考开关只对流式聊天生效（enable_thinking 仅流式合法；
    # 视觉模型不适用该参数，多模态路径不传）。
    agent = (
        None
        if image_blocks
        else get_agent_for_conversation(
            conv.id,
            current_user.id,
            provider=conv.provider,
            model=conv.model,
            enable_thinking=config.CLOUD_ENABLE_THINKING,
            thinking_budget=config.CLOUD_THINKING_BUDGET,
        )
    )

    def gen():
        """生成器函数：被 StreamingResponse 逐段取出，形成 SSE 流式推送。

        健壮性设计（针对"中途断连"）：
          不在流结束时才新建助手消息行，而是【一开始就建一条空内容行】，
          流过程中只在 finally 里更新它的内容。这样即便客户端中途关窗口 / 点停止
          （Starlette 未必会立刻对 sync 生成器抛 GeneratorExit），这条行已经存在——
          用户重载会话时能看到"回答中断"状态，而不是一条凭空消失的回答。
          更新放在 try/finally（含 except GeneratorExit）里，断连时也一定会落库。
        """
        full: list[str] = []
        splitter = _ThinkSplitter()
        reply = ""

        # ① 预先建好助手消息行（空内容），记下 id，后续只更新它（避免结尾再新建造成重复）
        assistant_id = None
        try:
            sdb = SessionLocal()
            row = Message(
                conversation_id=conv.id,
                role="assistant",
                content="",
                provider=conv.provider,
                model=conv.model,
            )
            sdb.add(row)
            sdb.commit()
            sdb.refresh(row)
            assistant_id = row.id
            sdb.close()
        except Exception:
            assistant_id = None  # 建行失败则降级为「流结束再新建」

        def _save(final_text: str) -> None:
            """把最终 / 部分内容写回助手消息行（新建或更新都兼容），独立会话避免被回收。"""
            try:
                sdb = SessionLocal()
                try:
                    if assistant_id is not None:
                        r = sdb.get(Message, assistant_id)
                        if r:
                            r.content = final_text
                    else:
                        sdb.add(
                            Message(
                                conversation_id=conv.id,
                                role="assistant",
                                content=final_text,
                                provider=conv.provider,
                                model=conv.model,
                            )
                        )
                    c = sdb.get(Conversation, conv.id)
                    if c:
                        c.updated_at = datetime.now(timezone.utc)
                    sdb.commit()
                finally:
                    sdb.close()
            except Exception:
                pass

        try:
            if image_blocks:
                # 多模态流式：把"问题 + 图片"直接交给视觉模型逐 token 输出
                llm = build_llm(conv.provider, conv.model)
                message = HumanMessage(
                    content=[
                        {"type": "text", "text": agent_input or "请描述这张图片的内容。"},
                        *image_blocks,
                    ]
                )
                for chunk in llm.stream([message]):
                    if isinstance(chunk.content, str) and chunk.content:
                        full.append(chunk.content)
                        yield f"data: {json.dumps({'token': chunk.content}, ensure_ascii=False)}\n\n"
            else:
                # agent.stream：和 invoke 一样跑完整循环，但不等全部结束，而是每产生一点
                # 模型文本就 yield 出来，前端就能实现"打字机"逐字显示。
                #   stream_mode="messages" 表示按"消息增量"为单位吐出；
                #   同样的 thread_id 保证流式对话也接得上之前的历史。
                for msg, _meta in agent.stream(
                    {"messages": [("user", agent_input)]},
                    config={"configurable": {"thread_id": str(conv.id)}},
                    stream_mode="messages",
                ):
                    if isinstance(msg, AIMessageChunk):
                        # ① 结构化思考内容（部分云端推理模型：DeepSeek-R1 / Qwen 思考版等）
                        ak = getattr(msg, "additional_kwargs", None)
                        rc = None
                        if isinstance(ak, dict):
                            rc = ak.get("reasoning_content") or ak.get("reasoning")
                        if isinstance(rc, str) and rc:
                            yield f"data: {json.dumps({'reasoning': rc}, ensure_ascii=False)}\n\n"
                        # ② 正文（本地 qwen3 开 think 时，思考会以  thinking 标签混在正文里）
                        if isinstance(msg.content, str) and msg.content:
                            think, answer = splitter.feed(msg.content)
                            if think:
                                yield f"data: {json.dumps({'reasoning': think}, ensure_ascii=False)}\n\n"
                            if answer:
                                full.append(answer)
                                yield f"data: {json.dumps({'token': answer}, ensure_ascii=False)}\n\n"
                    elif (
                        isinstance(msg, ToolMessage)
                        and getattr(msg, "name", None) == "search_knowledge_base"
                    ):
                        # 知识库检索工具执行完毕：把命中的来源文件名推给前端做「引用来源」标注
                        sources = _extract_sources(
                            msg.content if isinstance(msg.content, str) else ""
                        )
                        if sources:
                            yield f"data: {json.dumps({'sources': sources}, ensure_ascii=False)}\n\n"
                # 收尾：冲掉标签拆分器缓冲里的残留
                think, answer = splitter.flush()
                if think:
                    yield f"data: {json.dumps({'reasoning': think}, ensure_ascii=False)}\n\n"
                if answer:
                    full.append(answer)
                    yield f"data: {json.dumps({'token': answer}, ensure_ascii=False)}\n\n"
            reply = "".join(full) or "（模型没有返回内容）"
        except GeneratorExit:
            # 客户端半途断连（关窗口 / 点停止）：保留已生成内容，否则标记中断。
            # 落库放在 except 内、raise 之前，且直接 re-raise——符合生成器关闭协议，
            # 不会触发 "generator ignored GeneratorExit" 的 RuntimeError。
            partial = "".join(full)
            reply = partial if partial.strip() else "（回答生成已中断）"
            _save(reply)  # 行早已存在，此处写回部分/中断内容
            # 中断可能发生在「工具调用进行到一半」，会留下半截历史让该会话后续报错，
            # 这里清掉本会话记忆（前端消息记录不受影响，仍看得到历史）。
            _clear_session_memory(conv.id)
            raise
        except Exception as e:
            # 云端报错（401/429/参数不合法/超时等）以前被静默吞成一行文字，用户看不到原因。
            # 这里把完整堆栈打到后端控制台，并把可读原因推给前端气泡。
            import traceback

            traceback.print_exc()
            err_text = str(e) or e.__class__.__name__
            # 百炼/OpenAI 兼容接口会在异常里带 status_code 与 body，尽量抽出来
            body = getattr(e, "body", None)
            if isinstance(body, dict):
                detail = body.get("message") or body.get("error")
                if detail:
                    err_text = f"{err_text}｜{detail}"
            reply = f"出错了: {err_text}"
            _save(reply)
            # 网络异常常发生在「工具调用进行到一半」，checkpointer 会残留半截历史，
            # 导致该会话之后每次请求都报 INVALID_CHAT_HISTORY（换本地模型也一样，
            # 因为错误在历史校验阶段、模型还没被调用）。清掉本会话记忆即可恢复。
            _clear_session_memory(conv.id)
            # 额外推一个 error 事件，让前端拿到结构化原因而非只有文字
            yield f"data: {json.dumps({'error': err_text}, ensure_ascii=False)}\n\n"
        else:
            # 正常结束：把最终内容写回（行早已存在，只更新内容，不会重复建行）
            _save(reply)
        # 结束事件顺带带上本次回答所用的模型，以及这轮问答在后端的两行 id，
        # 前端据此给刚生成的消息补上 id（用于单条删除 / 重载前也能删除）。
        yield f"data: {json.dumps({'done': True, 'provider': conv.provider, 'model': conv.model, 'user_id': user_msg_id, 'assistant_id': assistant_id}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
