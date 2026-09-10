"""ORM 模型（共 9 张表）。

表清单：
    User          账号（登录名 / 密码哈希 / 昵称 / 头像 / 主题 / 字号 / 语言）
    Conversation  会话（归属用户 / 标题 / 当前模型 provider+model / 启用技能 / 参与检索的知识库）
    Message       消息（role / content / 引用的附件 ref_file_ids / 本条回答的 provider+model）
    TodoItem      待办事项
    Skill         技能（人设指令：name / description / prompt / is_enabled）
    FileItem      上传的文件（filename / stored_path / size / 抽取的 content / 所属知识库 collection_id）
    Notification  站内通知（铃铛）
    KbCollection  知识库（一个知识集合）
    KbChunk       知识片段（text + embedding 向量 JSON，供 RAG 检索）

ORM（对象关系映射）= 把数据库表"映射"成 Python 类，把一行数据映射成一个对象。
这样我们写代码时只要操作 Python 对象（如 TodoItem(user_id=1, task="...")），
SQLAlchemy 会负责把它翻译成真正的 SQL（INSERT/SELECT/UPDATE...），不用手写 SQL。

每个 class 对应一张表（__tablename__ 指定表名），每个 Column(...) 对应一列。
多用户隔离的根：几乎所有表都带 user_id 外键；
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
    active_kb_ids = Column(JSON, default=list)  # 当前会话启用（参与检索）的知识库 id 列表
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
    # 产生这条回答所用的模型（助手消息才有；用于回看"这段对话是哪个模型答的"）
    provider = Column(String(20), nullable=True)
    model = Column(String(120), nullable=True)


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
    collection_id = Column(Integer, ForeignKey("kb_collections.id"), nullable=True, index=True)  # 所属知识库
    filename = Column(String(255), nullable=False)  # 原始文件名
    stored_path = Column(String(500), nullable=False)  # 相对 backend 的路径
    size = Column(Integer, default=0)
    content = Column(Text, nullable=True)  # 上传时抽取的正文（聊天直接注入上下文）
    created_at = Column(DateTime, default=utcnow)


class KbCollection(Base):
    """知识库（集合）：一个用户可以建多个，用来分开不同领域的资料。

    对话时可按会话选择启用哪些库，检索只在选中的库里进行。
    """

    __tablename__ = "kb_collections"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class KbChunk(Base):
    """RAG 知识库片段：文档切分后的每一小段及其向量（JSON 数组字符串）。

    检索时按 user_id + collection_id 隔离；file_id 指回 files 表（用于显示来源文件名）。
    """

    __tablename__ = "kb_chunks"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    collection_id = Column(Integer, ForeignKey("kb_collections.id"), nullable=True, index=True)  # 所属知识库
    file_id = Column(Integer, ForeignKey("files.id"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False, default=0)  # 该文档内的片段序号
    text = Column(Text, nullable=False)  # 片段正文
    embedding = Column(Text, nullable=False)  # 向量，存 json.dumps(list[float])
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
