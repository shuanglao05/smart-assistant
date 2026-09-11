"""课表 API：课程的增删改查（按 user_id 隔离）+ 智能导入（AI 解析网址/文本）。

一门课 = 星期几 + 起止节次 + 周次；前端按「节次行 × 星期列」的网格渲染，并按当前周过滤。
"""

import json
import re

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import config
from app.agent_manager import build_llm
from app.database import get_db
from app.deps import get_current_user
from app.models import Course
from app.schemas import CourseCreate, CourseImportRequest, CourseOut, CourseUpdate

router = APIRouter(prefix="/api/courses", tags=["courses"])


def _get_owned(db: Session, cid: int, user_id: int) -> Course:
    row = db.query(Course).filter(Course.id == cid, Course.user_id == user_id).first()
    if not row:
        raise HTTPException(404, "课程不存在")
    return row


def _norm_sections(a: int, b: int) -> tuple[int, int]:
    return (a, b) if a <= b else (b, a)


@router.get("", response_model=list[CourseOut])
def list_courses(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(Course)
        .filter(Course.user_id == current_user.id)
        .order_by(Course.weekday.asc(), Course.start_section.asc())
        .all()
    )


@router.post("", response_model=CourseOut)
def create_course(
    payload: CourseCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    start, end = _norm_sections(payload.start_section, payload.end_section)
    row = Course(
        user_id=current_user.id,
        name=payload.name.strip(),
        teacher=payload.teacher,
        location=payload.location,
        weekday=payload.weekday,
        start_section=start,
        end_section=end,
        weeks=payload.weeks,
        color=payload.color,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{cid}", response_model=CourseOut)
def update_course(
    cid: int,
    payload: CourseUpdate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _get_owned(db, cid, current_user.id)
    if payload.name is not None:
        row.name = payload.name.strip()
    if payload.teacher is not None:
        row.teacher = payload.teacher
    if payload.location is not None:
        row.location = payload.location
    if payload.weekday is not None:
        row.weekday = payload.weekday
    if payload.start_section is not None:
        row.start_section = payload.start_section
    if payload.end_section is not None:
        row.end_section = payload.end_section
    if payload.weeks is not None:
        row.weeks = payload.weeks
    if payload.color is not None:
        row.color = payload.color
    row.start_section, row.end_section = _norm_sections(row.start_section, row.end_section)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{cid}")
def delete_course(
    cid: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _get_owned(db, cid, current_user.id)
    db.delete(row)
    db.commit()
    return {"status": "deleted"}


# ---------------------------------------------------------------- 智能导入
_IMPORT_PROMPT = (
    "你是课表解析助手。下面是从网页或文本中提取的内容，请解析出所有课程，"
    "只输出一个 JSON 数组，不要任何多余文字。每个元素的字段：\n"
    '{"name": "课程名", "teacher": "老师或空", "location": "地点或空", '
    '"weekday": 1到7的整数(1=周一), "start_section": 起始节次整数, '
    '"end_section": 结束节次整数, "weeks": "周次字符串(如 1-16 / 1-16单周 / 1-16双周；每周都上则空字符串)"}\n'
    "节次按每天第几节编号（第1节=1，依次递增）。内容如下：\n\n"
)


def _html_to_text(html: str) -> str:
    """极简 HTML 去标签：只留可见文本，够喂给模型即可。"""
    html = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html)
    text = re.sub(r"(?s)<[^>]+>", " ", html)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
    )
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()


def _extract_json_list(text: str) -> list[dict]:
    """从模型回复里抠出 JSON 数组并做基本校验/归一化。"""
    t = re.sub(r"```(?:json)?", "", text).strip()
    i, j = t.find("["), t.rfind("]")
    if i < 0 or j < i:
        return []
    try:
        data = json.loads(t[i : j + 1])
    except Exception:  # noqa: BLE001
        return []
    if not isinstance(data, list):
        return []
    out: list[dict] = []
    for it in data:
        if not isinstance(it, dict) or not str(it.get("name") or "").strip():
            continue
        try:
            wd = int(it.get("weekday") or 1)
            ws = int(it.get("start_section") or 1)
            we = int(it.get("end_section") or ws)
        except (TypeError, ValueError):
            continue
        out.append(
            {
                "name": str(it.get("name"))[:100],
                "teacher": (str(it.get("teacher"))[:100] or None) if it.get("teacher") else None,
                "location": (str(it.get("location"))[:100] or None) if it.get("location") else None,
                "weekday": min(7, max(1, wd)),
                "start_section": max(1, min(ws, we)),
                "end_section": max(1, max(ws, we)),
                "weeks": (str(it.get("weeks"))[:50] or None) if it.get("weeks") else None,
            }
        )
    return out


@router.post("/import")
def import_courses(payload: CourseImportRequest, current_user=Depends(get_current_user)):
    """解析网址 / 粘贴内容 / 课表截图 为课程列表（不落库；前端预览确认后再逐条创建）。"""
    # ① 图片识别：交给云端视觉模型（多模态）
    if payload.image and payload.image.strip():
        if not (config.CLOUD_API_KEY and config.CLOUD_BASE_URL):
            raise HTTPException(400, "图片识别需要云端视觉模型，请在 .env 配置 CLOUD_API_KEY / CLOUD_BASE_URL")
        try:
            from langchain_core.messages import HumanMessage

            llm = build_llm(payload.provider or "cloud", payload.model or config.VISION_MODEL)
            msg = HumanMessage(
                content=[
                    {
                        "type": "text",
                        "text": _IMPORT_PROMPT + "（这是一张课表截图，请识别其中的课程）",
                    },
                    {"type": "image_url", "image_url": {"url": payload.image.strip()}},
                ]
            )
            resp = llm.invoke([msg])
            out = resp.content if isinstance(resp.content, str) else str(resp.content)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(500, f"图片识别失败：{e}")
        courses = _extract_json_list(out)
        return {"count": len(courses), "courses": courses}

    # ② 网址 / 文本
    raw = ""
    if payload.text and payload.text.strip():
        raw = payload.text.strip()
    elif payload.url and payload.url.strip():
        try:
            with httpx.Client(trust_env=False, timeout=20, follow_redirects=True) as cli:
                resp = cli.get(payload.url.strip(), headers={"User-Agent": "Mozilla/5.0"})
                resp.raise_for_status()
                raw = _html_to_text(resp.text)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, f"抓取网页失败（可能需要登录或站点不允许抓取）：{e}")
    else:
        raise HTTPException(400, "请提供课表网址，或直接粘贴课表内容")
    if not raw.strip():
        raise HTTPException(400, "没有解析到内容（页面可能是空壳 / 需要登录）")
    raw = raw[:8000]
    try:
        llm = build_llm(payload.provider or config.LLM_PROVIDER, payload.model)
        resp = llm.invoke([{"role": "user", "content": _IMPORT_PROMPT + raw}])
        out = resp.content if isinstance(resp.content, str) else str(resp.content)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"AI 解析失败：{e}")
    courses = _extract_json_list(out)
    return {"count": len(courses), "courses": courses}
