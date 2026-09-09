import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/** 右侧功能入口：点击跳转到独立页面（不再是原地展开面板） */
const FUNCS: { path: string; icon: string; name: string; desc: string }[] = [
  { path: '/', icon: '💬', name: '对话', desc: 'AI 聊天助手' },
  { path: '/weather', icon: '🌤', name: '天气', desc: '实况与未来 3 天' },
  { path: '/skills', icon: '🧩', name: '技能', desc: '技能库与人设' },
  { path: '/todos', icon: '✅', name: '待办', desc: '待办事项管理' },
  { path: '/timer', icon: '⏱', name: '计时器', desc: '倒计时 / 秒表' },
  { path: '/calendar', icon: '📅', name: '日历', desc: '月视图与备忘' },
]

const ORDER_KEY = 'funcOrder'

/** 从 localStorage 读取顺序；合并规则：已保存的有效项排前，新增功能补到末尾 */
function loadOrder(): string[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    if (raw) {
      const saved: string[] = JSON.parse(raw)
      const valid = saved.filter((p) => FUNCS.some((f) => f.path === p))
      const rest = FUNCS.map((f) => f.path).filter((p) => !valid.includes(p))
      return [...new Set(valid), ...rest]
    }
  } catch {
    /* 损坏则回退默认 */
  }
  return FUNCS.map((f) => f.path)
}

export default function FunctionPanel() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const [order, setOrder] = useState<string[]>(() => loadOrder())
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const dragIndex = useRef<number | null>(null)

  const persist = (next: string[]) => localStorage.setItem(ORDER_KEY, JSON.stringify(next))

  const onDrop = (targetIdx: number) => {
    const from = dragIndex.current
    setOverIdx(null)
    dragIndex.current = null
    if (from == null || from === targetIdx) return
    const next = [...order]
    const [moved] = next.splice(from, 1)
    next.splice(targetIdx, 0, moved)
    setOrder(next)
    persist(next)
  }

  const resetOrder = () => {
    const def = FUNCS.map((f) => f.path)
    setOrder(def)
    persist(def)
  }

  return (
    <aside className="func-panel">
      <div className="func-panel-head">
        <span>功能</span>
        <button
          className="func-reset"
          onClick={resetOrder}
          title="恢复默认顺序"
          disabled={order.join() === FUNCS.map((f) => f.path).join()}
        >
          ↺ 重置
        </button>
      </div>
      <div className="func-list">
        {order.map((p, idx) => {
          const f = FUNCS.find((x) => x.path === p)
          if (!f) return null
          return (
            <button
              key={p}
              className={`func-item ${pathname === p ? 'active' : ''} ${
                dragIndex.current === idx ? 'dragging' : ''
              } ${overIdx === idx && dragIndex.current !== idx ? 'drag-over' : ''}`}
              draggable
              onDragStart={(e) => {
                dragIndex.current = idx
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setOverIdx(idx)
              }}
              onDragLeave={() => setOverIdx((v) => (v === idx ? null : v))}
              onDrop={(e) => {
                e.preventDefault()
                onDrop(idx)
              }}
              onDragEnd={() => {
                // 拖拽结束（无论成功/取消/Esc）都必须清状态，否则源项会卡在 .dragging（opacity:0.4）变灰
                dragIndex.current = null
                setOverIdx(null)
              }}
              onClick={() => navigate(p)}
            >
              <span className="func-drag" title="拖拽调整顺序" aria-hidden>
                ⠿
              </span>
              <span className="func-icon">{f.icon}</span>
              <span className="func-text">
                <span className="func-name">{f.name}</span>
                <span className="func-desc">{f.desc}</span>
              </span>
              <span className="func-arrow">›</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
