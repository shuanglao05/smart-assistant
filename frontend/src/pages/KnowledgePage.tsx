import { useEffect, useRef, useState } from 'react'
import {
  BookOpen,
  Database,
  FileText,
  FolderPlus,
  List,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Trash2,
  Upload,
} from 'lucide-react'
import { filesApi, kbApi } from '../api'
import PageShell from '../components/PageShell'
import EngineChip from '../components/EngineChip'
import KbGraph from '../components/KbGraph'
import type { KbCollection, KbDocument } from '../types'

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/** 知识库：管理多个知识库（集合）及其文档，上传即索引 */
export default function KnowledgePage() {
  const [cols, setCols] = useState<KbCollection[]>([])
  const [current, setCurrent] = useState<number | null>(null)
  const [docs, setDocs] = useState<KbDocument[]>([])
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<'list' | 'graph'>('list')
  const fileRef = useRef<HTMLInputElement>(null)

  const loadCols = async (): Promise<KbCollection[]> => {
    const { data } = await kbApi.collections()
    setCols(data)
    return data
  }
  const loadDocs = async (cid: number | null) => {
    const { data } = await kbApi.documents(cid ?? undefined)
    setDocs(data)
  }

  useEffect(() => {
    loadCols()
      .then((list) => {
        const first = list[0]?.id ?? null
        setCurrent(first)
        loadDocs(first)
      })
      .catch(() => {})
  }, [])

  const selectCol = (cid: number) => {
    setCurrent(cid)
    loadDocs(cid)
  }

  const createCol = async () => {
    const name = prompt('新知识库名称（例如：线性代数 / 项目资料）：', '')
    if (!name || !name.trim()) return
    setBusy(true)
    try {
      const { data } = await kbApi.createCollection(name.trim())
      await loadCols()
      selectCol(data.id)
    } finally {
      setBusy(false)
    }
  }

  const renameCol = async (c: KbCollection) => {
    const name = prompt('重命名知识库：', c.name)
    if (!name || !name.trim() || name.trim() === c.name) return
    setBusy(true)
    try {
      await kbApi.renameCollection(c.id, name.trim())
      await loadCols()
    } finally {
      setBusy(false)
    }
  }

  const removeCol = async (c: KbCollection) => {
    if (!confirm(`删除知识库「${c.name}」？其中的 ${c.files} 份文档会被一并删除，不可恢复。`)) return
    setBusy(true)
    try {
      await kbApi.removeCollection(c.id)
      const list = await loadCols()
      const next = list[0]?.id ?? null
      setCurrent(next)
      await loadDocs(next)
    } finally {
      setBusy(false)
    }
  }

  const upload = async (list: FileList | null) => {
    if (!list || list.length === 0) return
    if (current == null) {
      alert('请先新建 / 选择一个知识库')
      return
    }
    setBusy(true)
    try {
      for (const f of Array.from(list)) await filesApi.upload(f, current)
      await loadCols()
      await loadDocs(current)
    } catch (e: any) {
      alert(`上传失败：${e?.response?.data?.detail || e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  const reindex = async (id: number) => {
    setBusy(true)
    try {
      await filesApi.reindex(id)
    } catch (e: any) {
      alert(`重建索引失败：${e?.response?.data?.detail || e?.message || e}`)
    } finally {
      await loadDocs(current)
      setBusy(false)
    }
  }

  const removeDoc = async (id: number, name: string) => {
    if (!confirm(`删除文档《${name}》？将同时移除它的知识库索引。`)) return
    setBusy(true)
    try {
      await filesApi.remove(id)
    } finally {
      await loadCols()
      await loadDocs(current)
      setBusy(false)
    }
  }

  const reindexAll = async () => {
    if (cols.length === 0) return
    setBusy(true)
    try {
      const { data: res } = await kbApi.reindexAll()
      alert(`重建完成：成功 ${res.indexed} 个${res.failed ? `，失败 ${res.failed} 个` : ''}`)
    } finally {
      await loadCols()
      await loadDocs(current)
      setBusy(false)
    }
  }

  const cur = cols.find((c) => c.id === current) || null

  return (
    <PageShell
      icon={<BookOpen size={18} />}
      title="知识库"
      model={
        <EngineChip
          icon={<Database size={14} />}
          label="bge-m3"
          sub="本地嵌入"
          title="知识库向量化使用本地 Ollama 的 bge-m3 嵌入模型，并非对话大模型"
        />
      }
      actions={
        <>
          <button
            className="btn"
            onClick={() => fileRef.current?.click()}
            disabled={busy || current == null}
            title="把文档上传到当前选中的知识库"
          >
            <Upload size={15} /> 上传到当前库
          </button>
          <button className="btn" onClick={reindexAll} disabled={busy || docs.length === 0}>
            <RotateCw size={15} /> 重建全部
          </button>
        </>
      }
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          upload(e.target.files)
          e.target.value = ''
        }}
      />

      <div className="kb-layout">
        <aside className="kb-cols">
          <div className="kb-cols-head">
            <span>我的知识库</span>
            <button className="kb-add" onClick={createCol} disabled={busy} title="新建知识库">
              <Plus size={14} />
            </button>
          </div>
          <div className="kb-cols-list">
            {cols.length === 0 && (
              <div className="kb-cols-empty">
                还没有知识库
                <br />
                <span>点右上「＋」新建</span>
              </div>
            )}
            {cols.map((c) => (
              <div
                key={c.id}
                className={`kb-col ${c.id === current ? 'active' : ''}`}
                onClick={() => selectCol(c.id)}
              >
                <BookOpen size={15} className="kb-col-ico" />
                <div className="kb-col-meta">
                  <div className="kb-col-name" title={c.name}>
                    {c.name}
                  </div>
                  <div className="kb-col-sub">
                    {c.files} 文档 · {c.chunks} 片段
                  </div>
                </div>
                <div className="kb-col-ops">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      renameCol(c)
                    }}
                    title="重命名"
                    disabled={busy}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeCol(c)
                    }}
                    title="删除知识库"
                    disabled={busy}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="kb-docs">
          <div className="kb-docs-head">
            <span className="kb-docs-title">{cur ? cur.name : '文档'}</span>
            <div className="kb-head-right">
              {cur && <span className="kb-docs-count">{cur.files} 份文档</span>}
              <div className="kb-view-toggle">
                <button
                  className={view === 'list' ? 'on' : ''}
                  onClick={() => setView('list')}
                  title="列表视图"
                >
                  <List size={13} /> 列表
                </button>
                <button
                  className={view === 'graph' ? 'on' : ''}
                  onClick={() => setView('graph')}
                  title="关系图视图（库 → 文档 → 片段）"
                >
                  <Network size={13} /> 关系图
                </button>
              </div>
            </div>
          </div>
          {view === 'graph' ? (
            <KbGraph collectionId={current} />
          ) : current == null ? (
            <div className="kb-empty">
              <FolderPlus size={24} />
              <p>还没有知识库</p>
              <span>点左侧「＋」新建一个，再上传文档</span>
            </div>
          ) : docs.length === 0 ? (
            <div className="kb-empty">
              <FileText size={24} />
              <p>这个库里还没有文档</p>
              <span>点右上「上传到当前库」添加笔记、报告或说明书</span>
            </div>
          ) : (
            <div className="kb-list">
              {docs.map((d) => (
                <div key={d.id} className="kb-item">
                  <FileText size={16} className="kb-ico" />
                  <div className="kb-meta">
                    <div className="kb-name" title={d.filename}>
                      {d.filename}
                    </div>
                    <div className="kb-sub">
                      {fmtSize(d.size)} · {new Date(d.created_at).toLocaleDateString('zh-CN')}
                    </div>
                  </div>
                  {d.chunks > 0 ? (
                    <span className="kb-badge ok">{d.chunks} 段</span>
                  ) : (
                    <span className="kb-badge warn">未索引</span>
                  )}
                  <div className="kb-ops">
                    <button
                      className="kb-op"
                      onClick={() => reindex(d.id)}
                      disabled={busy}
                      title="重建索引"
                    >
                      <RefreshCw size={14} />
                    </button>
                    <button
                      className="kb-op danger"
                      onClick={() => removeDoc(d.id, d.filename)}
                      disabled={busy}
                      title="删除文档"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </PageShell>
  )
}
