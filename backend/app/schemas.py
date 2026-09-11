"""Pydantic 请求 / 响应模型（数据校验 + 接口契约）。

Pydantic 是 Python 的数据校验库。这里每个 class 都是一份"数据格式说明书"：
- 请求模型（如 RegisterRequest / ChatRequest）：FastAPI 用它来校验前端发来的
  JSON 字段类型是否合法（缺字段、类型错都会自动返回 422 错误）。
- 响应模型（如 UserOut / SessionOut / MessageOut）：FastAPI 用它来把数据库查到的
  对象序列化成 JSON 返回给前端，并顺便过滤掉不该暴露的字段（如密码）。
带 model_config = ConfigDict(from_attributes=True) 的，表示可以直接从 SQLAlchemy
对象（带属性的对象）一键转换，不用手写字段映射。
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class RegisterRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=128)


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    """个人资料（不含密码）。"""
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str  # 登录ID，只读
    nickname: str | None = None
    avatar: str | None = None
    language: str = "zh"
    font_size: str = "medium"
    theme: str = "dark"
    created_at: datetime | None = None


class UserUpdate(BaseModel):
    """更新个人资料；改密需要 current_password + new_password。"""
    nickname: str | None = Field(default=None, max_length=50)
    avatar: str | None = Field(default=None, max_length=1_000_000)  # 表情 或 data URL（前端已压缩）
    language: str | None = Field(default=None)
    font_size: str | None = Field(default=None)
    theme: str | None = Field(default=None)
    current_password: str | None = None
    new_password: str | None = Field(default=None, min_length=1, max_length=128)


class ApiKeyInfo(BaseModel):
    """设置面板展示的当前云端 API 配置（Key 脱敏）。"""
    provider: str
    base_url: str | None = None
    model: str | None = None
    masked_key: str  # 形如 sk-...xxxx
    usage_url: str  # 厂商用量监控页
    configured: bool


class TokenResponse(BaseModel):
    token: str
    token_type: str = "bearer"
    username: str


class SessionCreate(BaseModel):
    title: str | None = "新对话"


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    provider: str = "ollama"
    model: str = ""
    active_skill_ids: list[int] = []
    active_kb_ids: list[int] = []
    created_at: datetime
    updated_at: datetime


class SessionUpdate(BaseModel):
    title: str | None = None
    provider: str | None = None
    model: str | None = None
    active_skill_ids: list[int] | None = None
    active_kb_ids: list[int] | None = None


class MessageOut(BaseModel):
    id: int
    role: str
    content: str
    created_at: datetime
    # 用户消息引用的文档（id + 文件名 + 大小），由 messages 接口补全；助手消息恒为空
    ref_files: list["RefFile"] = []
    # 产生这条回答所用的模型（仅助手消息有；前端在回答下方标注）
    provider: str | None = None
    model: str | None = None


class RefFile(BaseModel):
    id: int
    filename: str
    size: int


class ChatRequest(BaseModel):
    session_id: int
    message: str = ""  # regenerate=true 时可留空，直接重答最后一个问题
    regenerate: bool = False
    file_ids: list[int] | None = None


class ChatResponse(BaseModel):
    reply: str


class FileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    filename: str
    size: int
    created_at: datetime


class FileDetail(FileOut):
    """文档详情：在 FileOut 基础上带上抽取的正文，供前端在右侧面板中查看。"""

    content: str | None = None


class KbDocument(BaseModel):
    """某个知识库中的一份文档及其索引状态。"""

    id: int
    filename: str
    size: int
    created_at: datetime | None = None  # 容错：历史数据可能为空
    chunks: int = 0  # 已建立的索引片段数（0 表示尚未索引）
    collection_id: int | None = None


class KbCollectionOut(BaseModel):
    """知识库（集合）及其汇总统计。"""

    id: int
    name: str
    created_at: datetime | None = None  # 容错：历史数据可能为空
    files: int = 0  # 文档数
    chunks: int = 0  # 片段数


class KbCollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class KbCollectionUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class KbChunkPreview(BaseModel):
    """知识库图谱用：单个片段的序号与开头预览。"""

    index: int
    preview: str


class KbGraphDoc(BaseModel):
    """图谱中的一个文档节点（含若干片段预览）。"""

    id: int
    filename: str
    chunks: int  # 该文档的片段总数
    previews: list[KbChunkPreview] = []  # 预览片段（可能少于总数）


class KbGraph(BaseModel):
    """知识库关系图数据：库 → 文档 → 片段。"""

    collection: KbCollectionOut
    documents: list[KbGraphDoc] = []


class SearchHit(BaseModel):
    conversation_id: int
    title: str
    role: str  # user / assistant / title
    content: str
    created_at: datetime | None = None


class NotificationCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str | None = None
    type: str = "info"


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    body: str | None = None
    type: str = "info"
    is_read: bool = False
    created_at: datetime


class TodoCreate(BaseModel):
    task: str = Field(min_length=1, max_length=500)


class TodoUpdate(BaseModel):
    task: str | None = None
    done: bool | None = None


class TodoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task: str
    done: bool
    created_at: datetime


class SkillCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = None
    prompt: str = Field(min_length=1)


class SkillUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    prompt: str | None = None
    is_enabled: bool | None = None


class SkillOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    name: str
    description: str | None = None
    prompt: str
    is_enabled: bool
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------- 智能笔记
class NoteCreate(BaseModel):
    title: str = Field(default="", max_length=200)
    content: str = ""
    day: str | None = None  # YYYY-MM-DD，缺省=今天


class NoteUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    content: str | None = None
    day: str | None = None


class NoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    content: str
    day: str
    created_at: datetime
    updated_at: datetime


class NoteSummarizeRequest(BaseModel):
    day: str  # 要归纳的日期 YYYY-MM-DD
    provider: str | None = None  # 可选：前端传入的全局模型
    model: str | None = None


# ---------------------------------------------------------------- 日程
class ScheduleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    start_at: float  # epoch 秒（UTC）
    note: str | None = None


class ScheduleUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    start_at: float | None = None
    note: str | None = None


class ScheduleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    start_at: float
    note: str | None = None
    reminded: bool
    created_at: datetime


# ---------------------------------------------------------------- 课表
class CourseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    teacher: str | None = Field(default=None, max_length=100)
    location: str | None = Field(default=None, max_length=100)
    weekday: int = Field(ge=1, le=7)
    start_section: int = Field(ge=1)
    end_section: int = Field(ge=1)
    weeks: str | None = Field(default=None, max_length=50)
    color: str | None = None


class CourseUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    teacher: str | None = None
    location: str | None = None
    weekday: int | None = Field(default=None, ge=1, le=7)
    start_section: int | None = Field(default=None, ge=1)
    end_section: int | None = Field(default=None, ge=1)
    weeks: str | None = None
    color: str | None = None


class CourseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    teacher: str | None = None
    location: str | None = None
    weekday: int
    start_section: int
    end_section: int
    weeks: str | None = None
    color: str | None = None
    created_at: datetime


class CourseImportRequest(BaseModel):
    """智能导入：给网址、粘贴文本或课表截图，由 AI 解析成课程列表。"""

    url: str | None = None
    text: str | None = None
    image: str | None = None  # 图片 data URL（data:image/png;base64,...）
    provider: str | None = None  # 可选：前端传入的全局模型
    model: str | None = None
