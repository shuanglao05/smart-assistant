"""FastAPI 入口：装配 app、注册路由、CORS、启动建表。"""

import asyncio
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.auth import router as auth_router
from app.calendar_api import router as calendar_router
from app.chat import router as chat_router
from app.database import get_db, init_db
from app.deps import get_current_user
from app.files import router as files_router
from app.kb import router as kb_router
from app.llm_config import router as llm_config_router
from app.llm_providers import router as llm_providers_router
from app.notifications import router as notifications_router
from app.search import router as search_router
from app.sessions import router as sessions_router
from app.skills import router as skills_router
from app.todos import router as todos_router
from app.users import router as users_router
from app.api_keys import router as api_keys_router
from app.weather import router as weather_router
from app.notes import router as notes_router
from app.schedules import reminder_loop, router as schedules_router
from app.courses import router as courses_router
from app.system import router as system_router


def _read_version() -> str:
    """读取项目版本号。

    唯一来源是仓库根目录的 `VERSION` 文件（发版时只改它一处即可）；
    读不到时回落到 1.0.0，保证不会因为文件缺失而启动失败。
    """
    try:
        root = Path(__file__).resolve().parents[2]  # .../smart-assistant
        return (root / "VERSION").read_text(encoding="utf-8").strip() or "1.0.0"
    except Exception:
        return "1.0.0"


VERSION = _read_version()

app = FastAPI(title="智能个人助理 API", version=VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()  # 开发期自动建表

app.include_router(auth_router)
app.include_router(sessions_router)
app.include_router(skills_router)
app.include_router(todos_router)
app.include_router(weather_router)
app.include_router(files_router)
app.include_router(kb_router)
app.include_router(search_router)
app.include_router(notifications_router)
app.include_router(users_router)
app.include_router(api_keys_router)
app.include_router(llm_config_router)
app.include_router(llm_providers_router)
app.include_router(chat_router)
app.include_router(calendar_router)
app.include_router(notes_router)
app.include_router(schedules_router)
app.include_router(courses_router)
app.include_router(system_router)


@app.on_event("startup")
async def _start_background_tasks():
    """启动后台任务：日程提醒 + 云端连接预热与保活。

    连接保活为什么必要：httpx 连接空闲会被回收，而本机走代理重建连接需 20~40s
    （实测热请求 0.9s、冷建连 23s+）。每 60s 打一次轻量请求把连接养着，
    用户隔几分钟再提问也不会重新握手。GET /models 不消耗 token。
    """
    from app.agent_manager import warm_up_cloud

    async def _keep_cloud_alive():
        while True:
            await asyncio.sleep(60)
            try:
                await asyncio.to_thread(warm_up_cloud)
            except Exception:
                pass  # 保活失败不影响业务

    asyncio.create_task(reminder_loop())
    # 预热一次（不阻塞启动），让重启后的第一条消息也不必承担建连开销
    asyncio.create_task(asyncio.to_thread(warm_up_cloud))
    asyncio.create_task(_keep_cloud_alive())


@app.get("/api/health")
def health():
    """健康检查：顺带返回当前版本与正在使用的大模型，便于排查部署问题。"""
    from app import config

    return {
        "status": "ok",
        "version": VERSION,
        "llm_provider": config.LLM_PROVIDER,
        "llm_model": config.OLLAMA_MODEL if config.LLM_PROVIDER == "ollama" else config.CLOUD_MODEL,
    }


@app.get("/api/llm-options")
def llm_options(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """可选模型清单（含多 API provider + 本地 Ollama 多模型），供前端切换模型 UI 使用。

    1. 本地：调 Ollama /api/tags 列出本机所有已安装模型（含 platform='本地'）；
    2. 默认云端 CLOUD_MODELS 来自 config.llm_options()；
    3. 追加已接入的 llm_providers（每个 provider 的模型都列出，带 provider_id + platform）。
    """
    from app import config

    from app.models import LlmProvider

    # 本地多模型 + 默认云端清单（config.llm_options 里本地单条跳过，避免重复）
    base = _local_ollama_options()
    for o in config.llm_options():
        if o.get("provider") != "ollama":
            base.append(o)
    providers = db.query(LlmProvider).filter(LlmProvider.user_id == current_user.id).all()
    for p in providers:
        models = [m.strip() for m in (p.models or "").split(",") if m.strip()]
        if not models:
            models = [p.model]
        platform = config.classify_platform(p.base_url, "cloud")
        for m in models:
            cw = config.context_window_of(m, "cloud")
            base.append(
                {
                    "provider": "cloud",
                    "provider_id": p.id,
                    "model": m,
                    "label": f"{p.name} · {m}",
                    "configured": True,
                    "desc": f"{p.name}（已接入）",
                    "platform": platform,
                    "context_window": cw,
                    "context_window_text": config.format_context_window(cw),
                }
            )
    return base


def _local_ollama_options() -> list[dict]:
    """调 Ollama /api/tags 列出本机所有本地模型；失败回退单个 OLLAMA_MODEL。"""
    from app import config

    try:
        import requests

        resp = requests.get(config.OLLAMA_BASE_URL.rstrip("/") + "/api/tags", timeout=5)
        resp.raise_for_status()
        models = [m.get("name", "") for m in resp.json().get("models", []) if m.get("name")]
    except Exception:
        models = []
    # 过滤掉 embedding 模型（bge-m3 等是给 RAG 用的，不是聊天模型）
    models = [m for m in models if not any(k in m.lower() for k in ("bge", "embed", "nomic"))]
    if not models:
        models = [config.OLLAMA_MODEL]
    return [
        {
            "provider": "ollama",
            "model": m,
            "label": f"本地 · {m}",
            "configured": True,
            "desc": "Ollama 本地推理，无需联网",
            "platform": "本地",
            "context_window": config.OLLAMA_NUM_CTX,
            "context_window_text": config.format_context_window(config.OLLAMA_NUM_CTX),
        }
        for m in models
    ]
