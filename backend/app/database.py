"""数据库连接与会话管理。"""

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

from app.config import DATABASE_URL

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """FastAPI 依赖：每个请求一个数据库会话，用完即关。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """开发期自动建表。生产环境建议改用 Alembic 迁移。"""
    from app.models import User, Conversation, Message, TodoItem, Skill, FileItem, Notification  # noqa: F401  确保模型已注册

    Base.metadata.create_all(bind=engine)

    # 兼容已有数据库：缺列则 ALTER 补加（不丢历史数据）
    from sqlalchemy import inspect as _sa_inspect

    from app import config as _config

    inspector = _sa_inspect(engine)

    # ---- conversations 增量列 ----
    existing = {c["name"] for c in inspector.get_columns("conversations")}
    with engine.begin() as conn:
        if "provider" not in existing:
            conn.execute(
                text(
                    f"ALTER TABLE conversations ADD COLUMN provider VARCHAR(20) NOT NULL DEFAULT '{_config.LLM_PROVIDER}'"
                )
            )
        if "model" not in existing:
            _dm = _config.OLLAMA_MODEL if _config.LLM_PROVIDER == "ollama" else _config.CLOUD_MODEL
            conn.execute(
                text(f"ALTER TABLE conversations ADD COLUMN model VARCHAR(80) NOT NULL DEFAULT '{_dm}'")
            )
        if "active_skill_ids" not in existing:
            conn.execute(
                text("ALTER TABLE conversations ADD COLUMN active_skill_ids TEXT DEFAULT '[]'")
            )

    # ---- users 增量列（设置面板的 nickname/avatar/language/font_size/theme） ----
    user_cols = {c["name"] for c in inspector.get_columns("users")}
    with engine.begin() as conn:
        if "nickname" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN nickname VARCHAR(50)"))
        if "avatar" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN avatar TEXT"))
        if "language" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN language VARCHAR(10) NOT NULL DEFAULT 'zh'"))
        if "font_size" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN font_size VARCHAR(10) NOT NULL DEFAULT 'medium'"))
        if "theme" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN theme VARCHAR(10) NOT NULL DEFAULT 'dark'"))
        if "created_at" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN created_at DATETIME"))

    # ---- messages 增量列（用户消息引用的文档 id） ----
    msg_cols = {c["name"] for c in inspector.get_columns("messages")}
    with engine.begin() as conn:
        if "ref_file_ids" not in msg_cols:
            conn.execute(text("ALTER TABLE messages ADD COLUMN ref_file_ids TEXT"))
