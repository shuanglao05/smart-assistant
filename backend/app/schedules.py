"""日程 API：增删改查 + 「开始前 5 分钟」站内提醒。

提醒实现：进程启动时（main.py）拉起一个后台协程 reminder_loop，
每 30 秒扫一次 schedules 表，把「即将在 5 分钟内开始且尚未提醒」的日程
写成一条 Notification（复用通知中心铃铛），并标记 reminded=True。
start_at 用 epoch 秒（UTC）保存，比较无需处理时区。
"""

import asyncio
import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.deps import get_current_user
from app.models import Notification, Schedule
from app.schemas import ScheduleCreate, ScheduleOut, ScheduleUpdate

router = APIRouter(prefix="/api/schedules", tags=["schedules"])

REMIND_AHEAD_SECONDS = 300  # 提前 5 分钟


def _get_owned(db: Session, sid: int, user_id: int) -> Schedule:
    row = db.query(Schedule).filter(Schedule.id == sid, Schedule.user_id == user_id).first()
    if not row:
        raise HTTPException(404, "日程不存在")
    return row


@router.get("", response_model=list[ScheduleOut])
def list_schedules(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(Schedule)
        .filter(Schedule.user_id == current_user.id)
        .order_by(Schedule.start_at.asc())
        .all()
    )


@router.post("", response_model=ScheduleOut)
def create_schedule(
    payload: ScheduleCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = Schedule(
        user_id=current_user.id,
        title=payload.title.strip(),
        start_at=float(payload.start_at),
        note=payload.note,
        reminded=False,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{sid}", response_model=ScheduleOut)
def update_schedule(
    sid: int,
    payload: ScheduleUpdate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _get_owned(db, sid, current_user.id)
    if payload.title is not None:
        row.title = payload.title.strip()
    if payload.note is not None:
        row.note = payload.note
    if payload.start_at is not None:
        row.start_at = float(payload.start_at)
        row.reminded = False  # 改了时间，允许重新提醒
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{sid}")
def delete_schedule(
    sid: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _get_owned(db, sid, current_user.id)
    db.delete(row)
    db.commit()
    return {"status": "deleted"}


def check_upcoming_reminders(db: Session, within_seconds: int = REMIND_AHEAD_SECONDS) -> int:
    """把即将开始的日程写成通知。返回本次生成的提醒条数。"""
    now = time.time()
    rows = (
        db.query(Schedule)
        .filter(
            Schedule.reminded.is_(False),
            Schedule.start_at > now,
            Schedule.start_at <= now + within_seconds,
        )
        .all()
    )
    for s in rows:
        hhmm = datetime.fromtimestamp(s.start_at).strftime("%H:%M")
        body = f"{hhmm} 开始" + (f" · {s.note}" if s.note else "")
        db.add(
            Notification(
                user_id=s.user_id,
                title=f"日程提醒：{s.title}",
                body=body,
                type="remind",
            )
        )
        s.reminded = True
    if rows:
        db.commit()
    return len(rows)


async def reminder_loop() -> None:
    """后台常驻协程：每 30 秒检查一次有没有要提醒的日程。"""
    while True:
        try:
            sdb = SessionLocal()
            try:
                check_upcoming_reminders(sdb)
            finally:
                sdb.close()
        except Exception:  # noqa: BLE001  单次失败不影响后续轮询
            pass
        await asyncio.sleep(30)
