"""FastAPI 入口：装配 app、注册路由、CORS、启动建表。"""

import asyncio
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import router as auth_router
from app.calendar_api import router as calendar_router
from app.chat import router as chat_router
from app.database import init_db
from app.files import router as files_router
from app.kb import router as kb_router
from app.llm_config import router as llm_config_router
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
app.include_router(chat_router)
app.include_router(calendar_router)
app.include_router(notes_router)
app.include_router(schedules_router)
app.include_router(courses_router)


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
def llm_options():
    """可选模型清单（含是否已配置），供前端切换模型 UI 使用。"""
    from app import config

    return config.llm_options()
