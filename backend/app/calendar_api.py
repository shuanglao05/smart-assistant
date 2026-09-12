"""节假日数据：接入 timor.tech 免费 API，拿到「放假 / 调休补班」安排。

为什么必须接入外部接口：
  单纯维护一张「节日表」只能知道"哪天是什么节"（如 10-1 国庆节），
  但无法知道"哪天放假、哪天要补班"——这些由国务院每年发文规定、
  且年年不同（例：2026 年中秋 9/25-9/27 放假、国庆 10/1-10/7 放假，
  9/20 与 10/10 补班）。手机日历里那种「休 / 班」角标就来自这份安排。

数据源：https://timor.tech/api/holiday/year/{year}/
  · 免费、无需登录、每年更新国务院安排、含放假与调休补班；
  · 限额 10000 次 / IP / 天（我们一年只拉一次，绰绰有余）。

策略：
  磁盘缓存（按年）→ 在线拉取 → 失败返回空（前端退化为只显示传统节日名，不会报错）。

网络：复用云端大模型那套代理逻辑（本机实测直连 21.6s、走代理 3.1s），
      避免因网络环境导致日历加载卡住。
"""

import json
import time
from pathlib import Path

from fastapi import APIRouter, Depends, Query

from app.agent_manager import _cloud_http_client
from app.deps import get_current_user

router = APIRouter(prefix="/api/calendar", tags=["calendar"])

_TIMOR_URL = "https://timor.tech/api/holiday/year/{year}/"
# 缓存目录：backend/.cache/（不入库，见 .gitignore）
_CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache"
# 缓存有效期：7 天。放假安排一年只变一次，但留短一点的 TTL 以便修正数据。
_CACHE_TTL = 7 * 24 * 3600


def _cache_path(year: int) -> Path:
    return _CACHE_DIR / f"holiday-{year}.json"


def _read_cache(year: int) -> dict | None:
    """读缓存；过期或年份不符则视为未命中。"""
    p = _cache_path(year)
    if not p.exists():
        return None
    try:
        obj = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None
    if obj.get("year") != year:
        return None
    if int(time.time()) - int(obj.get("ts") or 0) > _CACHE_TTL:
        return None
    return obj.get("days") or {}


def _write_cache(year: int, days: dict) -> None:
    try:
        _CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _cache_path(year).write_text(
            json.dumps(
                {"year": year, "ts": int(time.time()), "days": days},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
    except Exception:
        pass  # 缓存写失败不影响返回


def _normalize(raw: dict) -> dict:
    """把 timor 的 {"10-01": {...}} 归一化成 {"2026-10-01": {off, work, name, wage}}。

    timor 字段语义：
      holiday=true  → 放假（off）
      holiday=false → 调休补班（work）
      name          → 节日名或「某某补班」
      wage          → 薪资倍数，3=法定核心日、2=假期其余天、1=补班
    """
    out: dict = {}
    for _key, info in (raw or {}).items():
        if not isinstance(info, dict):
            continue
        date = info.get("date")
        if not isinstance(date, str) or not date:
            continue
        is_off = bool(info.get("holiday"))
        out[date] = {
            "off": is_off,          # true = 放假（显示「休」）
            "work": not is_off,     # true = 调休补班（显示「班」）
            "name": info.get("name") or "",
            "wage": int(info.get("wage") or 1),
        }
    return out


def _fetch(year: int) -> dict | None:
    """在线拉取某年数据；任何异常都返回 None（由上层兜底）。"""
    try:
        resp = _cloud_http_client().get(
            _TIMOR_URL.format(year=year),
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=20.0,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return None
    if not isinstance(data, dict) or data.get("code") != 0:
        return None
    return _normalize(data.get("holiday") or {})


@router.get("/holidays")
def get_holidays(
    year: int = Query(..., ge=1970, le=2100),
    _current_user=Depends(get_current_user),
):
    """返回某年的放假 / 调休补班安排。

    `days` 形如 {"2026-10-01": {"off": true, "work": false, "name": "国庆节", "wage": 3}}；
    `source` 标明数据来源：cache（磁盘缓存）/ timor（在线）/ unavailable（拉取失败）。
    """
    cached = _read_cache(year)
    if cached is not None:
        return {"year": year, "source": "cache", "days": cached}

    days = _fetch(year)
    if days is None:
        return {"year": year, "source": "unavailable", "days": {}}

    _write_cache(year, days)
    return {"year": year, "source": "timor", "days": days}
