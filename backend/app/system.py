"""系统级设置：数据目录的位置管理（查看 / 迁移到新位置）。

数据目录存数据库、上传文件、缓存。它的「位置」本身不能存在数据库里（会循环依赖），
所以保存在 .env 的 DATA_DIR；改完需【重启后端】生效。
"""

import shutil
import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import config
from app.deps import get_current_user

router = APIRouter(prefix="/api/system", tags=["system"])


def _dir_size_mb(p: Path) -> float:
    total = 0
    try:
        for f in p.rglob("*"):
            if f.is_file():
                total += f.stat().st_size
    except Exception:
        pass
    return round(total / 1024 / 1024, 1)


def _copy_db(src: Path, dst: Path) -> None:
    """用 SQLite 在线备份 API 复制数据库（即使源库正在被使用也安全一致）。"""
    s = sqlite3.connect(str(src))
    try:
        d = sqlite3.connect(str(dst))
        try:
            with d:
                s.backup(d)
        finally:
            d.close()
    finally:
        s.close()


@router.get("/data-dir")
def get_data_dir(_user=Depends(get_current_user)):
    """当前数据目录 + 默认位置 + 占用大小。"""
    return {
        "current": str(config.DATA_DIR),
        "default": str(config.DEFAULT_DATA_DIR),
        "is_default": config.DATA_DIR == config.DEFAULT_DATA_DIR,
        "size_mb": _dir_size_mb(config.DATA_DIR),
        "db_exists": (config.DATA_DIR / "app.db").exists(),
    }


class DataDirUpdate(BaseModel):
    path: str
    migrate: bool = True  # 是否把当前数据复制到新位置


@router.post("/data-dir")
def set_data_dir(payload: DataDirUpdate, _user=Depends(get_current_user)):
    """把数据目录改到新位置（默认同时复制现有数据过去），写入 .env，重启后生效。"""
    raw = payload.path.strip()
    if not raw:
        raise HTTPException(400, "请填写路径")
    target = Path(raw).expanduser()
    if not target.is_absolute():
        raise HTTPException(400, "请填写绝对路径（如 D:/ipas-data）")
    target = target.resolve()

    if target == config.DATA_DIR:
        raise HTTPException(400, "新位置与当前数据目录相同")

    app_dir = Path(__file__).resolve().parent  # backend/app（源代码）
    if target == app_dir or app_dir in target.parents:
        raise HTTPException(400, "不要设到 backend/app 源代码目录里")

    try:
        target.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        raise HTTPException(400, f"无法创建目录：{e}")

    # Windows 下 os.access 不可靠，用实际写文件测试
    try:
        testf = target / ".ipas_write_test"
        testf.write_text("ok", encoding="utf-8")
        testf.unlink()
    except Exception as e:
        raise HTTPException(400, f"该目录不可写：{e}")

    # 非空且不是「已有数据目录」 → 拒绝，避免覆盖别人的东西
    items = list(target.iterdir())
    if items and not (target / "app.db").exists():
        raise HTTPException(400, "目标目录非空，请选择空目录（或已放有 app.db 的数据目录）")

    migrated = False
    if payload.migrate:
        try:
            src_db = config.DATA_DIR / "app.db"
            if src_db.exists():
                _copy_db(src_db, target / "app.db")
            for sub in ("uploads", "cache"):
                s = config.DATA_DIR / sub
                if s.is_dir():
                    shutil.copytree(s, target / sub, dirs_exist_ok=True)
            migrated = True
        except Exception as e:
            raise HTTPException(400, f"数据迁移失败：{e}")

    from app.llm_config import _update_env_file

    _update_env_file({"DATA_DIR": str(target)})
    return {"ok": True, "path": str(target), "migrated": migrated, "need_restart": True}
