"""待办事项 API：让用户在界面上直接增删改查，而不必问 AI。

与 tools.py 里的 add_todo / list_todos 是两套入口：
- 本文件：给人用的 REST 接口
- tools.py：给大模型调用的工具
两者都按 user_id 隔离，数据落在同一张 todos 表。
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import TodoItem
from app.schemas import TodoCreate, TodoOut, TodoUpdate

router = APIRouter(prefix="/api/todos", tags=["todos"])


def _get_owned_todo(db: Session, todo_id: int, user_id: int) -> TodoItem:
    todo = (
        db.query(TodoItem)
        .filter(TodoItem.id == todo_id, TodoItem.user_id == user_id)
        .first()
    )
    if not todo:
        raise HTTPException(404, "待办不存在")
    return todo


@router.get("", response_model=list[TodoOut])
def list_todos(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(TodoItem)
        .filter(TodoItem.user_id == current_user.id)
        .order_by(TodoItem.done.asc(), TodoItem.id.desc())
        .all()
    )


@router.post("", response_model=TodoOut)
def create_todo(
    payload: TodoCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    todo = TodoItem(user_id=current_user.id, task=payload.task.strip())
    db.add(todo)
    db.commit()
    db.refresh(todo)
    return todo


@router.patch("/{todo_id}", response_model=TodoOut)
def update_todo(
    todo_id: int,
    payload: TodoUpdate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    todo = _get_owned_todo(db, todo_id, current_user.id)
    if payload.task is not None:
        todo.task = payload.task.strip() or todo.task
    if payload.done is not None:
        todo.done = payload.done
    db.commit()
    db.refresh(todo)
    return todo


@router.delete("/{todo_id}")
def delete_todo(
    todo_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    todo = _get_owned_todo(db, todo_id, current_user.id)
    db.delete(todo)
    db.commit()
    return {"status": "deleted"}


@router.get("/stats", response_model=dict)
def todo_stats(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    total = db.query(TodoItem).filter(TodoItem.user_id == current_user.id).count()
    done = (
        db.query(TodoItem)
        .filter(TodoItem.user_id == current_user.id, TodoItem.done.is_(True))
        .count()
    )
    return {"total": total, "done": done, "updated_at": datetime.now(timezone.utc)}
