/**
 * NotesPage.tsx —— 智能笔记（按天归档 + Markdown 编辑 / 预览）
 *
 * 职责：
 *   记事本式界面：左栏笔记列表（按日期分组、支持搜索），右栏编辑正文；
 *   支持编辑 / 预览切换，并可将全部笔记导出。
 *
 * 组件状态：
 *   notes / activeId       —— 笔记列表与当前打开项
 *   title / content / day  —— 当前笔记的标题、正文、所属日期
 *   mode                   —— 'edit' 编辑 | 'preview' 预览（预览走 Markdown 渲染）
 *   q / saving             —— 搜索关键词与保存中标记
 *
 * 关键函数：
 *   load / openNote / newNote / save / remove —— 笔记基本操作
 *   exportAll / buildHtmlDoc / base()         —— 导出：拼装 HTML 文档并下载
 *
 * 说明：
 *   正文支持 Markdown，预览复用统一的 Markdown 组件；
 *   day 字段形如 "2026-09-14"，既用于列表分组，也用于让 AI 归纳某天的记录。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Download,
  Eye,
  FileText,
  NotebookPen,
  Pencil,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import PageShell from '../components/PageShell'
import Markdown from '../components/Markdown'
import { notesApi } from '../api'
import { getGlobalModel } from '../globalModel'
import type { Note } from '../types'

const today = () => new Date().toISOString().slice(0, 10)

/** 触发浏览器下载 —— 即把内容「保存到本地」。mime 决定文件类型 */
function downloadText(filename: string, text: string, mime = 'text/markdown;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const safeName = (s: string) => (s || 'note').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)

/** 智能笔记：左侧按日期分组（可搜索），右侧编辑/预览（Markdown），支持导出 .md 与 AI 归纳 */
export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [day, setDay] = useState(today())
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [summarizing, setSummarizing] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ day: string; text: string } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  // 始终挂载的 Markdown 渲染区（编辑模式隐藏）：用于导出 HTML / PDF 时取真实渲染结果
  const htmlRef = useRef<HTMLDivElement>(null)

  const load = () =>
    notesApi
      .list()
      .then(({ data }) => setNotes(data))
      .catch(() => {})
  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return notes
    return notes.filter(
      (n) => n.title.toLowerCase().includes(kw) || n.content.toLowerCase().includes(kw),
    )
  }, [notes, q])

  const grouped = useMemo(() => {
    const map = new Map<string, Note[]>()
    for (const n of filtered) {
      const arr = map.get(n.day) || []
      arr.push(n)
      map.set(n.day, arr)
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [filtered])

  const openNote = (n: Note) => {
    setActiveId(n.id)
    setTitle(n.title)
    setContent(n.content)
    setDay(n.day)
    setMode('edit')
    setSummary(null)
    setSavedAt(null)
  }

  const newNote = () => {
    setActiveId(null)
    setTitle('')
    setContent('')
    setDay(today())
    setMode('edit')
    setSummary(null)
    setSavedAt(null)
  }

  const save = async () => {
    if (!title.trim() && !content.trim()) return
    setSaving(true)
    try {
      if (activeId == null) {
        const { data } = await notesApi.create({ title, content, day })
        setNotes((p) => [data, ...p])
        setActiveId(data.id)
      } else {
        const { data } = await notesApi.update(activeId, { title, content, day })
        setNotes((p) => p.map((x) => (x.id === activeId ? data : x)))
      }
      setSavedAt(new Date().toLocaleTimeString('zh-CN'))
    } catch (e: any) {
      alert(`保存失败：${e?.response?.data?.detail || e?.message || e}`)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    if (!confirm('删除这条笔记？')) return
    await notesApi.remove(id)
    setNotes((p) => p.filter((x) => x.id !== id))
    if (activeId === id) newNote()
  }

  const exportAll = () => {
    if (notes.length === 0) return
    const byDay = new Map<string, Note[]>()
    for (const n of [...notes].sort((a, b) => (a.day < b.day ? 1 : -1))) {
      const arr = byDay.get(n.day) || []
      arr.push(n)
      byDay.set(n.day, arr)
    }
    const parts = [`# 我的笔记\n`, `_导出时间：${new Date().toLocaleString('zh-CN')}_\n`]
    for (const [d, list] of byDay) {
      parts.push(`\n## ${d}\n`)
      for (const n of list) parts.push(`\n### ${n.title || '无标题'}\n\n${n.content}\n`)
    }
    downloadText(`我的笔记-${today()}.md`, parts.join('\n'))
  }

  // ---- 多格式导出（全部零依赖）----
  // HTML / PDF / Word 都用「实时渲染出的 HTML」生成，保证样式与预览一致（含 mermaid 图）
  const buildHtmlDoc = () => {
    const inner = htmlRef.current?.innerHTML || ''
    const css = `body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Microsoft YaHei",sans-serif;line-height:1.75;max-width:820px;margin:40px auto;padding:0 22px;color:#222}h1,h2,h3{line-height:1.3}pre{background:#f5f6f8;padding:12px 14px;border-radius:8px;overflow:auto}code{background:#f0f1f3;padding:1px 5px;border-radius:4px;font-size:.9em}blockquote{border-left:3px solid #d0d3d8;margin:0;padding-left:12px;color:#666}table{border-collapse:collapse}th,td{border:1px solid #d0d3d8;padding:6px 10px}img,svg{max-width:100%;height:auto}.mermaid-tools,.mermaid-tip{display:none}`
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(
      title || '笔记',
    )}</title><style>${css}</style></head><body><h1>${escapeHtml(
      title || '无标题',
    )}</h1><p style="color:#888;font-size:13px">日期：${day}</p>${inner}</body></html>`
  }
  const base = () => `${day}-${safeName(title)}`

  const exportMd = () =>
    downloadText(`${base()}.md`, `# ${title || '无标题'}\n\n> 日期：${day}\n\n${content}\n`)
  const exportTxt = () =>
    downloadText(
      `${base()}.txt`,
      `${title || '无标题'}\n日期：${day}\n\n${content}\n`,
      'text/plain;charset=utf-8',
    )
  const exportJson = () =>
    downloadText(
      `${base()}.json`,
      JSON.stringify({ title, day, content, exported_at: new Date().toISOString() }, null, 2),
      'application/json;charset=utf-8',
    )
  const exportHtml = () => downloadText(`${base()}.html`, buildHtmlDoc(), 'text/html;charset=utf-8')
  const exportDoc = () => downloadText(`${base()}.doc`, buildHtmlDoc(), 'application/msword')
  const exportPdf = () => {
    const w = window.open('', '_blank')
    if (!w) {
      alert('浏览器拦截了弹出窗口，请允许后重试')
      return
    }
    w.document.write(buildHtmlDoc())
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 350) // 在打印面板里选「另存为 PDF」
  }

  const summarize = async (d: string) => {
    setSummarizing(d)
    setSummary(null)
    try {
      const g = getGlobalModel()
      const { data } = await notesApi.summarize(d, g?.provider, g?.model)
      setSummary({ day: d, text: data.summary })
    } catch (e: any) {
      alert(e?.response?.data?.detail || 'AI 归纳失败')
    } finally {
      setSummarizing(null)
    }
  }

  const charCount = content.replace(/\s/g, '').length

  return (
    <PageShell
      icon={<NotebookPen size={18} />}
      title="智能笔记"
      actions={
        <button
          className="btn"
          onClick={exportAll}
          disabled={notes.length === 0}
          title="把所有笔记导出为一个 .md 文件（保存到本地）"
        >
          <Download size={15} /> 导出全部
        </button>
      }
    >
      <div className="notes-grid">
        <div className="notes-side">
          <button className="btn primary notes-new" onClick={newNote}>
            <Plus size={14} /> 新建笔记
          </button>
          <div className="notes-search">
            <Search size={13} />
            <input
              className="notes-search-input"
              placeholder="搜索笔记…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {grouped.length === 0 && (
            <div className="notes-empty">{q ? '没有匹配的笔记' : '还没有笔记'}</div>
          )}
          {grouped.map(([d, list]) => (
            <div key={d} className="notes-day-group">
              <div className="notes-day-head">
                <span className="notes-day">{d}</span>
                <button
                  className="notes-ai"
                  onClick={() => summarize(d)}
                  disabled={summarizing === d}
                  title="让 AI 归纳这一天的笔记"
                >
                  <Sparkles size={12} /> {summarizing === d ? '归纳中…' : 'AI 归纳'}
                </button>
              </div>
              {list.map((n) => (
                <div
                  key={n.id}
                  className={`notes-item ${n.id === activeId ? 'active' : ''}`}
                  onClick={() => openNote(n)}
                >
                  <div className="notes-item-title">{n.title || '（无标题）'}</div>
                  <div className="notes-item-content">{n.content.slice(0, 40)}</div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="notes-main">
          <div className="notes-toolbar">
            <div className="notes-mode">
              <button
                className={`seg-btn ${mode === 'edit' ? 'active' : ''}`}
                onClick={() => setMode('edit')}
              >
                <Pencil size={12} /> 编辑
              </button>
              <button
                className={`seg-btn ${mode === 'preview' ? 'active' : ''}`}
                onClick={() => setMode('preview')}
              >
                <Eye size={12} /> 预览
              </button>
            </div>
            <span className="notes-meta">
              {charCount} 字{savedAt ? ` · 已保存 ${savedAt}` : ''}
            </span>
          </div>

          <div className="notes-editor-head">
            <input
              className="input notes-title"
              placeholder="标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              className="input notes-day-input"
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              title="归档日期"
            />
          </div>

          {mode === 'edit' && (
            <textarea
              className="notes-content"
              placeholder="写点什么…（支持 Markdown：标题、列表、表格、代码块、```mermaid 图表）"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          )}
          {/* 始终挂载：预览模式下可见；编辑模式下隐藏但仍渲染，供 HTML/PDF/Word 导出取内容 */}
          <div
            ref={htmlRef}
            className="notes-preview"
            style={mode === 'edit' ? { display: 'none' } : undefined}
          >
            {content.trim() ? (
              <Markdown content={content} />
            ) : (
              <span className="notes-preview-empty">（空）</span>
            )}
          </div>

          <div className="notes-actions">
            <button className="btn primary" onClick={save} disabled={saving}>
              <Save size={14} /> {saving ? '保存中…' : '保存'}
            </button>
            <div className="notes-export">
              <button
                className="btn"
                onClick={() => setExportOpen((v) => !v)}
                disabled={!title.trim() && !content.trim()}
                title="导出为不同格式（保存到本地）"
              >
                <FileText size={14} /> 导出 ▾
              </button>
              {exportOpen && (
                <div className="notes-export-menu" onMouseLeave={() => setExportOpen(false)}>
                  <button
                    onClick={() => {
                      exportMd()
                      setExportOpen(false)
                    }}
                  >
                    Markdown（.md）
                  </button>
                  <button
                    onClick={() => {
                      exportTxt()
                      setExportOpen(false)
                    }}
                  >
                    纯文本（.txt）
                  </button>
                  <button
                    onClick={() => {
                      exportHtml()
                      setExportOpen(false)
                    }}
                  >
                    网页（.html）
                  </button>
                  <button
                    onClick={() => {
                      exportPdf()
                      setExportOpen(false)
                    }}
                  >
                    PDF（打印另存）
                  </button>
                  <button
                    onClick={() => {
                      exportDoc()
                      setExportOpen(false)
                    }}
                  >
                    Word（.doc）
                  </button>
                  <button
                    onClick={() => {
                      exportJson()
                      setExportOpen(false)
                    }}
                  >
                    JSON（.json）
                  </button>
                </div>
              )}
            </div>
            {activeId != null && (
              <button className="btn" onClick={() => remove(activeId)}>
                <Trash2 size={14} /> 删除
              </button>
            )}
          </div>

          {summary && (
            <div className="notes-summary">
              <div className="notes-summary-head">
                <Sparkles size={13} /> {summary.day} 的 AI 归纳
                <button
                  className="notes-summary-export"
                  onClick={() =>
                    downloadText(
                      `${summary.day}-AI归纳.md`,
                      `# ${summary.day} 笔记归纳\n\n${summary.text}\n`,
                    )
                  }
                  title="导出为 .md"
                >
                  <Download size={12} />
                </button>
              </div>
              <pre className="notes-summary-body">{summary.text}</pre>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  )
}
