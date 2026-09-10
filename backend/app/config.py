"""集中配置：所有环境变量只在这里读取，其它模块统一 `from app.config import xxx`。

切换大模型只需改 .env 里的 LLM_PROVIDER：
    ollama -> 本地 Ollama（langchain-ollama，走原生 /api/chat）
    cloud  -> 云端 OpenAI 兼容平台（langchain-openai）
业务代码不需要任何改动。
"""

import os
import re

from dotenv import load_dotenv

load_dotenv()


def _get_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


# ---------------------------------------------------------------- 安全 / JWT
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

# ---------------------------------------------------------------- 数据库
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./app.db")

# ---------------------------------------------------------------- 大模型
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama").strip().lower()

# 本地 Ollama
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:8b")
OLLAMA_THINK = _get_bool("OLLAMA_THINK", False)
OLLAMA_NUM_CTX = int(os.getenv("OLLAMA_NUM_CTX", "8192"))

# 云端 OpenAI 兼容平台
CLOUD_API_KEY = os.getenv("CLOUD_API_KEY", "")
CLOUD_BASE_URL = os.getenv("CLOUD_BASE_URL", "").strip() or None
CLOUD_MODEL = os.getenv("CLOUD_MODEL", "gpt-4o-mini")


def parse_model_list(raw: str | None) -> list[str]:
    """把 'a,b\\nc' 这类文本解析成去重、去空的模型名列表。"""
    seen: set[str] = set()
    out: list[str] = []
    for name in re.split(r"[,\n]", raw or ""):
        n = name.strip()
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


# 云端可选模型清单（逗号分隔）。前端「切换模型」下拉会逐条列出；
# 运行时可被设置面板覆盖并写回 .env。
# 注意：这里的名字要「和你接入的平台匹配」——不同平台同一个模型叫法不同
# （例：阿里云百炼是 deepseek-v3.2 / glm-5.2 / kimi-k3，而 DeepSeek 官方叫 deepseek-chat）。
_DEFAULT_CLOUD_MODELS = [
    "qwen3.8-max",   # 通义旗舰
    "qwen-max",
    "qwen-plus",     # 均衡款
    "qwen-flash",    # 快而省
    "deepseek-v4-pro",
    "deepseek-v3.2",
    "glm-5.2",
    "kimi-k3",
    "qwen3-coder-plus",  # 代码
    "qwen3-vl-plus",     # 视觉：可识别图片
]
CLOUD_MODELS: list[str] = (
    parse_model_list(os.getenv("CLOUD_MODELS", "")) or list(_DEFAULT_CLOUD_MODELS)
)

# ---------------------------------------------------------------- Embedding（RAG 知识库）
EMBED_PROVIDER = os.getenv("EMBED_PROVIDER", "ollama").strip().lower()
EMBED_BASE_URL = os.getenv("EMBED_BASE_URL", "http://localhost:11434/v1")
EMBED_MODEL = os.getenv("EMBED_MODEL", "bge-m3")

# RAG 检索参数
RAG_CHUNK_SIZE = int(os.getenv("RAG_CHUNK_SIZE", "500"))        # 每个片段的目标字符数
RAG_CHUNK_OVERLAP = int(os.getenv("RAG_CHUNK_OVERLAP", "80"))   # 相邻片段重叠字符数
RAG_TOP_K = int(os.getenv("RAG_TOP_K", "4"))                    # 检索返回的片段数

# ---------------------------------------------------------------- 外部工具 Key
# 天气：优先用高德（中文城市名、国内访问快，个人认证 5000 次/月免费）
AMAP_API_KEY = os.getenv("AMAP_API_KEY", "")
# 备用：OpenWeatherMap（英文名检索）
OPENWEATHERMAP_API_KEY = os.getenv("OPENWEATHERMAP_API_KEY", "")

# ---------------------------------------------------------------- 可选模型清单（前端切换 UI 用）
def llm_options():
    """返回可选大模型列表（含是否已配置），供前端"切换模型"下拉框使用。

    本地固定一条；云端按 CLOUD_MODELS 清单逐条输出（当前 CLOUD_MODEL 始终在列）。
    """
    cloud_configured = bool(CLOUD_API_KEY and CLOUD_BASE_URL)

    models = list(CLOUD_MODELS)
    if CLOUD_MODEL and CLOUD_MODEL not in models:
        models.insert(0, CLOUD_MODEL)  # 当前模型保证可选

    options = [
        {
            "provider": "ollama",
            "model": OLLAMA_MODEL,
            "label": f"本地 · {OLLAMA_MODEL}",
            "configured": True,
            "desc": "Ollama 本地推理，无需联网",
        }
    ]
    for m in models:
        options.append(
            {
                "provider": "cloud",
                "model": m,
                "label": f"云端 · {m}",
                "configured": cloud_configured,
                "desc": "OpenAI 兼容云端大模型（需配置 Key）",
            }
        )
    return options


# ---------------------------------------------------------------- Agent 提示词
SYSTEM_PROMPT = (
    "你是一个乐于助人的中文智能个人助理。\n"
    "当用户的需求可以用工具完成时，必须调用工具，不要自己编造结果。\n"
    "- 需要算数：用 calculator\n"
    "- 需要查天气：当前实况用 get_weather；问《未来几天/明天/后天天气》用 get_weather_forecast（days 为天数，1~4）\n"
    "  两者城市名都支持中文（如 '北京'）或英文\n"
    "- 需要记事情或查看待办：用 add_todo / list_todos\n"
    "- 需要给用户发站内提醒/通知（铃铛）：用 notify_user（title 简短，如《记得喝水》）\n"
    "- 需要查互联网资料：用 search_web\n"
    "- 需要查用户自己上传的资料/知识库（笔记、报告、说明书、规范等）：用 search_knowledge_base\n"
    "回答使用简体中文，保持简洁，不要复述工具返回的原始数据。"
)
