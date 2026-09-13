"""Agent 工厂：按会话缓存 Agent，用 thread_id（= 会话 id）隔离记忆。

本地走 langchain-ollama 的 ChatOllama（Ollama 原生 /api/chat 端点，
只有在原生端点上 think=false 才生效，关掉 qwen3 的思考可提速 3~5 倍）；
云端走 langchain-openai 的 ChatOpenAI（兼容阿里云百炼 / 智谱 / DeepSeek / 硅基流动 / OpenAI 官方）。

关于记忆（重要）：
  记忆由模块级唯一的 _CHECKPOINTER（MemorySaver）承载，所有 Agent 共用同一份，
  按 thread_id 天然隔离到各自会话。这样"切换模型 / 技能 / 知识库"导致 Agent 重建时，
  对话历史仍然接得上（若每个 Agent 各建一份记忆，一换模型就会"失忆"）。
  缓存键 = (会话 id, provider, model, 启用技能, 参与检索的知识库)，任一变化才重建 Agent。
"""

import inspect
import os
import socket
import subprocess
from urllib.parse import urlparse

import httpx

# ── LangGraph 的两个核心 import ──
# MemorySaver：LangGraph 提供的"内存检查点"。它会在 agent 运行结束后，
# 把这一轮对话的状态（消息列表）保存进内存，下一次同一个会话再调用时
# 就能"接着聊"，实现会话记忆（多轮上下文）。
from langgraph.checkpoint.memory import MemorySaver
# create_react_agent：LangGraph 预置的"ReAct 智能体"工厂函数。
# ReAct = Reasoning（推理）+ Acting（行动）。它会自动循环做一件事：
#   1) 让大模型看当前消息，决定"是直接回答"还是"先调用某个工具"；
#   2) 如果需要，调用工具，把工具结果放回消息里；
#   3) 再让模型看，直到模型给出最终回答。
# 我们不用自己写循环，只要把"模型 + 工具 + 系统提示词"交给它即可。
from langgraph.prebuilt import create_react_agent

from app import config
from app.database import SessionLocal
from app.models import Conversation, LlmProvider, Skill
from app.tools import (
    calculator,
    get_weather,
    get_weather_forecast,
    make_kb_tools,
    make_notification_tools,
    make_todo_tools,
    search_web,
)

# 进程级缓存：conversation_id（以及模型/技能组合）-> 已经构建好的 agent 对象。
# 原因：每次构建 agent 都要初始化大模型、绑定工具，开销不小；同一个会话
# 重复提问时直接复用缓存即可，避免反复创建。
agent_cache: dict[int, object] = {}  # conversation_id -> agent

# 全局共享一个 MemorySaver：所有 Agent（包括切换模型 / 技能 / 知识库后重建的）共用同一份记忆，
# 这样"换模型"时对话历史不会丢。记忆按 thread_id（= 会话 id）天然隔离，不同会话互不干扰。
_CHECKPOINTER = MemorySaver()

# 云端专用 HTTP 客户端（模块级单例，懒创建）。
#
# 【踩坑记录 · 极其重要】首字延迟 42s → 1s 的真正原因：
#   1) langchain-openai 会为 http_socket_options 注入自定义 httpx transport，
#      该行为【禁用 httpx 的代理自动探测】——所以只改 http_client(trust_env=True) 没用；
#   2) 本机（及多数国内网络）装有代理软件（HTTP_PROXY=127.0.0.1:xxxx），
#      且访问阿里云【必须经代理】才能建立 TLS。强制直连会反复握手超时：
#      实测首字 31~58s、频繁 ConnectTimeout（用户感知为"又慢又报错"）。
#   ✅ 解法：显式给 ChatOpenAI 传 openai_proxy=系统代理，首字稳定在 1~3s。
#   ⚠️ 注意 openai_proxy 与 http_client 互斥（同时传会 pydantic 报错），
#      故走代理时不再传 http_client，只保留 openai_proxy。
#      若某网络需要直连（无代理 / 代理缓冲 SSE），把 .env 的 CLOUD_TRUST_ENV 设为 true。
_CLOUD_HTTP: httpx.Client | None = None
# 当前共享 client 所用的代理地址（用于检测配置变化后自动重建）
_CLOUD_PROXY_USED: str | None = None
# 自动检测到的可用代理（本机代理软件端口常变，启动预热失败时扫描得到，优先于可能失效的环境变量）
_AUTO_PROXY: str | None = None


def _target_host_port() -> tuple[str, int]:
    """从 CLOUD_BASE_URL 解析检测用的目标主机与端口。"""
    url = config.CLOUD_BASE_URL or "https://open.bigmodel.cn"
    p = urlparse(url if "://" in url else "https://" + url)
    return (p.hostname or "open.bigmodel.cn", p.port or 443)


def _listening_ports() -> list[int]:
    """用 netstat 列出本机 LISTENING 的 TCP 端口（仅回环 / 通配地址）。"""
    try:
        out = subprocess.run(
            ["netstat", "-ano", "-p", "tcp"],
            capture_output=True,
            text=True,
            timeout=20,
            encoding="utf-8",
            errors="ignore",
        ).stdout
    except Exception:
        return []
    ports: set[int] = set()
    for line in out.splitlines():
        if "LISTENING" not in line.upper():
            continue
        parts = line.split()
        if len(parts) < 2 or ":" not in parts[1]:
            continue
        ip, _, port = parts[1].rpartition(":")
        if not port.isdigit():
            continue
        p = int(port)
        # 端口范围 0~65535；代理软件常随机取高端口（如 65262、57563），上限必须到 65535
        if ip in ("127.0.0.1", "0.0.0.0", "[::1]", "[::]") and 1024 < p <= 65535:
            ports.add(p)
    return sorted(ports)


def _is_http_proxy(port: int, host: str, tport: int, timeout: float = 1.0) -> bool:
    """向 127.0.0.1:port 发 CONNECT，判断它是否为可用 HTTP 代理。

    未监听的端口会立即 RST（不等待超时）；监听但非代理的端口最多等 timeout 秒。
    timeout 取 1s，避免全端口扫描拖太久（只在代理失效时才会触发扫描）。
    """
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout) as s:
            s.settimeout(timeout)
            s.sendall(
                (
                    f"CONNECT {host}:{tport} HTTP/1.1\r\n"
                    f"Host: {host}:{tport}\r\n"
                    f"Proxy-Connection: keep-alive\r\n\r\n"
                ).encode()
            )
            resp = s.recv(64).decode(errors="ignore")
        return resp.startswith("HTTP/1.0 200") or resp.startswith("HTTP/1.1 200")
    except Exception:
        return False


def _auto_find_proxy() -> str | None:
    """扫描本机监听端口，找出能 CONNECT 到云端平台的可用 HTTP 代理。"""
    host, tport = _target_host_port()
    for p in _listening_ports():
        if _is_http_proxy(p, host, tport):
            return f"http://127.0.0.1:{p}"
    return None


def cloud_proxy_url() -> str | None:
    """当前应使用的代理地址（供 httpx.Client 的 proxy 参数）。

    优先级：显式配置 CLOUD_PROXY_URL > 自动检测结果 > 环境变量 HTTPS_PROXY/HTTP_PROXY 等 > 直连。
    CLOUD_TRUST_ENV=true（用户明确要求直连）时直接返回 None。

    环境变量为何不可靠：它由进程启动时继承，代理软件改端口后不会更新，
    后端起进程时抓到的地址可能已失效 —— 这正是"每次提问要等一两分钟"的常见原因。
    因此支持显式填写，并在启动预热失败时自动扫描本机可用代理（_AUTO_PROXY）。
    """
    if config.CLOUD_TRUST_ENV:
        return None
    if config.CLOUD_PROXY_URL:
        return config.CLOUD_PROXY_URL
    if _AUTO_PROXY:
        return _AUTO_PROXY
    return (
        os.environ.get("HTTPS_PROXY")
        or os.environ.get("https_proxy")
        or os.environ.get("HTTP_PROXY")
        or os.environ.get("http_proxy")
        or os.environ.get("ALL_PROXY")
        or os.environ.get("all_proxy")
    )


def _cloud_http_client() -> httpx.Client:
    """模块级【全局共享】的云端 HTTP 客户端（关键性能组件）。

    ⚠️ 为什么必须共享 + 长保活：
      httpx 连接池默认 keepalive_expiry=5s，空闲即断；而走代理重新建连极慢
      （实测冷建连 20~40s、热请求 0.9s）。用户"打字→发送"的间隔通常 >5s，
      于是每次提问都在重新握手 —— 这就是"时快时慢、常常要等很久"的根因。
      故全局共享同一 client 并把保活延长到 10 分钟。

    ⚠️ 显式传 proxy 而非依赖环境变量自动探测：langchain-openai 会注入自定义
      transport 破坏 httpx 的代理自动探测（其 stderr 有明确警告）。

    代理地址变化时（用户在设置页改了代理）自动重建 client，无需重启后端。
    """
    global _CLOUD_HTTP, _CLOUD_PROXY_USED
    proxy = cloud_proxy_url()
    if _CLOUD_HTTP is not None and _CLOUD_PROXY_USED != proxy:
        try:
            _CLOUD_HTTP.close()
        except Exception:
            pass
        _CLOUD_HTTP = None
    if _CLOUD_HTTP is None:
        _CLOUD_HTTP = httpx.Client(
            proxy=proxy,  # None = 直连
            trust_env=False,  # 已显式决定，不再读环境变量，行为可预期
            timeout=httpx.Timeout(180.0, connect=30.0),
            limits=httpx.Limits(
                max_keepalive_connections=16,
                max_connections=32,
                keepalive_expiry=600.0,  # 10 分钟：大幅降低重建连接概率
            ),
        )
        _CLOUD_PROXY_USED = proxy
    return _CLOUD_HTTP


def reset_http_client() -> None:
    """丢弃当前共享 client（改代理 / 改直连设置后调用，下次请求按新配置重建）。"""
    global _CLOUD_HTTP, _CLOUD_PROXY_USED
    if _CLOUD_HTTP is not None:
        try:
            _CLOUD_HTTP.close()
        except Exception:
            pass
    _CLOUD_HTTP = None
    _CLOUD_PROXY_USED = None


def warm_up_cloud() -> None:
    """预热云端连接：调一次轻量接口，把代理/TLS 链路先建好。

    这样重启后端后的第一条消息不必承担建连开销（冷建连 20~40s vs 热请求 0.9s）。
    失败静默（未配置 Key / 网络不通时不应影响启动）。

    多 API：优先用 .env 的 CLOUD_*；若已清空，则取 llm_providers 表第一个 provider。
    关键增强：若预热失败，很可能是当前代理已失效（本机代理软件端口常变），
    此时自动扫描本机可用代理并重建共享 client，让后续请求走新代理而非慢速直连。
    """
    global _AUTO_PROXY

    key = config.CLOUD_API_KEY
    base = config.CLOUD_BASE_URL
    if not (key and base):
        # 旧单配置已清空：取第一个已接入的 provider
        from app.database import SessionLocal
        from app.models import LlmProvider

        try:
            db = SessionLocal()
            p = db.query(LlmProvider).order_by(LlmProvider.id.asc()).first()
            if p:
                key, base = p.api_key, p.base_url
        finally:
            db.close()
    if not (key and base):
        return
    url = base.rstrip("/") + "/models"
    headers = {"Authorization": f"Bearer {key}"}
    try:
        _cloud_http_client().get(url, headers=headers, timeout=20.0)
        return
    except Exception:
        # 预热失败：尝试自动检测可用代理（无显式 CLOUD_PROXY_URL 时才做，尊重用户手动配置）
        if not config.CLOUD_PROXY_URL:
            auto = _auto_find_proxy()
            if auto and auto != cloud_proxy_url():
                _AUTO_PROXY = auto
                reset_http_client()
                try:
                    _cloud_http_client().get(url, headers=headers, timeout=20.0)
                except Exception:
                    pass  # 自动恢复也失败：保持直连/环境变量，不阻断启动


def build_llm(
    provider: str | None = None,
    model: str | None = None,
    enable_thinking: bool | None = None,
    thinking_budget: int | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
):
    """按 provider/model 构造大模型实例；缺省用全局 LLM_PROVIDER 配置。

    api_key / base_url：多 API 接入时由调用方传入（来自 llm_providers 表），
    缺省回落到 config.CLOUD_* 默认值（兼容旧数据与未接入 provider 的场景）。

    enable_thinking：云端思考开关。
      - None = 完全不附加该参数（测连 / 非流式调用必须如此，否则百炼报
        「parameter.enable_thinking must be set to false for non-streaming calls」）；
      - True/False = 流式请求携带 extra_body {"enable_thinking": ...}。
    thinking_budget：思维链最大 token 数（>0 时才传，0/None = 用平台默认）。
    两者都只在「阿里云百炼」类 base_url 上附加（见 config.supports_thinking），
    其它平台（DeepSeek 官方 / 智谱 / OpenAI）传未知参数有被拒风险。

    返回的其实是一个 LangChain 的 "ChatModel"（聊天模型）对象，
    它能接收消息列表、返回回复，并且可以被 create_react_agent 当作"大脑"使用。
    """
    provider = (provider or config.LLM_PROVIDER).strip().lower()

    if provider == "ollama":
        # 本地部署方案：从 langchain-ollama 包导入 ChatOllama 封装类。
        from langchain_ollama import ChatOllama

        # kwargs 就是传给 ChatOllama 的初始化参数：
        kwargs = {
            "model": model or config.OLLAMA_MODEL,       # 用哪个本地模型，如 qwen3:8b
            "base_url": config.OLLAMA_BASE_URL,          # Ollama 服务地址
            "temperature": 0,                             # 温度=0：尽量确定、不胡编
            "num_ctx": config.OLLAMA_NUM_CTX,            # 上下文窗口大小
        }
        # 关闭思考。不同版本参数名不同：
        #   langchain-ollama >= 1.0：reasoning（None 时思考内容会以 <think> 标签混进正文，必须显式关掉）
        #   langchain-ollama 0.3.x：think
        # 这里用 getattr 检查 ChatOllama 当前版本支持哪个参数名，避免硬编码报错。
        fields = getattr(ChatOllama, "model_fields", {})
        if "reasoning" in fields:
            kwargs["reasoning"] = config.OLLAMA_THINK
        elif "think" in fields:
            kwargs["think"] = config.OLLAMA_THINK
        return ChatOllama(**kwargs)

    # 云端 OpenAI 兼容平台：必须已配置 Key 与 BaseURL
    cloud_key = api_key or config.CLOUD_API_KEY
    cloud_base = base_url or config.CLOUD_BASE_URL
    if not (cloud_key and cloud_base):
        raise ValueError("云端模型未配置：请在设置里接入 API，或到 backend/.env 设置 CLOUD_API_KEY 与 CLOUD_BASE_URL")
    # 云端方案：langchain-openai 的 ChatOpenAI 兼容 OpenAI / 智谱 / DeepSeek / 硅基流动等。
    from langchain_openai import ChatOpenAI

    kwargs = {
        "model": model or config.CLOUD_MODEL,
        "api_key": cloud_key,
        "temperature": 0,
        # 开启流式：agent.stream(stream_mode="messages") 才能逐 token 推给前端，
        # 否则整段生成完才一次性吐出，前端长时间空白、像"不回复"。
        "streaming": True,
        "timeout": 180,   # 单次请求超时（秒），避免云端卡死时无期限挂起
        "max_retries": 2,  # 失败自动重试次数
    }
    # 网络通路（决定 0.9s 还是 40s 的关键）：
    #   统一使用【模块级共享】的 http_client —— 代理已显式配在 client 上，
    #   连接池全局复用且保活 10 分钟，避免每次提问重建 TLS（默认仅 5s 保活，最致命）。
    #   http_socket_options=() 用于阻止 langchain-openai 注入自定义 transport
    #   （那会破坏我们显式配置的代理）。
    #   ⚠️ 不要再传 openai_proxy：它与 http_client 互斥，且每次新建 client、无法复用连接。
    kwargs["http_client"] = _cloud_http_client()
    kwargs["http_socket_options"] = ()
    kwargs["base_url"] = cloud_base
    # 思考开关/思考预算：仅对阿里云百炼类域名透传（Qwen 系专有参数）
    if enable_thinking is not None and config.supports_thinking(cloud_base):
        extra: dict = {"enable_thinking": bool(enable_thinking)}
        if enable_thinking and thinking_budget and thinking_budget > 0:
            # 限制思维链长度，避免模型无限推理导致长时间等待
            extra["thinking_budget"] = int(thinking_budget)
        kwargs["extra_body"] = extra
    return ChatOpenAI(**kwargs)


def _create_agent(llm, tools, system_prompt: str | None = None):
    """兼容不同 langgraph 版本的系统提示词参数名。

    这是真正"组装"智能体的地方：把 大模型(llm) + 工具(tools) + 系统提示词
    交给 create_react_agent，并挂上 MemorySaver 作为记忆。
    """
    prompt = system_prompt or config.SYSTEM_PROMPT
    # 不同 langgraph 版本里，系统提示词这个参数可能叫 "prompt" 或 "state_modifier"，
    # 用 inspect 检查函数签名，自动适配，避免版本升级后直接报错。
    # checkpointer 统一用全局共享的 _CHECKPOINTER（见文件头），保证换模型不丢历史。
    params = inspect.signature(create_react_agent).parameters
    if "prompt" in params:
        # create_react_agent(大脑, 工具, 系统提示词, 记忆) —— 返回的就是可调用 agent
        return create_react_agent(llm, tools, prompt=prompt, checkpointer=_CHECKPOINTER)
    if "state_modifier" in params:
        return create_react_agent(
            llm, tools, state_modifier=prompt, checkpointer=_CHECKPOINTER
        )
    # 兜底：不传系统提示词，只给模型和工具
    return create_react_agent(llm, tools, checkpointer=_CHECKPOINTER)


def get_agent_for_conversation(
    conversation_id: int,
    user_id: int,
    provider: str | None = None,
    model: str | None = None,
    enable_thinking: bool | None = None,
    thinking_budget: int | None = None,
):
    """获取（或复用）某个会话对应的智能体。

    这是对外的主要入口：chat.py 每次收到提问都会调用它。它会：
      1) 先查缓存，命中就直接返回（省去重建开销）；
      2) 否则查数据库拿到该会话的"模型/技能"配置，构建带记忆的 agent 并缓存。
    """
    # 同一会话切换模型或启用技能变化时，缓存键要变，自动重建对应 Agent
    db = SessionLocal()
    try:
        # 只查"属于当前用户"的会话，防止越权访问别人的会话
        conv = (
            db.query(Conversation)
            .filter(Conversation.id == conversation_id, Conversation.user_id == user_id)
            .first()
        )
        # 取该会话启用的技能 id 列表
        active_ids = list(conv.active_skill_ids or []) if conv else []
        # 再查这些技能的真实记录（并过滤掉被关闭的、不属于自己的）
        active_skills = (
            db.query(Skill)
            .filter(Skill.id.in_(active_ids), Skill.user_id == user_id, Skill.is_enabled.is_(True))
            .order_by(Skill.id.asc())
            .all()
            if active_ids
            else []
        )
        active_ids_sorted = tuple(s.id for s in active_skills)
        # 本次对话启用（参与检索）的知识库；空元组 = 不限制（检索全部库）
        active_kb_ids = tuple(int(x) for x in (conv.active_kb_ids or [])) if conv else ()

        # 多 API 接入：会话若指定了 provider_id，则用该 provider 的凭据/模型；
        # 否则回落到全局 CLOUD_*；若 CLOUD_* 也已清空（旧单配置已删除），
        # 则回退到该用户「第一个已接入的 provider」，保证旧会话仍可用。
        pvid = getattr(conv, "provider_id", None) if conv else None
        provider_row: LlmProvider | None = None
        if pvid:
            provider_row = (
                db.query(LlmProvider)
                .filter(LlmProvider.id == pvid, LlmProvider.user_id == user_id)
                .first()
            )
        provider = (provider or config.LLM_PROVIDER).strip().lower()
        if provider_row is None and provider != "ollama" and not config.CLOUD_API_KEY:
            # 兜底：旧会话未指定 provider 且 .env 已无默认云端配置 → 用第一个已接入的 provider
            provider_row = (
                db.query(LlmProvider)
                .filter(LlmProvider.user_id == user_id)
                .order_by(LlmProvider.id.asc())
                .first()
            )
        if provider_row:
            model = model or provider_row.model
        else:
            model = model or (config.OLLAMA_MODEL if provider == "ollama" else config.CLOUD_MODEL)
        # 思考开关参与缓存：用户在设置里切换「深度思考」后，旧 Agent 必须重建才带新配置。
        # 本地 Ollama 的思考由 OLLAMA_THINK 独立控制，不随此开关变，恒记 False。
        thinking_flag = bool(enable_thinking) if provider != "ollama" else False
        # 思考预算也参与缓存（开思考时才生效；改预算同样要重建）
        budget = int(thinking_budget or 0) if thinking_flag else 0
        # 缓存键 = (会话, 模型供应方, 具体模型, 已启用技能, 已启用知识库, 思考开关, 思考预算, provider_id)
        # —— 任何一个变了都要重建
        cache_key = (
            conversation_id,
            provider,
            model,
            active_ids_sorted,
            active_kb_ids,
            thinking_flag,
            budget,
            pvid,
        )
        if cache_key in agent_cache:
            return agent_cache[cache_key]

        # 构建"大脑"（云端时按开关透传 enable_thinking / thinking_budget；Ollama 路径不涉及）
        # 多 API：provider_row 存在时传入其 key/base_url
        llm = build_llm(
            provider,
            model,
            enable_thinking=None if provider == "ollama" else thinking_flag,
            thinking_budget=budget,
            api_key=provider_row.api_key if provider_row else None,
            base_url=provider_row.base_url if provider_row else None,
        )
        system_prompt = config.SYSTEM_PROMPT
        # 若启用了技能，把每个技能的说明/prompt 拼到系统提示词后面，让模型"带上技能"回答
        if active_skills:
            extra = (
                "\n\n当前会话已启用以下技能，请在回答中综合运用：\n"
                + "\n\n".join(
                    f"【{s.name}】{s.description or ''}\n{s.prompt}" for s in active_skills
                )
            )
            system_prompt = config.SYSTEM_PROMPT + extra

        # 组装工具箱：通用工具 + 按当前用户隔离的"待办"工具 + "通知"工具 + "知识库检索"工具
        tools = (
            [calculator, get_weather, get_weather_forecast, search_web]
            + make_todo_tools(user_id)
            + make_notification_tools(user_id)
            + make_kb_tools(user_id, list(active_kb_ids))
        )
        # 交给 _create_agent 组装出带记忆的 ReAct 智能体
        agent = _create_agent(llm, tools, system_prompt)

        agent_cache[cache_key] = agent
        return agent
    finally:
        db.close()


def evict_agent(conversation_id: int):
    """删除会话时清理对应 Agent（含各模型变体），释放内存中的对话记忆。

    因为缓存键第一维就是 conversation_id，遍历所有键、凡是同一个会话的都清掉。
    这样删除会话后，它占用的内存和"记忆"就不会泄漏。
    """
    for key in [k for k in agent_cache if k[0] == conversation_id]:
        agent_cache.pop(key, None)


def clear_conversation_memory(conversation_id: int):
    """清掉某会话在共享记忆里的历史（仅"删除会话"时调用，避免内存泄漏）。

    注意：切换模型 / 技能 / 知识库时【不要】调用，否则会把对话历史清掉。
    """
    try:
        _CHECKPOINTER.delete_thread(str(conversation_id))
    except Exception:
        pass
