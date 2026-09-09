"""Skill CRUD：用户可自定义技能，把 prompt 拼进系统提示词以改变助手行为。"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Conversation, Skill
from app.schemas import SkillCreate, SkillOut, SkillUpdate

router = APIRouter(prefix="/api/skills", tags=["skills"])


def _remove_skill_from_sessions(db: Session, user_id: int, skill_id: int):
    """删除技能时，把它从该用户所有会话的 active_skill_ids 里移除，避免指向不存在技能。"""
    sessions = db.query(Conversation).filter(Conversation.user_id == user_id).all()
    for conv in sessions:
        ids = list(conv.active_skill_ids or [])
        if skill_id in ids:
            ids.remove(skill_id)
            conv.active_skill_ids = ids


@router.get("", response_model=list[SkillOut])
def list_skills(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(Skill)
        .filter(Skill.user_id == current_user.id)
        .order_by(Skill.updated_at.desc())
        .all()
    )


@router.post("", response_model=SkillOut)
def create_skill(
    payload: SkillCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    skill = Skill(user_id=current_user.id, **payload.model_dump())
    db.add(skill)
    db.commit()
    db.refresh(skill)
    return skill


@router.patch("/{skill_id}", response_model=SkillOut)
def update_skill(
    skill_id: int,
    payload: SkillUpdate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    skill = (
        db.query(Skill)
        .filter(Skill.id == skill_id, Skill.user_id == current_user.id)
        .first()
    )
    if not skill:
        raise HTTPException(404, "技能不存在")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(skill, k, v)
    db.commit()
    db.refresh(skill)
    return skill


@router.delete("/{skill_id}")
def delete_skill(
    skill_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    skill = (
        db.query(Skill)
        .filter(Skill.id == skill_id, Skill.user_id == current_user.id)
        .first()
    )
    if not skill:
        raise HTTPException(404, "技能不存在")
    _remove_skill_from_sessions(db, current_user.id, skill_id)
    db.delete(skill)
    db.commit()
    return {"status": "deleted"}
