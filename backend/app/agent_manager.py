"""Agent 工厂：按会话缓存 Agent，thread_id 隔离记忆。

本地走 langchain-ollama 的 ChatOllama（Ollama 原生 /api/chat 端点，
只有在原生端点上 think=false 才生效，关掉 qwen3 的思考可提速 3~5 倍）；
云端走 langchain-openai 的 ChatOpenAI（兼容智谱 / DeepSeek / 硅基流动 / OpenAI 官方）。
"""

import inspect

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
from app.models import Conversation, Skill
from app.tools import (
    calculator,
    get_weather,
    get_weather_forecast,
    make_notification_tools,
    make_todo_tools,
    search_web,
)

# 进程级缓存：conversation_id（以及模型/技能组合）-> 已经构建好的 agent 对象。
# 原因：每次构建 agent 都要初始化大模型、绑定工具，开销不小；同一个会话
# 重复提问时直接复用缓存即可，避免反复创建。
agent_cache: dict[int, object] = {}  # conversation_id -> agent


def build_llm(provider: str | None = None, model: str | None = None):
    """按 provider/model 构造大模型实例；缺省用全局 LLM_PROVIDER 配置。

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
    if not (config.CLOUD_API_KEY and config.CLOUD_BASE_URL):
        raise ValueError("云端模型未配置：请在 backend/.env 设置 CLOUD_API_KEY 与 CLOUD_BASE_URL")
    # 云端方案：langchain-openai 的 ChatOpenAI 兼容 OpenAI / 智谱 / DeepSeek / 硅基流动等。
    from langchain_openai import ChatOpenAI

    kwargs = {
        "model": model or config.CLOUD_MODEL,
        "api_key": config.CLOUD_API_KEY,
        "temperature": 0,
    }
    if config.CLOUD_BASE_URL:
        kwargs["base_url"] = config.CLOUD_BASE_URL
    return ChatOpenAI(**kwargs)


def _create_agent(llm, tools, system_prompt: str | None = None):
    """兼容不同 langgraph 版本的系统提示词参数名。

    这是真正"组装"智能体的地方：把 大模型(llm) + 工具(tools) + 系统提示词
    交给 create_react_agent，并挂上 MemorySaver 作为记忆。
    """
    prompt = system_prompt or config.SYSTEM_PROMPT
    # 不同 langgraph 版本里，系统提示词这个参数可能叫 "prompt" 或 "state_modifier"，
    # 用 inspect 检查函数签名，自动适配，避免版本升级后直接报错。
    params = inspect.signature(create_react_agent).parameters
    if "prompt" in params:
        # create_react_agent(大脑, 工具, 系统提示词, 记忆) —— 返回的就是可调用 agent
        return create_react_agent(llm, tools, prompt=prompt, checkpointer=MemorySaver())
    if "state_modifier" in params:
        return create_react_agent(
            llm, tools, state_modifier=prompt, checkpointer=MemorySaver()
        )
    # 兜底：不传系统提示词，只给模型和工具
    return create_react_agent(llm, tools, checkpointer=MemorySaver())


def get_agent_for_conversation(
    conversation_id: int, user_id: int, provider: str | None = None, model: str | None = None
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

        provider = (provider or config.LLM_PROVIDER).strip().lower()
        model = model or (config.OLLAMA_MODEL if provider == "ollama" else config.CLOUD_MODEL)
        # 缓存键 = (会话, 模型供应方, 具体模型, 已启用技能) —— 任何一个变了都要重建
        cache_key = (conversation_id, provider, model, active_ids_sorted)
        if cache_key in agent_cache:
            return agent_cache[cache_key]

        # 构建"大脑"
        llm = build_llm(provider, model)
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

        # 组装工具箱：通用工具 + 按当前用户隔离的"待办"工具 + "通知"工具
        tools = (
            [calculator, get_weather, get_weather_forecast, search_web]
            + make_todo_tools(user_id)
            + make_notification_tools(user_id)
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
