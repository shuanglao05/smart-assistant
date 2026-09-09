"""天气查询接口：供前端天气卡片直接调用，独立于对话。

逻辑复用 tools.get_weather（OpenWeatherMap，城市名用英文），按用户鉴权。
未配置 OPENWEATHERMAP_API_KEY 时返回提示文本，前端显示为错误态。
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from app.deps import get_current_user
from app.tools import get_weather, get_weather_forecast

router = APIRouter(prefix="/api/weather", tags=["weather"])


@router.get("")
def weather(
    city: str = Query(..., min_length=1, description="城市名，支持中文或英文，如 北京 / Beijing"),
    mode: str = Query("now", description="now=当前实况 / forecast=未来预报"),
    days: int = Query(3, ge=1, le=4, description="预报天数，1~4（含今天），仅 forecast 生效"),
    current_user=Depends(get_current_user),
):
    if mode == "forecast":
        result = get_weather_forecast.invoke({"city": city, "days": days})
    else:
        result = get_weather.invoke({"city": city})
    return {"city": city, "mode": mode, "result": result}
