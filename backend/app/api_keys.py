"""设置面板的「API 管理」：展示当前云端 API 配置（Key 脱敏）+ 厂商官网用量页。

注意：当前云端 API 是全局共享配置（.env + config 模块），所有用户共用。
为避免 agent_manager 大重构，这里只做"展示 + 跳转到厂商用量页 + 修改入口"。
"""

from fastapi import APIRouter, Depends

from app import config as _config
from app.deps import get_current_user
from app.schemas import ApiKeyInfo

router = APIRouter(prefix="/api/api-keys", tags=["api-keys"])


def _mask(key: str) -> str:
    """脱敏：保留前缀和后 4 位，中间用 ... 代替。"""
    if not key:
        return ""
    if len(key) <= 10:
        return key[:3] + "..." + key[-2:]
    return key[:6] + "..." + key[-4:]


def _provider_info(base_url: str | None) -> tuple[str, str]:
    """根据 base_url 推断厂商名 + 官网用量监控页 URL。"""
    u = (base_url or "").lower()
    if "dashscope" in u or "aliyun" in u:
        return "阿里云百炼 (DashScope)", "https://dashscope.console.aliyun.com/"
    if "deepseek" in u:
        return "DeepSeek", "https://platform.deepseek.com/usage"
    if "bigmodel" in u or "zhipu" in u or "open.bigmodel" in u:
        return "智谱 (BigModel)", "https://bigmodel.cn/console/account"
    if "moonshot" in u or "kimi" in u:
        return "月之暗面 (Moonshot/Kimi)", "https://platform.moonshot.cn/console/personal"
    if "siliconflow" in u:
        return "硅基流动 (SiliconFlow)", "https://cloud.siliconflow.cn/account/ak"
    if "openai" in u:
        return "OpenAI", "https://platform.openai.com/usage"
    if "anthropic" in u:
        return "Anthropic Claude", "https://console.anthropic.com/settings/billing"
    if "google" in u or "gemini" in u:
        return "Google Gemini", "https://aistudio.google.com/app/apikey"
    return "自定义/其他", (base_url or "https://platform.openai.com/")


@router.get("", response_model=ApiKeyInfo)
def get_api_keys(_=Depends(get_current_user)):
    base = _config.CLOUD_BASE_URL
    key = _config.CLOUD_API_KEY or ""
    model = _config.CLOUD_MODEL
    provider, usage_url = _provider_info(base)
    return ApiKeyInfo(
        provider=provider,
        base_url=base,
        model=model,
        masked_key=_mask(key) if key else "",
        usage_url=usage_url,
        configured=bool(key and base),
    )
