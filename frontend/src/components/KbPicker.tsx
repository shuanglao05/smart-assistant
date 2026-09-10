import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Check, Settings } from 'lucide-react'
import { kbApi, sessionApi } from '../api'
import type { KbCollection } from '../types'

/**
 * 输入框旁的知识库入口：平时一个图标（角标显示本次启用的库数），
 * 点击展开知识库列表供勾选；勾选状态存在当前会话的 active_kb_ids 上。
 * 不勾选 = 检索全部知识库；勾选 = 只在选中的库里检索。
 */
export default function KbPicker({
  sessionId,
  activeKbIds,
  onChanged,
}: {
  sessionId?: number
  activeKbIds: number[]
  onChanged?: () => void
}) {
  const [cols, setCols] = useState<KbCollection[]>([])
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    kbApi
      .collections()
      .then(({ data }) => setCols(data))
      .catch(() => setCols([]))
  }, [])

  // 点击面板外或按 Esc 收起
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const save = async (next: number[]) => {
    if (sessionId == null) return
    try {
      await sessionApi.update(sessionId, { active_kb_ids: next })
      onChanged?.()
    } catch (e: any) {
      alert(`知识库启用失败：${e?.response?.data?.detail || e?.message || e}`)
    }
  }

  const toggle = (id: number) =>
    save(activeKbIds.includes(id) ? activeKbIds.filter((x) => x !== id) : [...activeKbIds, id])

  const count = activeKbIds.length

  return (
    <div className="skill-picker" ref={wrapRef}>
      <button
        className={`skill-picker-btn ${open ? 'on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="知识库（选择本次对话检索哪些库）"
        aria-label="知识库"
      >
        <BookOpen size={14} />
        {count > 0 && <span className="skill-badge">{count}</span>}
      </button>

      {open && (
        <div className="skill-pop">
          <div className="skill-pop-head">
            <span>本次对话检索的知识库</span>
            {count > 0 && (
              <button className="skill-pop-clear" onClick={() => save([])} title="不限定，检索全部库">
                全部库
              </button>
            )}
          </div>

          <div className="skill-pop-list">
            {cols.length === 0 ? (
              <div className="skill-pop-empty">还没有知识库，点下面「管理知识库」去新建 / 上传</div>
            ) : (
              cols.map((c) => {
                const on = activeKbIds.includes(c.id)
                return (
                  <button
                    key={c.id}
                    className={`skill-pop-card ${on ? 'on' : ''}`}
                    onClick={() => toggle(c.id)}
                    title={c.name}
                  >
                    <span className="skill-pop-check">{on ? <Check size={11} /> : ''}</span>
                    <span className="skill-pop-body">
                      <span className="skill-pop-name">{c.name}</span>
                      <span className="skill-pop-desc">
                        {c.files} 文档 · {c.chunks} 片段
                      </span>
                    </span>
                  </button>
                )
              })
            )}
          </div>

          <button
            className="skill-pop-manage"
            onClick={() => {
              setOpen(false)
              navigate('/knowledge')
            }}
          >
            <Settings size={13} /> 管理知识库
          </button>
        </div>
      )}
    </div>
  )
}
