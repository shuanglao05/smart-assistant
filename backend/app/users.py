"""用户资料：查看 / 修改个人资料、改密。"""

import bcrypt

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas import UserOut, UserUpdate

router = APIRouter(prefix="/api/users", tags=["users"])

ALLOWED_LANGS = {"zh", "en"}
ALLOWED_FONT_SIZES = {"small", "medium", "large"}
ALLOWED_THEMES = {"dark", "light"}


@router.get("/me", response_model=UserOut)
def get_me(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    # 直接从 DB 拿（current_user 是 deps 里的 User 对象，字段可能缺新增列）
    u = db.query(User).filter(User.id == current_user.id).first()
    if not u:
        raise HTTPException(404, "用户不存在")
    return u


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: UserUpdate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    u = db.query(User).filter(User.id == current_user.id).first()
    if not u:
        raise HTTPException(404, "用户不存在")

    if payload.nickname is not None:
        u.nickname = payload.nickname.strip()[:50]
    if payload.avatar is not None:
        u.avatar = payload.avatar[:1_000_000]
    if payload.language is not None:
        if payload.language not in ALLOWED_LANGS:
            raise HTTPException(400, f"不支持的语言: {payload.language}")
        u.language = payload.language
    if payload.font_size is not None:
        if payload.font_size not in ALLOWED_FONT_SIZES:
            raise HTTPException(400, f"不支持的字号: {payload.font_size}")
        u.font_size = payload.font_size
    if payload.theme is not None:
        if payload.theme not in ALLOWED_THEMES:
            raise HTTPException(400, f"不支持的主题: {payload.theme}")
        u.theme = payload.theme

    # 改密
    if payload.new_password:
        if not payload.current_password:
            raise HTTPException(400, "修改密码需要提供 current_password")
        if not bcrypt.checkpw(payload.current_password.encode("utf-8"), u.hashed_password.encode("utf-8")):
            raise HTTPException(400, "当前密码不正确")
        u.hashed_password = bcrypt.hashpw(
            payload.new_password.encode("utf-8"), bcrypt.gensalt()
        ).decode("utf-8")

    db.commit()
    db.refresh(u)
    return u
