"""RAG 知识库（零新增依赖）。

思路（初学者版）：
  入库：文档正文 → 切成小段(chunk) → 调 Ollama 生成每段的向量(embedding) → 存进 kb_chunks 表
  检索：用户问题 → 生成向量 → 与库里的每段向量算"余弦相似度" → 取最像的 top-k 段

为什么零新增依赖：
  - 生成向量：直接 HTTP 调本地 Ollama 的 /api/embed（旧版回退 /api/embeddings），
    用的还是你已经装好的 bge-m3，不需要任何 Python 新包或原生 DLL。
  - 存向量：以 JSON 文本存进现有 SQLite（kb_chunks 表）。
  - 算相似度：纯 Python 实现余弦，几十~几百段是毫秒级。

以后若要换 Chroma / FAISS，只需替换 index_file / search 这两个函数的内部实现，
上层（工具、Agent、接口）完全不用动。
"""

import json
import math

import requests

from app import config
from app.database import SessionLocal
from app.models import KbChunk

# Ollama 向量接口（新版批量 /api/embed，旧版单条 /api/embeddings）
_BASE = config.OLLAMA_BASE_URL.rstrip("/")
_EMBED_URL = f"{_BASE}/api/embed"
_EMBED_URL_LEGACY = f"{_BASE}/api/embeddings"


def _embed_one(text: str) -> list[float]:
    """对单条文本生成向量（旧版 /api/embeddings，回退用）。"""
    resp = requests.post(
        _EMBED_URL_LEGACY,
        json={"model": config.EMBED_MODEL, "prompt": text},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json().get("embedding", [])


def embed_texts(texts: list[str]) -> list[list[float]]:
    """批量把一组文本转成向量。

    优先调用新版 /api/embed（一次传多条，快）；若接口不存在或返回异常，
    自动回退到旧版逐条 /api/embeddings，保证不同 Ollama 版本都能用。
    """
    if not texts:
        return []
    try:
        resp = requests.post(
            _EMBED_URL,
            json={"model": config.EMBED_MODEL, "input": texts},
            timeout=120,
        )
        if resp.status_code == 200:
            embs = resp.json().get("embeddings")
            if embs and len(embs) == len(texts):
                return embs
    except Exception:
        pass
    # 回退：逐条生成
    return [_embed_one(t) for t in texts]


def split_text(text: str, size: int | None = None, overlap: int | None = None) -> list[str]:
    """把长文本切成带重叠的片段。

    - size：每段目标字符数（默认 config.RAG_CHUNK_SIZE）
    - overlap：相邻片段重叠字符数，避免一个句子被硬切断后语义丢失
    切分时优先在段落/换行/句号处断开，减少"半句话"片段。
    """
    size = size or config.RAG_CHUNK_SIZE
    overlap = overlap if overlap is not None else config.RAG_CHUNK_OVERLAP
    text = (text or "").strip()
    if not text:
        return []

    chunks: list[str] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + size, n)
        if end < n:
            # 在窗口内尽量找一个自然断点（段落 → 换行 → 句号）
            window = text[start:end]
            cut = max(
                window.rfind("\n\n"),
                window.rfind("\n"),
                window.rfind("。"),
                window.rfind(". "),
            )
            if cut > size * 0.5:  # 断点太靠前就不用它，避免片段过短
                end = start + cut + 1
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= n:
            break
        start = max(end - overlap, start + 1)  # 下一段起点往前回退 overlap 个字符
    return chunks


def _cosine(a: list[float], b: list[float]) -> float:
    """余弦相似度：值越大越相似（-1~1）。维度不一致或空向量返回 -1（视为不相似）。"""
    if not a or not b or len(a) != len(b):
        return -1.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return -1.0
    return dot / (na * nb)


def index_file(user_id: int, file_id: int, text: str, collection_id: int | None = None) -> int:
    """把一份文档切分 + 向量化后写入知识库，返回片段数量。

    collection_id：该文档所属的知识库；重复索引同一文件不会产生重复片段。
    注意：向量化失败（如 Ollama 没开）会抛异常，由调用方决定如何处理。
    """
    db = SessionLocal()
    try:
        # 清掉该文档的旧片段
        db.query(KbChunk).filter(
            KbChunk.user_id == user_id, KbChunk.file_id == file_id
        ).delete(synchronize_session=False)

        chunks = split_text(text)
        if not chunks:
            db.commit()
            return 0

        vectors = embed_texts(chunks)
        for i, (chunk, vec) in enumerate(zip(chunks, vectors)):
            db.add(
                KbChunk(
                    user_id=user_id,
                    collection_id=collection_id,
                    file_id=file_id,
                    chunk_index=i,
                    text=chunk,
                    embedding=json.dumps(vec),
                )
            )
        db.commit()
        return len(chunks)
    finally:
        db.close()


def search(
    user_id: int,
    query: str,
    top_k: int | None = None,
    collection_ids: list[int] | None = None,
) -> list[tuple[str, int, float]]:
    """检索与 query 最相关的片段，返回 [(片段文本, file_id, 相似度)]，按相似度降序。

    collection_ids：只在指定的知识库里检索；为空/None 则在该用户全部知识库里检索。
    """
    top_k = top_k or config.RAG_TOP_K
    q = (query or "").strip()
    if not q:
        return []

    db = SessionLocal()
    try:
        query_obj = db.query(KbChunk).filter(KbChunk.user_id == user_id)
        if collection_ids:
            query_obj = query_obj.filter(KbChunk.collection_id.in_(collection_ids))
        rows = query_obj.all()
        if not rows:
            return []

        qvec = embed_texts([q])[0]

        scored: list[tuple[str, int, float]] = []
        for r in rows:
            try:
                vec = json.loads(r.embedding)
            except Exception:
                continue
            scored.append((r.text, r.file_id, _cosine(qvec, vec)))

        scored.sort(key=lambda x: x[2], reverse=True)
        return scored[:top_k]
    finally:
        db.close()


def drop_collection(user_id: int, collection_id: int) -> None:
    """删除某个知识库下的全部片段（删除知识库时调用）。"""
    db = SessionLocal()
    try:
        db.query(KbChunk).filter(
            KbChunk.user_id == user_id, KbChunk.collection_id == collection_id
        ).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def drop_file(user_id: int, file_id: int) -> None:
    """删除某文档的全部知识库片段（删除文件时调用）。"""
    db = SessionLocal()
    try:
        db.query(KbChunk).filter(
            KbChunk.user_id == user_id, KbChunk.file_id == file_id
        ).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()
