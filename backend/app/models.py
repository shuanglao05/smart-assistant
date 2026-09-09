"""ORM 模型：User / Conversation / Message / TodoItem。

ORM（对象关系映射）= 把数据库表"映射"成 Python 类，把一行数据映射成一个对象。
这样我们写代码时只要操作 Python 对象（如 TodoItem(user_id=1, task="...")），
SQLAlchemy 会负责把它翻译成真正的 SQL（INSERT/SELECT/UPDATE...），不用手写 SQL。

每个 class 对应一张表（__tablename__ 指定表名），每个 Column(...) 对应一列。
多用户隔离的根：conversations.user_id 与 todos.user_id 等外键。
任何查询都必须带上 user_id 过滤，否则会出现越权（看到别人的数据）。
"""

from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Integer, String, Text

from app import config
from app.database import Base


def utcnow():
    # datetime.utcnow() 在 Python 3.12+ 已废弃，统一用带时区的 now()
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)  # 登录ID，不可改
    hashed_password = Column(String(255), nullable=False)
    nickname = Column(String(50), nullable=True)  # 显示用昵称（可改）
    avatar = Column(Text, nullable=True)  # 表情 / data URL（上传头像压缩后约几十 KB）
    language = Column(String(10), default="zh", nullable=False)  # zh / en
    font_size = Column(String(10), default="medium", nullable=False)  # small / medium / large
    theme = Column(String(10), default="dark", nullable=False)  # dark / light
    created_at = Column(DateTime, default=utcnow)


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(100), default="新对话")
    provider = Column(String(20), default=config.LLM_PROVIDER, nullable=False)
    model = Column(
        String(80),
        default=(config.OLLAMA_MODEL if config.LLM_PROVIDER == "ollama" else config.CLOUD_MODEL),
        nullable=False,
    )
    active_skill_ids = Column(JSON, default=list)  # 当前会话启用的 skill id 列表
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, index=True)


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), nullable=False, index=True)
    role = Column(String(20), nullable=False)  # user / assistant
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utcnow)
    # 用户消息引用的附件文档 id（JSON 数组），用于前端在气泡上方展示文档名并可点击查看
    ref_file_ids = Column(Text, nullable=True)


class TodoItem(Base):
    __tablename__ = "todos"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    task = Column(String(500), nullable=False)
    done = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)


class Skill(Base):
    __tablename__ = "skills"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    description = Column(String(500), nullable=True)
    prompt = Column(Text, nullable=False)  # 拼入系统提示词的附加指令
    is_enabled = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class FileItem(Base):
    __tablename__ = "files"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    filename = Column(String(255), nullable=False)  # 原始文件名
    stored_path = Column(String(500), nullable=False)  # 相对 backend 的路径
    size = Column(Integer, default=0)
    content = Column(Text, nullable=True)  # 上传时抽取的正文（聊天直接注入上下文）
    created_at = Column(DateTime, default=utcnow)


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=True)
    type = Column(String(20), default="info")  # info / remind / alert / system
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=utcnow)
