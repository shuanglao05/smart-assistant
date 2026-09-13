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
import re

import requests

from app import config
from app.database import SessionLocal
from app.models import KbChunk, KbCollection

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


def _embed_batch(texts: list[str]) -> list[list[float]]:
    """单批向量化：优先新版 /api/embed（一次传多条），失败回退旧版逐条。"""
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


def embed_texts(texts: list[str], batch_size: int | None = None) -> list[list[float]]:
    """批量把一组文本转成向量；自动分批，避免一次发太多而超时。

    为什么必须分批：长文档（几十 MB 的 PDF）能切出上千个片段，
    一次性 POST 给 Ollama 极易触发超时（timeout=120s 也扛不住），
    分批后每批独立完成，既稳又快，也不会因一批失败丢掉全部结果。
    批大小由 config.RAG_EMBED_BATCH 控制（默认 32）。
    """
    if not texts:
        return []
    bs = max(1, batch_size or config.RAG_EMBED_BATCH)
    out: list[list[float]] = []
    for i in range(0, len(texts), bs):
        out.extend(_embed_batch(texts[i : i + bs]))
    return out


# 句子终止符（中文 + 英文）。句子切分与"片段是否收尾完整"的判定都用它。
# 不含 "…" / "——"：这两个在中文里多表示句中停顿（"怎么好像…地狱列车一样？"），
# 当作句末符会把一句话劈成两段，产生以 "…" 开头的碎片（实测小说语料 14/350 片）。
_SENT_END = "。！？!?；;"
# 后引号/后括号：句末常跟着 " 』 」 ) ）" 等收尾符号，需一并纳入句边界
_SENT_TAIL = "\u201d\u2019\u300d\u300f\uff09)】]》…"
# 仅在"整行只剩停顿符号"时才把这些算作收尾，用于判定片段完整性
_DANGLING = "…—～-·"

# 小标题特征：这些行本身是"结构骨架"，应尽量作为片段起点，不要被切在中间。
#   第X章 / 第X节 / 第X条 / 一、 / 1.1 / （一） / 附录A / 一、
_HEADING_RE = re.compile(
    r"^\s*(?:"
    r"第[一二三四五六七八九十百千零〇\d]+[章节条款部分篇]"
    r"|[一二三四五六七八九十]+[、．.]"
    r"|（[一二三四五六七八九十\d]+）"
    r"|\([一二三四五六七八九十\d]+\)"
    r"|\d+(?:\.\d+)*[、．.]?\s*"
    r"|附\s*录\s*[A-Za-z\d一二三四五六七八九十]*"
    r"|#{1,6}\s"
    r")"
)
# 行尾"未结束"特征：以这些字符收尾说明该行是被版式换行截断的，应并回下一行。
_SOFT_TAIL = "，,、：（(（【[《\"'\u201c\u2018"


def _is_heading(line: str) -> bool:
    """判断一行是否像小标题（章节/条款/编号标题）。要求整行较短，避免误判正文。"""
    s = line.strip()
    return bool(s) and len(s) <= 40 and bool(_HEADING_RE.match(s))


def _split_sentences(para: str) -> list[str]:
    """把一段文字切成句子（保留句末标点）。用于保证片段不在句中截断。

    逐字符扫描而非正则切分，是为了正确处理"句号后面跟着后引号"的情况——
    `他说"好。"` 的句边界应在 `"` 之后，而不是引号之前。
    """
    out: list[str] = []
    buf: list[str] = []
    i, n = 0, len(para)
    while i < n:
        ch = para[i]
        buf.append(ch)
        if ch in _SENT_END:
            # 吞掉紧跟的收尾符号（引号/括号），它们属于这一句
            j = i + 1
            while j < n and para[j] in _SENT_TAIL:
                buf.append(para[j])
                j += 1
            sent = "".join(buf).strip()
            if sent:
                out.append(sent)
            buf = []
            i = j
            continue
        i += 1
    tail = "".join(buf).strip()
    if tail:
        out.append(tail)
    return out


def _split_units(text: str) -> list[tuple[str, bool]]:
    """把正文拆成最小语义单元，返回 [(单元文本, 是否小标题)]。

    顺序：先按空行分段 → 再按换行分行 → 小标题单独成单元 → 其余行按句切分。
    这样后续合并时，任何单元内部都是完整句子，不会出现"半句话"。
    """
    units: list[tuple[str, bool]] = []
    for block in re.split(r"\n\s*\n", text):
        # 行内先按硬换行断开，但"纯停顿符号行"（如整行只有一个 …… ）不独立成单元，
        # 而是并回上一句 —— 否则会出现以 "…" 开头的碎片片段。
        for line in block.split("\n"):
            line = line.strip()
            if not line:
                continue
            if line.strip(_DANGLING) == "" and units:
                # 整行只有停顿符号：贴回上一单元
                prev, is_h = units[-1]
                units[-1] = (prev + line, is_h)
                continue
            if _is_heading(line):
                units.append((line, True))
                continue
            for sent in _split_sentences(line):
                if sent.strip(_DANGLING) == "" and units:
                    prev, is_h = units[-1]
                    units[-1] = (prev + sent, is_h)
                else:
                    units.append((sent, False))
    return units


def split_text(text: str, size: int | None = None, overlap: int | None = None) -> list[str]:
    """把长文本切成带重叠的片段（语义感知版）。

    与旧实现的区别：旧版是"定长 500 字符窗口 + 窗口内向后找断点"，
    当断点落在窗口前半段时直接在第 500 字符处硬切，且下一段起点回退
    overlap 时不校正边界 —— 于是升级换代后每片都可能以逗号/引号开头
    （实测 322/3100 片），即"上一句话被腰斩"。

    现在改为三段式：
      ① _split_units 先把正文拆成最小语义单元（段落→行→小标题→句子），
         单元内部保证是完整句子；
      ② 贪心合并相邻单元：加下一个单元不超 size 就继续加，攒满一片；
         单个单元超长（长段无标点）才在其内部按标点二次切分；
      ③ 重叠改为"回退若干完整单元"而非固定字符数：从下一片起点往前
         捡回若干单元直到达到 overlap 字符，因此重叠不会切断句子。

    结果：片段收尾仍是完整句，且开头也是完整句，检索语义更干净。
    """
    size = size or config.RAG_CHUNK_SIZE
    overlap = overlap if overlap is not None else config.RAG_CHUNK_OVERLAP
    size = max(80, size)                      # 过小的 size 会让合并退化，兜底
    overlap = max(0, min(overlap, size // 2))  # 重叠不得超过半片，否则会原地打转
    text = (text or "").strip()
    if not text:
        return []

    units = _split_units(text)
    n = len(units)
    chunks: list[str] = []
    i = 0
    while i < n:
        # 单个语义单元就超长（如整段无句号的说明文字）：先切出头部成片，
        # 剩余部分替换回单元列表继续参与后续合并，避免产生巨型片段。
        if len(units[i][0]) > size:
            head, used = _split_long_unit(units[i][0], size)
            if head:
                chunks.append(head)
            tail = units[i][0][used:].strip()
            if tail:
                units[i] = (tail, units[i][1])
            else:
                i += 1
            continue

        # ② 贪心合并单元：加下一个不超 size 就继续加
        buf: list[str] = []
        length = 0
        j = i
        while j < n and length + len(units[j][0]) <= size:
            buf.append(units[j][0])
            length += len(units[j][0])
            j += 1

        piece = "\n".join(buf).strip()
        if piece:
            chunks.append(piece)
        if j >= n:
            break

        # ③ 回退若干完整单元作为重叠：保证重叠区域也是完整句子
        back = j
        acc = 0
        while back > i + 1 and acc + len(units[back - 1][0]) <= overlap:
            back -= 1
            acc += len(units[back][0])
        i = back if back > i else j  # 至少前进一个单元，避免死循环
    return chunks


def _split_long_unit(unit: str, size: int) -> tuple[str, int]:
    """把一个超长单元按标点切成 <= size 的头部，返回 (头部文本, 已消费的字符数)。

    仅在"单个语义单元本身超过 size"时调用（典型场景：整段无句号的说明文字）。
    """
    if len(unit) <= size:
        return unit, len(unit)
    cut = max(
        unit.rfind("，", 0, size),
        unit.rfind("、", 0, size),
        unit.rfind("；", 0, size),
        unit.rfind(" ", 0, size),
        unit.rfind(",", 0, size),
    )
    if cut < size * 0.5:
        cut = size - 1
    return unit[: cut + 1].strip(), cut + 1


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

    Top-K 的作用域是【按知识库生效】：
      · 每个库可在 kb_collections.top_k 单独设置（NULL = 跟随全局默认 RAG_TOP_K）；
      · 一次检索涉及多个库时，**每个库各取自己配置的条数**，再合并按相似度排序
        （这样"规范库要精准、资料库要广撒网"可以并存）；
      · 显式传入 top_k 参数则对所有库统一生效（用于测试或特殊调用）。

    collection_ids：只在指定的知识库里检索；为空/None 则在该用户全部知识库里检索。
    """
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

        # 各库的 Top-K 设置（NULL → 全局默认）
        per_collection: dict[int | None, int] = {}
        for c in db.query(KbCollection).filter(KbCollection.user_id == user_id).all():
            per_collection[c.id] = c.top_k or top_k or config.RAG_TOP_K

        qvec = embed_texts([q])[0]

        # 按知识库分组打分（只查一次库，分组在内存里做，性能与原来一致）
        groups: dict[int | None, list[tuple[str, int, float]]] = {}
        for r in rows:
            try:
                vec = json.loads(r.embedding)
            except Exception:
                continue
            groups.setdefault(r.collection_id, []).append(
                (r.text, r.file_id, _cosine(qvec, vec))
            )

        # 每个库各取自己的前 N 名，再合并排序
        merged: list[tuple[str, int, float]] = []
        for cid, items in groups.items():
            k = top_k or per_collection.get(cid) or config.RAG_TOP_K
            items.sort(key=lambda x: x[2], reverse=True)
            merged.extend(items[:k])

        merged.sort(key=lambda x: x[2], reverse=True)
        # 总上限保护：库多时避免片段总数过大撑爆上下文
        return merged[: config.RAG_MAX_TOTAL_CHUNKS]
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
