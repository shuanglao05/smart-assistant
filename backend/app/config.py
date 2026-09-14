"""集中配置：所有环境变量只在这里读取，其它模块统一 `from app.config import xxx`。

切换大模型只需改 .env 里的 LLM_PROVIDER：
    ollama -> 本地 Ollama（langchain-ollama，走原生 /api/chat）
    cloud  -> 云端 OpenAI 兼容平台（langchain-openai）
业务代码不需要任何改动。
"""

import os
import re
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _get_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


# ---------------------------------------------------------------- 数据目录
# 所有运行时数据统一放数据目录下，便于备份、迁移与清理：
#   <DATA_DIR>/app.db        SQLite 数据库（含 -wal / -shm）
#   <DATA_DIR>/uploads/      用户上传的原始文件（按 u{user_id}/ 分目录）
#   <DATA_DIR>/cache/        磁盘缓存（节假日等，随时可删）
# 位置可用 .env 的 DATA_DIR 指定（建议绝对路径）；留空 = 默认 backend/data。
# 改 DATA_DIR 需【重启后端】生效（本模块在导入时确定路径）。
DEFAULT_DATA_DIR = (Path(__file__).resolve().parent.parent / "data").resolve()
_env_data_dir = os.getenv("DATA_DIR", "").strip()
DATA_DIR = Path(_env_data_dir).expanduser().resolve() if _env_data_dir else DEFAULT_DATA_DIR
DATA_UPLOADS = DATA_DIR / "uploads"
DATA_CACHE = DATA_DIR / "cache"
for _d in (DATA_DIR, DATA_UPLOADS, DATA_CACHE):
    _d.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------- 安全 / JWT
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

# ---------------------------------------------------------------- 数据库
# 默认落在 data/app.db（绝对路径，不受启动目录影响）；仍可用 .env 的 DATABASE_URL 覆盖。
DATABASE_URL = os.getenv("DATABASE_URL", "").strip() or (
    "sqlite:///" + (DATA_DIR / "app.db").as_posix()
)

# ---------------------------------------------------------------- 大模型
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama").strip().lower()

# 本地 Ollama
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:8b")
OLLAMA_THINK = _get_bool("OLLAMA_THINK", False)
OLLAMA_NUM_CTX = int(os.getenv("OLLAMA_NUM_CTX", "8192"))

def _clean_env(name: str, default: str = "") -> str:
    """读取环境变量并清理「行内注释污染」。

    python-dotenv 不支持行内注释：`KEY=值  # 说明` 会把整段（含 # 说明）当成值。
    曾因此把 CLOUD_MODEL 读成 "# 【留空】旧版单配置默认模型"，导致 cloud_configured
    假阳性为 True、旧模型全部冒出来。这里做防御：值以 # 开头直接视为空；
    值中含 " #" 时只取 # 之前部分。
    """
    raw = os.getenv(name, default) or ""
    if raw.lstrip().startswith("#"):
        return ""
    if " #" in raw:
        raw = raw.split(" #", 1)[0]
    return raw.strip()


# 云端 OpenAI 兼容平台
CLOUD_API_KEY = _clean_env("CLOUD_API_KEY")
CLOUD_BASE_URL = _clean_env("CLOUD_BASE_URL") or None
CLOUD_MODEL = _clean_env("CLOUD_MODEL")

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
    """判断该 base_url 是否属于阿里云百炼（DashScope），从而支持 enable_thinking / thinking_budget 参数。

    ⚠️ 注意：这判断的是「enable_thinking 参数」这一百炼专有参数，不是「深度思考能力」。
    深度思考（推理）多个平台都支持，但方式不同（智谱 GLM-5 走 thinking 模型、DeepSeek 走
    reasoner 模型、豆包走 thinking 模型）。前端展示用 classify_thinking()，别用本函数。

    必须按「域名主体」判断，不能只看是否含 dashscope 字样：百炼的
    应用专属域名形如 https://ws-xxxx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
    （不含 "dashscope"），但同样是阿里云百炼、同样支持该参数——
    早前的 `"dashscope" in base_url` 判定导致参数一次都没发出去，思考开关形同虚设。
    """
    url = (base_url or "").lower()
    return "aliyuncs.com" in url or "dashscope" in url


def classify_thinking(base_url: str | None, model: str | None = None) -> tuple[bool, str]:
    """判断该端点/模型是否「可能支持深度思考」，返回 (是否支持, 说明文案)。

    供前端提示用，比 supports_thinking() 只看域名更准确：
      · 模型名带 thinking/reasoner/r1/o1 等 → 推理型模型，支持；
      · 按平台域名判断已知平台（百炼 qwen3 / 智谱 GLM-5 / DeepSeek）；
      · 未知平台 → 不武断说「不支持」，提示可实测。
    """
    u = (base_url or "").lower()
    m = (model or "").lower()
    if any(k in m for k in ("thinking", "reasoner", "r1", "-o1", "-o3", "o1-", "o3-")):
        return True, "该模型为推理型，支持深度思考"
    if "aliyuncs.com" in u or "dashscope" in u:
        return True, "阿里云百炼：qwen3 系列可开启深度思考（enable_thinking）"
    if "bigmodel.cn" in u:
        return True, "智谱：GLM-5.x 支持 thinking 推理模式"
    if "deepseek.com" in u:
        return True, "DeepSeek：deepseek-reasoner 支持思考"
    return False, "该端点深度思考能力未知，可实测确认是否有 reasoning_content"


def classify_platform(base_url: str | None, provider: str | None = None) -> str:
    """按 base_url 判定平台分组名，供前端模型下拉分组展示。"""
    if provider and provider.strip().lower() != "cloud":
        return "本地"
    u = (base_url or "").lower()
    if "aliyuncs.com" in u or "dashscope" in u:
        return "阿里云百炼"
    if "bigmodel.cn" in u or "zhipu" in u:
        return "智谱"
    if "api.openai.com" in u:
        return "OpenAI"
    if "deepseek.com" in u:
        return "DeepSeek"
    if "moonshot.cn" in u:
        return "月之暗面"
    if "volces.com" in u or "ark.cn" in u:
        return "豆包"
    return "其他平台"


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

# ---------------------------------------------------------------- 上下文窗口（界面标注用）
# 用于让界面标出「这个模型最多能记住多少 token（上下文窗口）」。
#   · 本地 Ollama：直接用 OLLAMA_NUM_CTX（我们显式设置的值，准确）；
#   · 云端：各平台没有统一的查询接口，这里按【模型名模糊匹配】给参考值
#     （同一模型在不同平台/版本可能略有差异，仅作提示）。
MODEL_CONTEXT_WINDOWS: list[tuple[str, int]] = [
    # 阿里云百炼 / Qwen 系
    ("qwen-flash", 1_000_000),
    ("qwen3-max", 262_144),
    ("qwen3-coder", 262_144),
    ("qwen3-vl", 131_072),
    ("qwen-max", 131_072),
    ("qwen-plus", 131_072),
    ("qwen3", 131_072),
    ("qwen", 131_072),
    # 智谱 GLM
    ("glm-5", 131_072),
    ("glm-4.6", 200_000),
    ("glm-4", 131_072),
    # DeepSeek
    ("deepseek", 131_072),
    # Kimi / Moonshot
    ("kimi", 262_144),
    ("moonshot", 131_072),
]


def context_window_of(model: str | None, provider: str | None = None) -> int | None:
    """返回模型的上下文窗口大小（token 数）；未知返回 None。

    本地 Ollama 直接返回 OLLAMA_NUM_CTX；云端按模型名模糊匹配参考表（大小写不敏感）。
    """
    if (provider or "").strip().lower() == "ollama":
        return OLLAMA_NUM_CTX
    m = (model or "").strip().lower()
    if not m:
        return None
    for key, size in MODEL_CONTEXT_WINDOWS:
        if key in m:
            return size
    return None


def format_context_window(n: int | None) -> str:
    """把 token 数格式化成易读形式：8192 → '8K'；131072 → '128K'；1000000 → '1M'。"""
    if not n:
        return "—"
    if n >= 1_000_000:
        return f"{n / 1_000_000:g}M"
    if n >= 1_000:
        return f"{n / 1024:.0f}K"
    return str(n)


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
    若 CLOUD_API_KEY 已清空（旧单配置已删除、迁移到多 API），则不输出默认云端清单，
    由 /api/llm-options 接口额外追加 llm_providers 里的模型。
    """
    cloud_configured = bool(CLOUD_API_KEY and CLOUD_BASE_URL)

    options = [
        {
            "provider": "ollama",
            "model": OLLAMA_MODEL,
            "label": f"本地 · {OLLAMA_MODEL}",
            "configured": True,
            "desc": "Ollama 本地推理，无需联网",
            "context_window": OLLAMA_NUM_CTX,
            "context_window_text": format_context_window(OLLAMA_NUM_CTX),
        }
    ]
    if not cloud_configured:
        return options  # 无默认云端配置：只返回本地，云端由多 API 追加

    models = list(CLOUD_MODELS)
    if CLOUD_MODEL and CLOUD_MODEL not in models:
        models.insert(0, CLOUD_MODEL)  # 当前模型保证可选

    for m in models:
        cw = context_window_of(m, "cloud")
        options.append(
            {
                "provider": "cloud",
                "model": m,
                "label": f"云端 · {m}",
                "configured": cloud_configured,
                "desc": "OpenAI 兼容云端大模型（需配置 Key）",
                "context_window": cw,
                "context_window_text": format_context_window(cw),
            }
        )
    return options


# ---------------------------------------------------------------- Agent 提示词
SYSTEM_PROMPT = (
    "你是一个乐于助人的中文智能个人助理。\n"
    "\n"
    "【工具使用原则】（重要）\n"
    "1. 只在用户【明确要求执行某个动作】时才调用工具；仅仅聊天、提问、陈述、\n"
    "   或顺口提到某件事（如「我要背《望岳》」「这个我不会」），一律不要调用工具，\n"
    "   直接用文字回答即可。\n"
    "2. 会【写入数据】的操作要格外谨慎——尤其是 add_todo（新增待办）和\n"
    "   notify_user（发通知）：必须用户明确表达「帮我记/加进待办」「提醒我」等意图\n"
    "   才执行；拿不准时先问一句「需要我帮你记成待办吗？」，不要擅自写入。\n"
    "3. 不要编造结果；调用了工具就基于真实返回值回答，且不要复述原始数据。\n"
    "\n"
    "【工具清单】\n"
    "- 算数：calculator\n"
    "- 天气：当前实况 get_weather；未来几天（days 1~4）get_weather_forecast；城市名支持中英文\n"
    "- 待办：用户明确要「记一条待办 / 加进待办清单」用 add_todo；明确要「看看待办」用 list_todos\n"
    "- 提醒：用户明确要「提醒我 / 发个通知」用 notify_user（title 简短）\n"
    "- 联网资料：search_web\n"
    "- 用户上传的资料/知识库（笔记、报告、说明书、规范等）：search_knowledge_base\n"
    "- 画图（流程图/时序图/关系图/柱状图/折线图）：用 ```mermaid 代码块输出"
    "（流程图 graph TD/LR，时序图 sequenceDiagram，柱状图/折线图 xychart-beta），不要用文字描述图形。\n"
    "\n"
    "回答使用简体中文，保持简洁。"
)
