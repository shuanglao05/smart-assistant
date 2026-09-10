"""运行时接入云端大模型：把 API Key 写入 backend/.env 并即时生效，无需重启。

保存前先做一次真实连通性测试（最小化调用），Key / Base URL / 模型名任一不对
都会直接报出真实原因，避免"保存成功、对话时才报错"的糟糕体验。
Base URL 留空时默认使用 OpenAI 官方地址。
"""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import config
from app.deps import get_current_user

router = APIRouter(prefix="/api/llm-config", tags=["llm-config"])

DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"


class LlmConfigRequest(BaseModel):
    cloud_api_key: str
    cloud_base_url: str | None = None
    cloud_model: str | None = None
    cloud_models: list[str] | None = None  # 可选：本次要保存的模型清单


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


def _test_cloud_llm() -> None:
    """用最小化调用验证 Key / BaseURL / 模型名是否真的可用，失败抛 ValueError。"""
    from langchain_openai import ChatOpenAI

    llm = ChatOpenAI(
        model=config.CLOUD_MODEL,
        api_key=config.CLOUD_API_KEY,
        base_url=config.CLOUD_BASE_URL,
        temperature=0,
        timeout=15,
        max_retries=1,
        max_tokens=8,
    )
    try:
        llm.invoke("hi")
    except Exception as e:  # 网络 / 鉴权失败 / 模型名不存在都会在这里暴露
        raise ValueError(f"连接云端模型失败：{e}") from e


@router.get("")
def get_cloud_config(_current_user=Depends(get_current_user)):
    """返回当前云端配置（不含 Key），供接入弹窗预填，避免保存时把 Base URL 冲掉。"""
    return {
        "cloud_base_url": config.CLOUD_BASE_URL or "",
        "cloud_model": config.CLOUD_MODEL,
        "cloud_models": list(config.CLOUD_MODELS),
    }


@router.post("")
def configure_cloud(payload: LlmConfigRequest, _current_user=Depends(get_current_user)):
    """保存云端大模型配置：先测连，通过后即时生效 + 持久化到 .env。"""
    if not payload.cloud_api_key.strip():
        raise HTTPException(400, "API Key 不能为空")

    # 记录旧值，测试失败时回滚，保证当前可用配置不被破坏
    old = (
        config.CLOUD_API_KEY,
        config.CLOUD_BASE_URL,
        config.CLOUD_MODEL,
        list(config.CLOUD_MODELS),
    )

    # 1) 按候选值更新内存中的 config 模块变量
    config.CLOUD_API_KEY = payload.cloud_api_key.strip()
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

    # 3) 持久化到 .env
    _update_env_file(
        {
            "CLOUD_API_KEY": config.CLOUD_API_KEY,
            "CLOUD_BASE_URL": config.CLOUD_BASE_URL or "",
            "CLOUD_MODEL": config.CLOUD_MODEL,
            "CLOUD_MODELS": ",".join(config.CLOUD_MODELS),
        }
    )

    return config.llm_options()


@router.get("/models")
def list_remote_models(_current_user=Depends(get_current_user)):
    """尝试调用云端 OpenAI 兼容的 GET /models 拉取可用模型列表。

    部分平台未开放该接口；失败时前端回退到手动清单即可。
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
