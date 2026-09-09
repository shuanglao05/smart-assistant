"""通知中心：站内提醒（列表/未读数/已读/全部已读/清空/创建）。

Agent 也可通过 notify_user 工具把提醒推到这里（见 tools.make_notification_tools）。
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Notification
from app.schemas import NotificationCreate, NotificationOut

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def _owned(db: Session, nid: int, user_id: int) -> Notification:
    n = db.query(Notification).filter(Notification.id == nid, Notification.user_id == user_id).first()
    if not n:
        raise HTTPException(404, "通知不存在")
    return n


@router.get("", response_model=list[NotificationOut])
def list_notifications(
    unread_only: bool = False,
    limit: int = Query(50, ge=1, le=200),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Notification).filter(Notification.user_id == current_user.id)
    if unread_only:
        q = q.filter(Notification.is_read.is_(False))
    return q.order_by(Notification.created_at.desc()).limit(limit).all()


@router.get("/unread-count")
def unread_count(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    n = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.is_read.is_(False))
        .count()
    )
    return {"count": n}


@router.post("", response_model=NotificationOut)
def create_notification(
    payload: NotificationCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    n = Notification(user_id=current_user.id, **payload.model_dump())
    db.add(n)
    db.commit()
    db.refresh(n)
    return n


@router.patch("/{nid}", response_model=NotificationOut)
def mark_notification(
    nid: int,
    is_read: bool = True,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    n = _owned(db, nid, current_user.id)
    n.is_read = is_read
    db.commit()
    db.refresh(n)
    return n


@router.post("/read-all")
def mark_all_read(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(
        Notification.user_id == current_user.id, Notification.is_read.is_(False)
    ).update({"is_read": True}, synchronize_session=False)
    db.commit()
    return {"status": "ok"}


@router.delete("")
def clear_all(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(Notification.user_id == current_user.id).delete()
    db.commit()
    return {"status": "cleared"}
