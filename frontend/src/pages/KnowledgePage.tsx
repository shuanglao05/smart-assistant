/**
 * KnowledgePage.tsx —— 知识库管理页（本应用第二复杂的页面）
 *
 * 职责：
 *   管理「知识库（集合）→ 文档 → 片段」三层结构：
 *     · 左栏：知识库列表（新建 / 重命名 / 删除 / 切换）与各库的检索 Top-K 设置
 *     · 右栏：当前库的文档列表，支持上传、删除、重建索引
 *     · 视图：列表 / 关系图 两种模式切换
 *
 * 组件状态：
 *   cols / current —— 知识库列表与当前选中库
 *   docs / busy    —— 当前库的文档与忙碌标记
 *   view           —— 'list' 列表 | 'graph' 关系图
 *   limits         —— 上传限制与 RAG 参数。**从后端接口读取后展示**，
 *                     不在前端硬编码，避免前后端数值不一致造成误导
 *
 * 关键函数：
 *   changeTopK / changeColTopK         —— 设置全局默认 / 单库的检索片段数
 *   createCol / renameCol / removeCol  —— 知识库增删改
 *   loadDocs / selectCol               —— 文档加载与库切换
 *
 * 说明：
 *   数据靠 user_id + collection_id 双重过滤隔离；前端只负责维护「当前库」这个选中态，
 *   索引的切分与向量化全部由后端完成（上传后自动触发）。
 */
import { useEffect, useRef, useState } from 'react'
import {
  BookOpen,
  Database,
  FileText,
  FolderPlus,
  Info,
  List,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Trash2,
  Upload,
} from 'lucide-react'
import { filesApi, kbApi, type FileLimits } from '../api'
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
  // 上传限制（支持类型 / 大小上限）与 RAG 检索参数，均从后端读取后展示
  const [limits, setLimits] = useState<FileLimits | null>(null)
  const [topK, setTopK] = useState<number>(4)
  const [showTips, setShowTips] = useState(false)

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
    // 拉取上传限制与检索参数（用于界面标注，避免写死在后端变更后不一致）
    filesApi
      .limits()
      .then(({ data }) => setLimits(data))
      .catch(() => {})
    kbApi
      .ragConfig()
      .then(({ data }) => setTopK(data.top_k))
      .catch(() => {})
  }, [])

  // 调整全局默认检索片段数（未单独设置的知识库使用此值）
  const changeTopK = async (k: number) => {
    setTopK(k)
    try {
      await kbApi.setRagConfig(k)
    } catch {
      /* 失败时保留界面值，下次进入会重新同步 */
    }
  }

  // 设置「当前知识库」专属的 Top-K：'' = 清除，回退跟随全局默认
  const changeColTopK = async (v: string) => {
    if (!cur) return
    setBusy(true)
    try {
      await kbApi.updateCollection(cur.id, { top_k: v === '' ? null : Number(v) })
      await loadCols()
    } catch (e: any) {
      alert(`设置失败：${e?.response?.data?.detail || e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

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
      await kbApi.updateCollection(c.id, { name: name.trim() })
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
    // 前端先按后端返回的上限预检，超限文件直接拦下，不必等上传完才报错
    const maxBytes = (limits?.max_mb ?? 50) * 1024 * 1024
    const tooBig = Array.from(list).filter((f) => f.size > maxBytes)
    if (tooBig.length > 0) {
      alert(
        `以下文件超过 ${limits?.max_mb ?? 50}MB 上限，未上传：\n` +
          tooBig.map((f) => `· ${f.name}（${fmtSize(f.size)}）`).join('\n')
      )
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
            title={`上传到当前知识库（支持 PDF / Word / 文本 / 图片，单文件 ≤ ${limits?.max_mb ?? 50}MB）`}
          >
            <Upload size={15} /> {busy ? '解析入库中…' : '上传到当前库'}
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
        accept={limits?.all_exts.join(',') || undefined}
        style={{ display: 'none' }}
        onChange={(e) => {
          upload(e.target.files)
          e.target.value = ''
        }}
      />

      {/* 上传限制与检索参数说明：数据由后端提供，保证与实际限制一致 */}
      <div className="kb-info">
        <Info size={14} className="kb-info-ico" />
        <span className="kb-info-text">
          支持 <b>PDF</b>、<b>Word(.docx)</b>、<b>文本/代码</b>、<b>图片</b>；单个文件 ≤{' '}
          <b>{limits?.max_mb ?? 50}MB</b>，上传后自动切分并建立索引
        </span>
        <label className="kb-topk">
          当前库 Top-K
          <select
            className="kb-topk-select"
            value={cur?.top_k ?? ''}
            disabled={busy || !cur}
            onChange={(e) => changeColTopK(e.target.value)}
            title="这个知识库每次检索取几个片段。选「跟随全局」则使用全局默认值；不同库可以各不相同。"
          >
            <option value="">跟随全局（{topK}）</option>
            {[2, 3, 4, 5, 6, 8, 10, 15].map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          段
        </label>
        <button className="kb-info-toggle" onClick={() => setShowTips((v) => !v)}>
          {showTips ? '收起' : '详细说明'}
        </button>
      </div>

      {showTips && limits && (
        <div className="kb-tips">
          <div>
            <b>支持的文件类型</b>：
            {limits.groups.map((g) => `${g.label}（${g.exts.join(' ')}）`).join('；')}
          </div>
          <div>
            <b>容量限制</b>：单个文件 ≤ {limits.max_mb}MB；抽取的正文最多索引{' '}
            {limits.max_content_chars.toLocaleString()} 字符（超长部分自动截断，扫描版 PDF
            需先做 OCR）
          </div>
          <div>
            <b>检索 Top-K 按知识库生效</b>：每个库可单独设置（顶部「当前库 Top-K」），
            未单独设置的库使用全局默认值。每次提问时，系统会从每个启用的知识库里各取它自己
            配置的条数（每段约 {limits.chunk_size} 字、相邻重叠 {limits.chunk_overlap} 字）交给模型参考。
            规范 / 教材类建议调小（2~3，答案更聚焦），会议记录、碎片笔记类建议调大（8~10，避免漏线索）。
          </div>
          <div className="kb-global-row">
            <b>全局默认 Top-K</b>
            <select
              className="kb-topk-select"
              value={topK}
              disabled={busy}
              onChange={(e) => changeTopK(Number(e.target.value))}
            >
              {[2, 3, 4, 5, 6, 8, 10, 15].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            段（未单独设置的知识库使用此值）
          </div>
          <div className="kb-tips-legend">
            已单独设置的库会在左侧列表显示 <span className="kb-badge topk">K4</span> 这样的标记。
          </div>
        </div>
      )}

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
                    {c.top_k != null && (
                      <span className="kb-badge topk" title={`该库单独设置：每次检索取 ${c.top_k} 段`}>
                        K{c.top_k}
                      </span>
                    )}
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
