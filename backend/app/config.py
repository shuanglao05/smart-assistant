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

# 云端「深度思考」开关（阿里云百炼 / DashScope 思考型模型）。
# False = 关闭思考，首字快、日常问答足够；True = 先推理再回答，更透彻但明显更慢。
# 注意：enable_thinking 仅流式调用生效，因此只在聊天流式路径透传；
# 连通性测试与非流式调用一律不带该参数，避免平台报「仅流式支持」类错误。
CLOUD_ENABLE_THINKING = _get_bool("CLOUD_ENABLE_THINKING", False)

# 思维链最大 token 数（thinking_budget）：限制思考长度以免无限推理拖慢响应。
# 0 或负数 = 不传该参数（用平台默认，通常 4000）。仅思考开启时有意义。
CLOUD_THINKING_BUDGET = int(os.getenv("CLOUD_THINKING_BUDGET", "0") or 0)

# 云端请求使用哪个代理。优先级：CLOUD_PROXY_URL > 环境变量 HTTP(S)_PROXY > 直连。
#
# 【为什么需要显式配置】本机直连阿里云极慢（TLS 握手 30~46s，频繁超时），
# 必须走代理才快（0.9s）。但代理软件（Clash/v2ray 等）的端口常变化，
# 且不一定写入系统环境变量 —— 后端起进程时抓到的地址可能已失效，
# 表现为"每次提问要等一两分钟"。故支持在这里显式固定代理地址，
# 设置页提供「自动检测」按钮扫描本机可用代理并一键填入。
CLOUD_PROXY_URL = os.getenv("CLOUD_PROXY_URL", "").strip()

# 云端请求是否「绕过系统代理直连」。True = 强制直连；False = 使用上面的代理（默认）。
CLOUD_TRUST_ENV = _get_bool("CLOUD_TRUST_ENV", False)


def supports_thinking(base_url: str | None) -> bool:
    """判断该 base_url 是否属于阿里云百炼（DashScope），从而支持 enable_thinking / thinking_budget。

    必须按「域名主体」判断，不能只看是否含 dashscope 字样：百炼的
    应用专属域名形如 https://ws-xxxx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
    （不含 "dashscope"），但同样是阿里云百炼、同样支持该参数——
    早前的 `"dashscope" in base_url` 判定导致参数一次都没发出去，思考开关形同虚设。
    """
    url = (base_url or "").lower()
    return "aliyuncs.com" in url or "dashscope" in url


# 思考模式下 max_tokens 的平台上限（百炼文档：取值范围 [1, 32768]，超出报 400）
THINKING_MAX_TOKENS = 32768

# 视觉模型：用于「课表截图识别」等多模态任务（走云端 OpenAI 兼容端点）
VISION_MODEL = os.getenv("VISION_MODEL", "qwen3-vl-plus")


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
RAG_TOP_K = int(os.getenv("RAG_TOP_K", "4"))                    # 全局默认检索片段数（Top-K）
# 向量化批大小：一次发给 Ollama 的文本条数。太大易超时、太小则往返次数多。
RAG_EMBED_BATCH = int(os.getenv("RAG_EMBED_BATCH", "32"))
# 单次检索返回片段的总上限：多知识库各自取 Top-K 后合并，防止片段总数爆掉上下文。
RAG_MAX_TOTAL_CHUNKS = int(os.getenv("RAG_MAX_TOTAL_CHUNKS", "30"))

# ---------------------------------------------------------------- 文件上传 / 解析
# 单个文件大小上限（MB）。长 PDF / 教材常有几十 MB，故默认放宽到 50。
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "50"))
# 抽取正文的字符上限：既防爆上下文，也决定入库索引的文本量。
MAX_CONTENT_CHARS = int(os.getenv("MAX_CONTENT_CHARS", "500000"))

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
    "- 需要画流程图/时序图/关系图，或柱状图/折线图等图表：用 ```mermaid 代码块输出"
    "（流程图 graph TD/LR，时序图 sequenceDiagram，柱状图/折线图 xychart-beta），不要用文字描述图形。\n"
    "回答使用简体中文，保持简洁，不要复述工具返回的原始数据。"
)
