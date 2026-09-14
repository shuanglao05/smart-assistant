/**
 * DocViewer.tsx —— 右侧文档查看器
 *
 * 职责：
 *   点击对话中引用的文档名后，从右侧滑出面板展示该文档的抽取正文，并提供下载。
 *
 * 组件属性（props）：
 *   fileId   —— 要查看的文件 id（详情由接口拉取）
 *   filename —— 文件名（用于面板标题）
 *   onClose  —— 关闭面板
 *
 * 组件状态：
 *   detail / loading / error —— 文档详情、加载中标记、错误信息
 *
 * 说明：
 *   展示的是上传时抽取并存进 files.content 的正文，而非原始文件的渲染，
 *   因此 PDF / Word 看到的是纯文本（原文排版不在本组件还原范围内）。
 */
import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Download, FileText, X } from 'lucide-react'
import { filesApi } from '../api'
import type { FileDetail } from '../types'

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/** 右侧文档查看器：点击消息中的引用文档名称后，从右侧滑入展示正文。 */
export default function DocViewer({
  fileId,
  filename,
  onClose,
}: {
  fileId: number
  filename: string
  onClose: () => void
}) {
  const [detail, setDetail] = useState<FileDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setDetail(null)
    filesApi
      .get(fileId)
      .then(({ data }) => {
        if (!cancelled) setDetail(data)
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.response?.data?.detail || '文档加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fileId])

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const download = () => {
    if (!detail) return
    const text = detail.content ?? ''
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = detail.filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="doc-backdrop" onClick={onClose} />
      <aside className="doc-viewer" role="dialog" aria-label="文档查看">
        <div className="doc-viewer-head">
          <div className="doc-viewer-title">
            <span className="doc-ico"><FileText size={18} /></span>
            <div className="doc-meta">
              <div className="doc-name" title={filename}>
                {filename}
              </div>
              {detail && <div className="doc-sub">{fmtSize(detail.size)}</div>}
            </div>
          </div>
          <div className="doc-viewer-actions">
            <button className="doc-btn" onClick={download} disabled={!detail} title="下载原文">
              <Download size={14} /> 下载
            </button>
            <button className="doc-btn close" onClick={onClose} title="关闭" aria-label="关闭">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="doc-viewer-body">
          {loading && <div className="doc-loading">加载中…</div>}
          {!loading && error && <div className="doc-error">{error}</div>}
          {!loading && !error && detail && (
            <div className="doc-content">
              {detail.content ? (
                <ReactMarkdown>{detail.content}</ReactMarkdown>
              ) : (
                <div className="doc-empty">（该文档无可读取的正文，可能是扫描版 PDF 或二进制文件）</div>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
