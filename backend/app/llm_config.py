"""运行时接入云端大模型：把 API Key 写入 backend/.env 并即时生效，无需重启。

保存前先做一次真实连通性测试（最小化调用），Key / Base URL / 模型名任一不对
都会直接报出真实原因，避免"保存成功、对话时才报错"的糟糕体验。
Base URL 留空时默认使用 OpenAI 官方地址。
"""

import os
import socket
import subprocess
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import config
from app.deps import get_current_user

router = APIRouter(prefix="/api/llm-config", tags=["llm-config"])

DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"


class LlmConfigRequest(BaseModel):
    cloud_api_key: str = ""  # 留空 = 沿用已保存的 Key（仍会做真实测连）
    cloud_base_url: str | None = None
    cloud_model: str | None = None
    cloud_models: list[str] | None = None  # 可选：本次要保存的模型清单
    enable_thinking: bool | None = None  # 深度思考开关（None = 不改动）
    thinking_budget: int | None = None  # 思维链上限 token（0/None = 平台默认）
    trust_env: bool | None = None  # 是否绕过系统代理直连（None = 不改动）
    proxy_url: str | None = None  # 显式代理地址，如 http://127.0.0.1:7890（"" = 清空）


def _env_path() -> Path:
    # 本文件位于 backend/app/，.env 在 backend/ 下
    return Path(__file__).resolve().parent.parent / ".env"


def _update_env_file(updates: dict[str, str]) -> None:
    """更新 backend/.env 中指定 key（保留其它内容、注释与空行）。"""
    path = _env_path()
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    keys: dict[str, int] = {}
    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith("#") or "=" not in s:
            continue
        keys[s.split("=", 1)[0].strip()] = i

    new_lines = list(lines)
    for k, v in updates.items():
        if k in keys:
            new_lines[keys[k]] = f"{k}={v}"
        else:
            new_lines.append(f"{k}={v}")
    path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")


def _test_cloud(key: str, base_url: str, model: str) -> None:
    """用最小化调用验证 Key / BaseURL / 模型名是否真的可用，失败抛 ValueError。

    注意：这里【不能】带 enable_thinking（百炼对非流式调用传该参数会直接报 400）。
    网络通路与聊天完全一致（复用 agent_manager 的全局共享 http_client），
    否则会出现「测连快但聊天慢」或反过来的矛盾体验。
    """
    from langchain_openai import ChatOpenAI

    from app.agent_manager import _cloud_http_client

    llm = ChatOpenAI(
        model=model,
        api_key=key,
        base_url=base_url,
        temperature=0,
        timeout=30,
        max_retries=0,
        http_client=_cloud_http_client(),
        http_socket_options=(),
    )
    try:
        llm.invoke("hi")
    except Exception as e:  # 网络 / 鉴权失败 / 模型名不存在都会在这里暴露
        raise ValueError(f"连接云端模型失败：{e}") from e


def _test_cloud_llm() -> None:
    """按当前 config 里的值做连通性测试。"""
    _test_cloud(config.CLOUD_API_KEY, config.CLOUD_BASE_URL, config.CLOUD_MODEL)


@router.get("")
def get_cloud_config(_current_user=Depends(get_current_user)):
    """返回当前云端配置（不含 Key），供设置页预填，避免保存时把 Base URL 冲掉。"""
    thinking_ok, thinking_hint = config.classify_thinking(
        config.CLOUD_BASE_URL, config.CLOUD_MODEL
    )
    return {
        "cloud_base_url": config.CLOUD_BASE_URL or "",
        "cloud_model": config.CLOUD_MODEL,
        "cloud_models": list(config.CLOUD_MODELS),
        "enable_thinking": config.CLOUD_ENABLE_THINKING,
        "thinking_budget": config.CLOUD_THINKING_BUDGET,
        "supports_thinking": thinking_ok,
        "thinking_hint": thinking_hint,
        "trust_env": config.CLOUD_TRUST_ENV,
        "proxy_url": config.CLOUD_PROXY_URL,
        "env_proxy": _env_proxy(),
        "effective_proxy": _effective_proxy(),
    }


@router.post("")
def configure_cloud(payload: LlmConfigRequest, _current_user=Depends(get_current_user)):
    """保存云端大模型配置：先测连，通过后即时生效 + 持久化到 .env。

    cloud_api_key 留空表示沿用已保存的 Key（此时仍会做真实测连）。
    """
    if not (payload.cloud_api_key.strip() or config.CLOUD_API_KEY):
        raise HTTPException(400, "API Key 不能为空（请先填写平台申请的 Key）")

    # 记录旧值，测试失败时回滚，保证当前可用配置不被破坏
    old = (
        config.CLOUD_API_KEY,
        config.CLOUD_BASE_URL,
        config.CLOUD_MODEL,
        list(config.CLOUD_MODELS),
    )

    # 1) 按候选值更新内存中的 config 模块变量（Key 留空 = 沿用旧值）
    config.CLOUD_API_KEY = payload.cloud_api_key.strip() or config.CLOUD_API_KEY
    # Base URL：填了就用；留空则「保持当前不变」（仅当当前也没配过时才回落 OpenAI 官方）
    if payload.cloud_base_url and payload.cloud_base_url.strip():
        config.CLOUD_BASE_URL = payload.cloud_base_url.strip()
    elif not config.CLOUD_BASE_URL:
        config.CLOUD_BASE_URL = DEFAULT_OPENAI_BASE_URL
    config.CLOUD_MODEL = (payload.cloud_model.strip() if payload.cloud_model else config.CLOUD_MODEL)
    if payload.cloud_models is not None:
        models = [m.strip() for m in payload.cloud_models if m and m.strip()]
        if models:
            config.CLOUD_MODELS = models

    # 2) 真实连通性测试：失败则回滚并把真实原因返回给前端
    try:
        _test_cloud_llm()
    except ValueError as e:
        (
            config.CLOUD_API_KEY,
            config.CLOUD_BASE_URL,
            config.CLOUD_MODEL,
            config.CLOUD_MODELS,
        ) = old
        raise HTTPException(400, str(e))

    # 2.5) 深度思考开关与思考预算：与测连无关（测连非流式、不带该参数），测连通过才落值
    if payload.enable_thinking is not None:
        config.CLOUD_ENABLE_THINKING = payload.enable_thinking
    if payload.thinking_budget is not None:
        config.CLOUD_THINKING_BUDGET = max(0, int(payload.thinking_budget))
    if payload.trust_env is not None:
        config.CLOUD_TRUST_ENV = payload.trust_env
    if payload.proxy_url is not None:
        config.CLOUD_PROXY_URL = payload.proxy_url.strip()

    # 网络设置变了 → 丢弃旧的共享连接池，下次请求按新代理重建
    from app.agent_manager import reset_http_client

    reset_http_client()

    # 3) 持久化到 .env
    _update_env_file(
        {
            "CLOUD_API_KEY": config.CLOUD_API_KEY,
            "CLOUD_BASE_URL": config.CLOUD_BASE_URL or "",
            "CLOUD_MODEL": config.CLOUD_MODEL,
            "CLOUD_MODELS": ",".join(config.CLOUD_MODELS),
            "CLOUD_ENABLE_THINKING": "true" if config.CLOUD_ENABLE_THINKING else "false",
            "CLOUD_THINKING_BUDGET": str(config.CLOUD_THINKING_BUDGET),
            "CLOUD_TRUST_ENV": "true" if config.CLOUD_TRUST_ENV else "false",
            "CLOUD_PROXY_URL": config.CLOUD_PROXY_URL,
        }
    )

    return config.llm_options()


class TestRequest(BaseModel):
    cloud_api_key: str = ""
    cloud_base_url: str | None = None
    cloud_model: str | None = None


@router.post("/test")
def test_cloud_config(payload: TestRequest, _current_user=Depends(get_current_user)):
    """连通性检查：用传入配置（缺省项回落到已保存配置）做一次最小调用。

    恒返回 200；`ok=false` 时 `message` 携带真实失败原因，供前端「检查」按钮直接展示。
    返回里还带上 `thinking_supported` + `thinking_hint`：是否支持深度思考（综合模型名+平台）。
    """
    key = payload.cloud_api_key.strip() or config.CLOUD_API_KEY
    base = (payload.cloud_base_url or "").strip() or config.CLOUD_BASE_URL or DEFAULT_OPENAI_BASE_URL
    model = (payload.cloud_model or "").strip() or config.CLOUD_MODEL
    thinking_ok, thinking_hint = config.classify_thinking(base, model)
    if not key:
        return {
            "ok": False,
            "message": "尚未填写 API Key，后端也没有已保存的 Key",
            "thinking_supported": False,
            "thinking_hint": "",
        }
    try:
        _test_cloud(key, base, model)
    except ValueError as e:
        return {
            "ok": False,
            "message": str(e),
            "thinking_supported": thinking_ok,
            "thinking_hint": thinking_hint,
        }
    # 附加一句：该端点是否支持深度思考，帮用户判断开关有没有意义（用准确文案，不再武断）
    return {
        "ok": True,
        "message": f"连接成功（{model}）",
        "thinking_supported": thinking_ok,
        "thinking_hint": thinking_hint,
    }


def _env_proxy() -> str:
    """环境变量里的代理（注意：后端启动时继承，改代理后不会自动更新）。"""
    for n in (
        "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy",
    ):
        v = os.environ.get(n)
        if v:
            return v
    return ""


def _effective_proxy() -> str:
    """当前实际生效的代理（与 agent_manager.cloud_proxy_url 保持一致）。"""
    from app.agent_manager import cloud_proxy_url

    return cloud_proxy_url() or ""


def _target_host_port() -> tuple[str, int]:
    """从 CLOUD_BASE_URL 解析检测用的目标主机与端口。"""
    url = config.CLOUD_BASE_URL or "https://dashscope.aliyuncs.com"
    p = urlparse(url if "://" in url else "https://" + url)
    return (p.hostname or "dashscope.aliyuncs.com", p.port or 443)


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

    未监听的端口会立即 RST（不等待超时），故整体扫描很快。
    timeout 取 1s：监听但非代理的端口最多等 1s，避免全端口扫描拖太久。
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


@router.post("/detect-proxy")
def detect_proxy(_current_user=Depends(get_current_user)):
    """扫描本机监听端口，找出可作 HTTP 代理访问云端平台的候选，供设置页一键填入。

    背景：本机直连阿里云极慢（TLS 握手 30~46s，常超时），必须走代理才快（约 0.9s）；
    而代理软件端口常变化、又未必写入系统环境变量，后端容易一直用失效地址。
    """
    host, tport = _target_host_port()
    candidates = [f"http://127.0.0.1:{p}" for p in _listening_ports() if _is_http_proxy(p, host, tport)]
    return {
        "candidates": candidates,
        "target": f"{host}:{tport}",
        "current": config.CLOUD_PROXY_URL,
        "env_proxy": _env_proxy(),
        "effective": _effective_proxy(),
    }


@router.get("/models")
def list_remote_models(_current_user=Depends(get_current_user)):
    """【已废弃，保留兼容】按全局 CLOUD_* 拉模型列表。

    多 API 接入后，拉取模型列表必须传「当前表单的 base_url + key」，请改用
    POST /models/fetch（否则永远拉到全局 .env 那个平台的模型）。
    """
    if not (config.CLOUD_API_KEY and config.CLOUD_BASE_URL):
        raise HTTPException(400, "请先配置云端 Key 与 Base URL")
    import requests

    url = config.CLOUD_BASE_URL.rstrip("/") + "/models"
    try:
        resp = requests.get(
            url,
            headers={"Authorization": f"Bearer {config.CLOUD_API_KEY}"},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        raise HTTPException(400, f"该平台未提供 /models 列表接口或调用失败：{e}")

    items = data.get("data") if isinstance(data, dict) else None
    models: list[str] = []
    if isinstance(items, list):
        models = [
            str(it.get("id")) for it in items if isinstance(it, dict) and it.get("id")
        ]
    if not models:
        raise HTTPException(400, "接口未返回模型列表（该平台可能不支持 /models）")
    return {"models": models}


class ModelsFetchRequest(BaseModel):
    base_url: str
    api_key: str


@router.post("/models/fetch")
def fetch_remote_models(payload: ModelsFetchRequest, _current_user=Depends(get_current_user)):
    """按「当前表单填的 base_url + key」拉取该平台的模型列表。

    为什么不能用全局 config：多 API 接入后，config.CLOUD_* 只是某个平台的兜底，
    接入别的平台时必须用表单里的值，否则会拉到上一个平台的模型。
    注意：部分平台（如阿里云百炼）的 OpenAI 兼容端点【不提供】 /models 接口，
    会走到 except 分支返回可读原因，前端据此提示手动填写。
    """
    if not (payload.base_url.strip() and payload.api_key.strip()):
        raise HTTPException(400, "请先填写 API Host 与 API Key")
    import requests

    url = payload.base_url.strip().rstrip("/") + "/models"
    try:
        resp = requests.get(
            url,
            headers={"Authorization": f"Bearer {payload.api_key.strip()}"},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        raise HTTPException(400, f"该平台未提供 /models 列表接口（如阿里云百炼）或调用失败：{e}")

    items = data.get("data") if isinstance(data, dict) else None
    models: list[str] = []
    if isinstance(items, list):
        models = [
            str(it.get("id")) for it in items if isinstance(it, dict) and it.get("id")
        ]
    if not models:
        raise HTTPException(400, "接口未返回模型列表（该平台可能不支持 /models，请手动填写）")
    return {"models": models}


class ModelsUpdate(BaseModel):
    cloud_models: list[str]


@router.post("/models")
def save_models(payload: ModelsUpdate, _current_user=Depends(get_current_user)):
    """仅更新云端可选模型清单（不重测 Key），写入内存与 .env。"""
    models = [m.strip() for m in payload.cloud_models if m and m.strip()]
    if not models:
        raise HTTPException(400, "模型清单不能为空")
    config.CLOUD_MODELS = models
    _update_env_file({"CLOUD_MODELS": ",".join(models)})
    return config.llm_options()


def _fetch_ollama_tags() -> list[str]:
    """调 Ollama /api/tags 列出本机模型名，并过滤掉 embedding 模型（bge/embed/nomic）。"""
    import requests

    url = config.OLLAMA_BASE_URL.rstrip("/") + "/api/tags"
    resp = requests.get(url, timeout=5)
    resp.raise_for_status()
    names = [m.get("name", "") for m in resp.json().get("models", []) if m.get("name")]
    return [n for n in names if not any(k in n.lower() for k in ("bge", "embed", "nomic"))]


@router.get("/local-models")
def list_local_models(_current_user=Depends(get_current_user)):
    """列出本机 Ollama 已安装的聊天模型（供「设置 → 本地 Ollama」展示与管理）。"""
    try:
        models = _fetch_ollama_tags()
    except Exception as e:
        raise HTTPException(400, f"无法连接本地 Ollama（{config.OLLAMA_BASE_URL}）：{e}")
    return {
        "models": models,
        "base_url": config.OLLAMA_BASE_URL,
        "current": config.OLLAMA_MODEL,
    }


class LocalModelDelete(BaseModel):
    name: str


@router.delete("/local-models")
def delete_local_model(payload: LocalModelDelete, _current_user=Depends(get_current_user)):
    """删除本机某个 Ollama 模型（破坏性操作，前端需二次确认）。"""
    import requests

    url = config.OLLAMA_BASE_URL.rstrip("/") + "/api/delete"
    try:
        resp = requests.request(
            "DELETE", url, json={"name": payload.name.strip()}, timeout=15
        )
        resp.raise_for_status()
    except Exception as e:
        raise HTTPException(400, f"删除失败：{e}")
    return {"ok": True, "deleted": payload.name.strip()}


# ------------------------------------------------ 上下文窗口（num_ctx）可调
#
# 【系统里「上下文窗口」到底指什么】—— 澄清一下，避免混淆（详见 build_llm）：
#   · 本地 Ollama：ChatOllama(num_ctx=...) —— 这是我们唯一真正能控制的窗口，
#     它决定「模型能看到多长的对话历史 + 提示词」，等价于本地模型的上下文长度。
#   · 云端（百炼/智谱/DeepSeek…）：上下文长度由【平台 + 具体模型】决定，请求里
#     没有对应参数可调（我们的代码也没传）。云端唯一能调的是「输出上限」max_tokens，
#     目前未开放；历史消息的长度控制（截断/摘要）本项目尚未实现。
# 因此这里的「上下文窗口」= 本地 Ollama 的 num_ctx，只对本地模型生效。
CONTEXT_WINDOW_PRESETS = [2048, 4096, 8192, 16384, 32768, 65536, 131072]
CONTEXT_WINDOW_MIN = 512
CONTEXT_WINDOW_MAX = 131072


@router.get("/context-window")
def get_context_window(_current_user=Depends(get_current_user)):
    """读取「上下文窗口」当前值（本地 Ollama 的 num_ctx）+ 允许范围 + 预设。"""
    return {
        "ollama_num_ctx": config.OLLAMA_NUM_CTX,
        "presets": CONTEXT_WINDOW_PRESETS,
        "min": CONTEXT_WINDOW_MIN,
        "max": CONTEXT_WINDOW_MAX,
        "note": "仅对【本地 Ollama】生效（num_ctx）。云端模型的上下文长度由平台决定，不可调。",
    }


class ContextWindowUpdate(BaseModel):
    ollama_num_ctx: int


@router.post("/context-window")
def set_context_window(
    payload: ContextWindowUpdate, _current_user=Depends(get_current_user)
):
    """修改本地 Ollama 的上下文窗口（num_ctx），写入内存与 .env，并重建 Agent 缓存。

    注意：num_ctx 在【构建 Agent 时】读取（build_llm），所以改完必须清掉 Agent 缓存，
    否则旧会话仍在用旧的 num_ctx。清缓存后，下一条消息就用新值（无需重启）。
    """
    n = int(payload.ollama_num_ctx)
    if n < CONTEXT_WINDOW_MIN or n > CONTEXT_WINDOW_MAX:
        raise HTTPException(
            400, f"上下文窗口需在 {CONTEXT_WINDOW_MIN} ~ {CONTEXT_WINDOW_MAX} 之间"
        )
    config.OLLAMA_NUM_CTX = n
    _update_env_file({"OLLAMA_NUM_CTX": str(n)})
    # 清 Agent 缓存，让新配置在【下一条消息】即生效
    try:
        from app.agent_manager import agent_cache

        agent_cache.clear()
    except Exception:
        pass
    return {"ok": True, "ollama_num_ctx": n}
