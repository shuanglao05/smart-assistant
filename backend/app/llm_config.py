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


@router.post("")
def configure_cloud(payload: LlmConfigRequest, _current_user=Depends(get_current_user)):
    """保存云端大模型配置：先测连，通过后即时生效 + 持久化到 .env。"""
    if not payload.cloud_api_key.strip():
        raise HTTPException(400, "API Key 不能为空")

    # 记录旧值，测试失败时回滚，保证当前可用配置不被破坏
    old = (config.CLOUD_API_KEY, config.CLOUD_BASE_URL, config.CLOUD_MODEL)

    # 1) 按候选值更新内存中的 config 模块变量（Base URL 留空 -> 默认 OpenAI 官方）
    config.CLOUD_API_KEY = payload.cloud_api_key.strip()
    config.CLOUD_BASE_URL = (
        payload.cloud_base_url.strip() if payload.cloud_base_url else ""
    ) or DEFAULT_OPENAI_BASE_URL
    config.CLOUD_MODEL = (payload.cloud_model.strip() if payload.cloud_model else config.CLOUD_MODEL)

    # 2) 真实连通性测试：失败则回滚并把真实原因返回给前端
    try:
        _test_cloud_llm()
    except ValueError as e:
        config.CLOUD_API_KEY, config.CLOUD_BASE_URL, config.CLOUD_MODEL = old
        raise HTTPException(400, str(e))

    # 3) 持久化到 .env
    _update_env_file(
        {
            "CLOUD_API_KEY": config.CLOUD_API_KEY,
            "CLOUD_BASE_URL": config.CLOUD_BASE_URL or "",
            "CLOUD_MODEL": config.CLOUD_MODEL,
        }
    )

    return config.llm_options()
