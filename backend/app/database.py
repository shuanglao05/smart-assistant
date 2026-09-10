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
    from app.models import User, Conversation, Message, TodoItem, Skill, FileItem, KbCollection, KbChunk, Notification  # noqa: F401  确保模型已注册

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
        # 回答所用的模型（provider + model），便于前端在每条回答下标注
        if "provider" not in msg_cols:
            conn.execute(text("ALTER TABLE messages ADD COLUMN provider VARCHAR(20)"))
        if "model" not in msg_cols:
            conn.execute(text("ALTER TABLE messages ADD COLUMN model VARCHAR(120)"))

    # ---- 多知识库：files/kb_chunks 加 collection_id，conversations 加 active_kb_ids ----
    inspector2 = _sa_inspect(engine)
    file_cols = {c["name"] for c in inspector2.get_columns("files")}
    with engine.begin() as conn:
        if "collection_id" not in file_cols:
            conn.execute(text("ALTER TABLE files ADD COLUMN collection_id INTEGER"))
    chunk_cols = {c["name"] for c in inspector2.get_columns("kb_chunks")}
    with engine.begin() as conn:
        if "collection_id" not in chunk_cols:
            conn.execute(text("ALTER TABLE kb_chunks ADD COLUMN collection_id INTEGER"))
    conv_cols = {c["name"] for c in inspector2.get_columns("conversations")}
    with engine.begin() as conn:
        if "active_kb_ids" not in conv_cols:
            conn.execute(text("ALTER TABLE conversations ADD COLUMN active_kb_ids TEXT DEFAULT '[]'"))

    # ---- 老数据回填：给"无归属"的文件/片段补一个默认知识库 ----
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT DISTINCT user_id FROM files WHERE collection_id IS NULL")
        ).all()
        for (uid,) in rows:
            existing = conn.execute(
                text("SELECT id FROM kb_collections WHERE user_id = :u ORDER BY id LIMIT 1"),
                {"u": uid},
            ).first()
            if existing:
                cid = existing[0]
            else:
                conn.execute(
                    text(
                        "INSERT INTO kb_collections (user_id, name, created_at, updated_at) "
                        "VALUES (:u, '默认知识库', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                    ),
                    {"u": uid},
                )
                cid = conn.execute(text("SELECT last_insert_rowid()")).scalar()
            conn.execute(
                text("UPDATE files SET collection_id = :c WHERE user_id = :u AND collection_id IS NULL"),
                {"c": cid, "u": uid},
            )
            conn.execute(
                text("UPDATE kb_chunks SET collection_id = :c WHERE user_id = :u AND collection_id IS NULL"),
                {"c": cid, "u": uid},
            )

    # ---- 修复历史数据：早期用原生 SQL 插入的知识库可能 created_at/updated_at 为空 ----
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE kb_collections SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL")
        )
        conn.execute(
            text("UPDATE kb_collections SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL")
        )
