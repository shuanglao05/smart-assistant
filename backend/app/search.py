"""跨会话历史搜索：检索当前用户所有会话的标题与消息正文（LIKE 子串匹配）。"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Conversation, Message
from app.schemas import SearchHit

router = APIRouter(prefix="/api/search", tags=["search"])

_MAX = 60


def _snippet(content: str, q: str, span: int = 90) -> str:
    """截取命中词前后一段文本，作为结果摘要。"""
    idx = content.lower().find(q.lower())
    if idx < 0:
        return content[: span * 2]
    start = max(0, idx - span // 2)
    end = min(len(content), idx + len(q) + span)
    pre = "…" if start > 0 else ""
    post = "…" if end < len(content) else ""
    return pre + content[start:end].replace("\n", " ").strip() + post


@router.get("", response_model=list[SearchHit])
def search(
    q: str = Query(..., min_length=1, max_length=100),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pat = f"%{q}%"
    hits: list[SearchHit] = []

    # 1) 标题命中 -> 每个会话一条（role=title）
    convs = (
        db.query(Conversation)
        .filter(Conversation.user_id == current_user.id, Conversation.title.ilike(pat))
        .order_by(Conversation.updated_at.desc())
        .limit(_MAX)
        .all()
    )
    for c in convs:
        hits.append(
            SearchHit(
                conversation_id=c.id,
                title=c.title,
                role="title",
                content=f"会话标题：{c.title}",
                created_at=c.updated_at,
            )
        )

    # 2) 消息正文命中 -> 按时间倒序
    rows = (
        db.query(Message, Conversation.title)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .filter(
            Conversation.user_id == current_user.id,
            Message.role.in_(["user", "assistant"]),
            Message.content.ilike(pat),
        )
        .order_by(Message.created_at.desc())
        .limit(_MAX)
        .all()
    )
    for m, title in rows:
        hits.append(
            SearchHit(
                conversation_id=m.conversation_id,
                title=title,
                role=m.role,
                content=_snippet(m.content, q),
                created_at=m.created_at,
            )
        )
    return hits[: _MAX * 2]
