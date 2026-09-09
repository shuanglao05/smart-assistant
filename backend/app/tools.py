"""Agent 工具集：计算器 / 天气 / 网页搜索 / 待办。

注意：工具的 docstring 是给大模型看的"说明书"，必须写清用途、输入格式、
返回内容，否则模型会误用或不用工具。
"""

import ast
import operator
from datetime import datetime

import requests
from langchain_core.tools import tool

from app.config import AMAP_API_KEY, OPENWEATHERMAP_API_KEY
from app.database import SessionLocal
from app.models import Notification, TodoItem

# ------------------------------------------------------------------ 安全计算器
# 用 AST 白名单解析，绝不用 eval（eval 可执行任意代码）
_ALLOWED_BINOPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.Mod: operator.mod,
    ast.FloorDiv: operator.floordiv,
}
_ALLOWED_UNARY = {ast.USub: operator.neg, ast.UAdd: operator.pos}


def _safe_eval(node):
    if isinstance(node, ast.Expression):
        return _safe_eval(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _ALLOWED_BINOPS:
        return _ALLOWED_BINOPS[type(node.op)](_safe_eval(node.left), _safe_eval(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _ALLOWED_UNARY:
        return _ALLOWED_UNARY[type(node.op)](_safe_eval(node.operand))
    raise ValueError("不支持的表达式")


# ── @tool 装饰器的作用 ──
# @tool 来自 langchain_core.tools。它把一个普通 Python 函数"包装"成大模型能识别并
# 调用的工具：函数名 + 参数类型 + docstring（"说明书"）会被自动转成工具的描述，
# 模型据此判断"什么时候该调用它、传什么参数"。所以 docstring 一定要写清楚用途与
# 输入格式，否则模型会误用或干脆不用。
@tool
def calculator(expression: str) -> str:
    """计算数学表达式。输入一个算术表达式字符串，例如 '2+3*4' 或 '(1+2)*10'，返回计算结果。"""
    try:
        # 用 AST 安全解析表达式（见文件顶部 _safe_eval），绝不用 eval，避免执行任意代码
        value = _safe_eval(ast.parse(expression.strip(), mode="eval"))
        if isinstance(value, float) and value.is_integer():
            value = int(value)
        return str(value)
    except Exception as e:
        return f"计算错误: {e}"


# ------------------------------------------------------------------ 天气
# 常用中文城市 -> OpenWeatherMap 英文名映射（OpenWeatherMap 用英文检索更可靠）
_CITY_ZH_EN = {
    "北京": "Beijing", "上海": "Shanghai", "广州": "Guangzhou", "深圳": "Shenzhen",
    "杭州": "Hangzhou", "南京": "Nanjing", "苏州": "Suzhou", "成都": "Chengdu",
    "重庆": "Chongqing", "武汉": "Wuhan", "西安": "Xi'an", "天津": "Tianjin",
    "长沙": "Changsha", "郑州": "Zhengzhou", "青岛": "Qingdao", "大连": "Dalian",
    "厦门": "Xiamen", "福州": "Fuzhou", "合肥": "Hefei", "济南": "Jinan",
    "沈阳": "Shenyang", "哈尔滨": "Harbin", "石家庄": "Shijiazhuang", "太原": "Taiyuan",
    "昆明": "Kunming", "贵阳": "Guiyang", "南宁": "Nanning", "桂林": "Guilin",
    "海口": "Haikou", "三亚": "Sanya", "兰州": "Lanzhou", "西宁": "Xining",
    "银川": "Yinchuan", "乌鲁木齐": "Urumqi", "拉萨": "Lhasa", "呼和浩特": "Hohhot",
    "无锡": "Wuxi", "宁波": "Ningbo", "温州": "Wenzhou", "东莞": "Dongguan",
    "佛山": "Foshan", "珠海": "Zhuhai", "香港": "Hong Kong", "澳门": "Macao", "台北": "Taipei",
}

# 中文城市 -> 高德 adcode（高德天气接口用 adcode 查询最可靠）
_CITY_ADCODE = {
    "北京": "110000", "上海": "310000", "广州": "440100", "深圳": "440300",
    "杭州": "330100", "南京": "320100", "苏州": "320500", "成都": "510100",
    "重庆": "500000", "武汉": "420100", "西安": "610100", "天津": "120000",
    "长沙": "430100", "郑州": "410100", "青岛": "370200", "大连": "210200",
    "厦门": "350200", "福州": "350100", "合肥": "340100", "济南": "370100",
    "沈阳": "210100", "哈尔滨": "230100", "长春": "220100", "石家庄": "130100",
    "太原": "140100", "昆明": "530100", "贵阳": "520100", "南宁": "450100",
    "桂林": "450300", "海口": "460100", "三亚": "460200", "兰州": "620100",
    "西宁": "630100", "银川": "640100", "乌鲁木齐": "650100", "拉萨": "540100",
    "呼和浩特": "150100", "南昌": "360100", "无锡": "320200", "宁波": "330200",
    "温州": "330300", "东莞": "441900", "佛山": "440600", "珠海": "440400",
    "常州": "320400", "徐州": "320300", "烟台": "370600", "洛阳": "410300",
    "香港": "810000", "澳门": "820000",
}


def _resolve_adcode(city: str) -> str:
    """把 '北京' / 'Beijing' / '110000' 统一解析成高德 adcode。"""
    c = city.strip()
    if c.isdigit():
        return c
    if c in _CITY_ADCODE:
        return _CITY_ADCODE[c]
    # 英文名反查（Beijing -> 北京 -> 110000）
    low = c.lower()
    for zh, en in _CITY_ZH_EN.items():
        if en.lower() == low:
            return _CITY_ADCODE.get(zh, c)
    return c  # 表里没有就原样交给高德按名称解析


def _amap_weather(city: str) -> str:
    """高德天气实况查询。"""
    adcode = _resolve_adcode(city)
    url = "https://restapi.amap.com/v3/weather/weatherInfo"
    try:
        resp = requests.get(
            url,
            params={"key": AMAP_API_KEY, "city": adcode, "extensions": "base"},
            timeout=10,
        )
        data = resp.json()
    except Exception as e:
        return f"天气查询失败: {e}"

    if data.get("status") != "1" or not data.get("lives"):
        # 高德在参数不合法时偶尔也返回 info=OK，避免把它显示给用户造成误导
        info = data.get("info", "")
        detail = "" if info in ("OK", "") else f"（{info}）"
        return f"未查询到「{city}」的天气{detail}，请确认城市名是否正确"

    live = data["lives"][0]
    return (
        f"{live.get('city', city)} 当前 {live.get('temperature', '?')}°C，"
        f"{live.get('weather', '未知')}，"
        f"湿度 {live.get('humidity', '?')}%，"
        f"{live.get('winddirection', '')}风 {live.get('windpower', '')}级"
    )


_WEEKDAY_CN = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


def _amap_forecast(city: str, days: int = 3) -> str:
    """高德天气预报：未来最多 4 天（含今天），粒度为"白天/夜间"（免费接口无逐小时数据）。"""
    adcode = _resolve_adcode(city)
    url = "https://restapi.amap.com/v3/weather/weatherInfo"
    try:
        resp = requests.get(
            url,
            params={"key": AMAP_API_KEY, "city": adcode, "extensions": "all"},
            timeout=10,
        )
        data = resp.json()
    except Exception as e:
        return f"天气预报查询失败: {e}"

    if data.get("status") != "1" or not data.get("forecasts"):
        info = data.get("info", "")
        detail = "" if info in ("OK", "") else f"（{info}）"
        return f"未查询到「{city}」的天气预报{detail}，请确认城市名是否正确"

    try:
        days = int(days)
    except (TypeError, ValueError):
        days = 3
    days = max(1, min(days, 4))

    city_name = data["forecasts"][0].get("city", city)
    casts = data["forecasts"][0].get("casts", [])[:days]
    lines = [f"{city_name}未来 {len(casts)} 天天气（白天/夜间）："]
    for i, c in enumerate(casts):
        date = c.get("date", "")
        try:
            wd = _WEEKDAY_CN[datetime.strptime(date, "%Y-%m-%d").weekday()]
        except Exception:
            wd = ""
        if i == 0:
            label = "今天"
        elif i == 1:
            label = "明天"
        else:
            label = f"{date[5:].replace('-', '/')} {wd}".strip()
        lines.append(
            f"- {label}：白天 {c.get('dayweather')} {c.get('daytemp')}°C / "
            f"夜间 {c.get('nightweather')} {c.get('nighttemp')}°C，"
            f"{c.get('daywind')}风 {c.get('daypower')}级"
        )
    return "\n".join(lines)


@tool
def get_weather_forecast(city: str, days: int = 3) -> str:
    """查询指定城市未来几天的天气预报。输入城市中文名（如 '北京'）和天数 days（1~4，默认 3，包含今天），返回每天白天/夜间的天气状况与气温。"""
    if not AMAP_API_KEY:
        return "未配置天气 API Key，天气预报需要在 backend/.env 中配置高德 AMAP_API_KEY"
    return _amap_forecast(city, days)


def _openweather_weather(city: str) -> str:
    """备用：OpenWeatherMap 查询（英文名）。"""
    city_en = _CITY_ZH_EN.get(city.strip(), city.strip())
    url = "https://api.openweathermap.org/data/2.5/weather"
    try:
        resp = requests.get(
            url,
            params={"q": city_en, "appid": OPENWEATHERMAP_API_KEY, "units": "metric", "lang": "zh_cn"},
            timeout=10,
        )
        data = resp.json()
    except Exception as e:
        return f"天气查询失败: {e}"

    if data.get("main"):
        return (
            f"{city_en} 当前 {data['main']['temp']}°C，"
            f"{data['weather'][0]['description']}，湿度 {data['main'].get('humidity')}%"
        )
    return f"未找到城市 '{city}' 的信息，请确认城市名是否正确"


@tool
def get_weather(city: str) -> str:
    """查询指定城市的实时天气。支持中文或英文城市名，例如 '北京'、'Beijing'，返回温度与天气描述。"""
    # 优先高德（中文城市、国内稳定），没配高德 Key 才回退 OpenWeatherMap
    if AMAP_API_KEY:
        return _amap_weather(city)
    if OPENWEATHERMAP_API_KEY:
        return _openweather_weather(city)
    return "未配置天气 API Key，请在 backend/.env 中设置 AMAP_API_KEY（推荐，高德）或 OPENWEATHERMAP_API_KEY"


# ------------------------------------------------------------------ 网页搜索（P2，可选）
@tool
def search_web(query: str) -> str:
    """搜索网页获取资料。输入搜索关键词，返回前 3 条结果的标题与摘要。"""
    try:
        from duckduckgo_search import DDGS
    except ImportError:
        return "网页搜索暂不可用：未安装 duckduckgo-search（pip install duckduckgo-search）"

    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=3))
    except Exception as e:
        return f"搜索失败: {e}"

    if not results:
        return "未找到相关结果"
    return "\n".join(f"- {r.get('title', '')}: {r.get('body', '')}" for r in results)


# ------------------------------------------------------------------ 待办（按用户隔离）
def make_todo_tools(user_id: int):
    """用工厂函数把 user_id 绑进工具，实现多用户数据隔离。

    为什么用"工厂函数"而不是普通 @tool？
    因为工具函数里需要写数据库，而写库时必须知道"这是哪个用户的数据"。
    直接把 user_id 作为参数暴露给模型既不安全也别扭。所以这里用闭包：
    外层 make_todo_tools(user_id) 先"捕获"住 user_id，再返回已经绑定好
    该用户的两个 @tool 函数（add_todo / list_todos）。这样模型调用时只传
    task，工具内部自动用闭包里的 user_id 落库，天然实现多用户隔离。
    """

    @tool
    def add_todo(task: str) -> str:
        """添加一条待办事项。输入待办内容文本，例如 '写课程报告'，返回添加成功提示。"""
        db = SessionLocal()
        try:
            # 因为闭包捕获了 user_id，这里写入的待办天然属于当前用户
            todo = TodoItem(user_id=user_id, task=task)
            db.add(todo)
            db.commit()
            db.refresh(todo)
            return f"已添加待办：{todo.id} - {todo.task}"
        finally:
            db.close()

    @tool
    def list_todos() -> str:
        """列出当前用户的所有待办事项。无需输入参数，返回待办清单。"""
        db = SessionLocal()
        try:
            todos = (
                db.query(TodoItem)
                .filter(TodoItem.user_id == user_id)
                .order_by(TodoItem.id.asc())
                .all()
            )
            if not todos:
                return "暂无待办事项"
            return "\n".join(f"{t.id}. {'[x]' if t.done else '[ ]'} {t.task}" for t in todos)
        finally:
            db.close()

    return [add_todo, list_todos]


# ------------------------------------------------------------------ 通知（按用户隔离）
def make_notification_tools(user_id: int):
    """把 user_id 绑进通知工具，实现多用户数据隔离。"""

    @tool
    def notify_user(title: str, body: str = "") -> str:
        """向当前用户推送一条站内通知（铃铛提醒）。适合用于定时提醒、日程事项、重要提示等场景。输入 title（必填，简短标题）与 body（可选，补充说明）。"""
        db = SessionLocal()
        try:
            n = Notification(user_id=user_id, title=title[:200], body=body)
            db.add(n)
            db.commit()
            db.refresh(n)
            return f"已发送通知：{title}"
        finally:
            db.close()

    return [notify_user]
