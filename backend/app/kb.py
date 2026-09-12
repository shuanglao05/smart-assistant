"""知识库（多库）路由：管理知识库集合与其文档，供前端「知识库」页使用。

一个用户可以建多个知识库；对话时按会话选择启用哪些库参与检索。
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import FileItem, KbChunk, KbCollection
from app.schemas import (
    KbChunkPreview,
    KbCollectionCreate,
    KbCollectionOut,
    KbCollectionUpdate,
    KbDocument,
    KbGraph,
    KbGraphDoc,
)

router = APIRouter(prefix="/api/kb", tags=["kb"])


def _collection_or_404(db: Session, user_id: int, cid: int) -> KbCollection:
    obj = (
        db.query(KbCollection)
        .filter(KbCollection.id == cid, KbCollection.user_id == user_id)
        .first()
    )
    if not obj:
        raise HTTPException(404, "知识库不存在或无权访问")
    return obj


@router.get("/collections", response_model=list[KbCollectionOut])
def list_collections(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """列出当前用户的全部知识库及其文档数/片段数。"""
    cols = (
        db.query(KbCollection)
        .filter(KbCollection.user_id == current_user.id)
        .order_by(KbCollection.id.asc())
        .all()
    )
    file_counts = dict(
        db.query(FileItem.collection_id, func.count(FileItem.id))
        .filter(FileItem.user_id == current_user.id)
        .group_by(FileItem.collection_id)
        .all()
    )
    chunk_counts = dict(
        db.query(KbChunk.collection_id, func.count(KbChunk.id))
        .filter(KbChunk.user_id == current_user.id)
        .group_by(KbChunk.collection_id)
        .all()
    )
    return [
        KbCollectionOut(
            id=c.id,
            name=c.name,
            created_at=c.created_at,
            files=file_counts.get(c.id, 0),
            chunks=chunk_counts.get(c.id, 0),
            top_k=c.top_k,
        )
        for c in cols
    ]


@router.post("/collections", response_model=KbCollectionOut)
def create_collection(
    payload: KbCollectionCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = KbCollection(user_id=current_user.id, name=payload.name.strip())
    db.add(c)
    db.commit()
    db.refresh(c)
    return KbCollectionOut(
        id=c.id, name=c.name, created_at=c.created_at, files=0, chunks=0, top_k=c.top_k
    )


@router.patch("/collections/{cid}", response_model=KbCollectionOut)
def update_collection(
    cid: int,
    payload: KbCollectionUpdate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """更新知识库：改名（name）与检索 Top-K（top_k）均可单独提交。

    top_k 语义：不传该字段 = 保持不变；传 null = 清除单独设置、回退跟随全局默认；
    传数字 = 设定该库专属值（自动夹到 1~20）。
    """
    c = _collection_or_404(db, current_user.id, cid)

    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(400, "知识库名称不能为空")
        c.name = name

    # 用 model_fields_set 区分「没传」与「显式传了 null」
    if "top_k" in payload.model_fields_set:
        c.top_k = None if payload.top_k is None else max(1, min(20, int(payload.top_k)))

    db.commit()
    db.refresh(c)
    files = (
        db.query(func.count(FileItem.id))
        .filter(FileItem.user_id == current_user.id, FileItem.collection_id == cid)
        .scalar()
        or 0
    )
    chunks = (
        db.query(func.count(KbChunk.id))
        .filter(KbChunk.user_id == current_user.id, KbChunk.collection_id == cid)
        .scalar()
        or 0
    )
    return KbCollectionOut(
        id=c.id,
        name=c.name,
        created_at=c.created_at,
        files=files,
        chunks=chunks,
        top_k=c.top_k,
    )


@router.delete("/collections/{cid}")
def delete_collection(
    cid: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除知识库：连同其文档（DB 记录 + 磁盘文件）与索引片段一起删除。"""
    c = _collection_or_404(db, current_user.id, cid)

    # 逐个删除该库下的文档
    files = (
        db.query(FileItem)
        .filter(FileItem.user_id == current_user.id, FileItem.collection_id == cid)
        .all()
    )
    for f in files:
        try:
            from app.files import UPLOAD_ROOT

            path = UPLOAD_ROOT.parent / f.stored_path
            if path.exists():
                path.unlink()
        except Exception:
            pass
        db.delete(f)

    # 清理索引片段
    try:
        from app.rag import drop_collection

        drop_collection(current_user.id, cid)
    except Exception:
        pass

    db.delete(c)
    db.commit()
    return {"ok": True}


@router.get("/documents", response_model=list[KbDocument])
def list_documents(
    collection_id: int | None = None,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """列出当前用户的文档；给了 collection_id 则只列该库的，否则全部。"""
    q = db.query(FileItem).filter(FileItem.user_id == current_user.id)
    if collection_id is not None:
        q = q.filter(FileItem.collection_id == collection_id)
    files = q.order_by(FileItem.created_at.desc()).all()

    counts = dict(
        db.query(KbChunk.file_id, func.count(KbChunk.id))
        .filter(KbChunk.user_id == current_user.id)
        .group_by(KbChunk.file_id)
        .all()
    )
    return [
        KbDocument(
            id=f.id,
            filename=f.filename,
            size=f.size,
            created_at=f.created_at,
            chunks=counts.get(f.id, 0),
            collection_id=f.collection_id,
        )
        for f in files
    ]


@router.get("/graph", response_model=KbGraph)
def graph(
    collection_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """返回某个知识库的「库 → 文档 → 片段」关系图数据。

    片段只带开头预览（每篇最多 40 条），避免大数据量一次拉爆前端。
    """
    c = _collection_or_404(db, current_user.id, collection_id)
    files = (
        db.query(FileItem)
        .filter(FileItem.user_id == current_user.id, FileItem.collection_id == collection_id)
        .order_by(FileItem.created_at.asc(), FileItem.id.asc())
        .all()
    )
    max_preview = 40
    documents: list[KbGraphDoc] = []
    total_chunks = 0
    for f in files:
        total = (
            db.query(func.count(KbChunk.id))
            .filter(KbChunk.user_id == current_user.id, KbChunk.file_id == f.id)
            .scalar()
            or 0
        )
        rows = (
            db.query(KbChunk)
            .filter(KbChunk.user_id == current_user.id, KbChunk.file_id == f.id)
            .order_by(KbChunk.chunk_index.asc())
            .limit(max_preview)
            .all()
        )
        documents.append(
            KbGraphDoc(
                id=f.id,
                filename=f.filename,
                chunks=total,
                previews=[
                    KbChunkPreview(index=r.chunk_index, preview=(r.text or "")[:70])
                    for r in rows
                ],
            )
        )
        total_chunks += total

    coll = KbCollectionOut(
        id=c.id,
        name=c.name,
        created_at=c.created_at,
        files=len(files),
        chunks=total_chunks,
        top_k=c.top_k,
    )
    return KbGraph(collection=coll, documents=documents)


@router.post("/reindex-all")
def reindex_all(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """对当前用户所有文档重建索引（用于 RAG 上线前上传的老文件）。"""
    from app.rag import index_file

    files = db.query(FileItem).filter(FileItem.user_id == current_user.id).all()
    indexed = 0
    failed = 0
    for f in files:
        try:
            if index_file(current_user.id, f.id, f.content or "", f.collection_id) > 0:
                indexed += 1
        except Exception:
            failed += 1
    return {"indexed": indexed, "failed": failed, "total": len(files)}


# ------------------------------------------------------------------ RAG 检索参数
class RagConfigUpdate(BaseModel):
    top_k: int


@router.get("/rag-config")
def get_rag_config(_current_user=Depends(get_current_user)):
    """知识库检索参数（Top-K、切片大小等），供界面展示。"""
    from app import config

    return {
        "top_k": config.RAG_TOP_K,
        "chunk_size": config.RAG_CHUNK_SIZE,
        "chunk_overlap": config.RAG_CHUNK_OVERLAP,
        "embed_batch": config.RAG_EMBED_BATCH,
    }


@router.post("/rag-config")
def set_rag_config(payload: RagConfigUpdate, _current_user=Depends(get_current_user)):
    """调整检索片段数（Top-K）：立即生效并写入 .env 持久化。

    Top-K 越大，回答时参考的资料越全，但注入上下文也越长（更慢、更贵）。
    合理区间 3~8：日常问答 4 就够，需要综合多份材料时调到 6~8。
    """
    from app import config
    from app.llm_config import _update_env_file

    k = max(1, min(20, int(payload.top_k)))
    config.RAG_TOP_K = k
    try:
        _update_env_file({"RAG_TOP_K": str(k)})
    except Exception:
        pass  # 写盘失败不影响本次生效
    return {"top_k": k}
