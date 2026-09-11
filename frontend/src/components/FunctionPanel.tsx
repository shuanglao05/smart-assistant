import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  BookOpen,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  CloudSun,
  GripVertical,
  ListChecks,
  MessageSquare,
  NotebookPen,
  Puzzle,
  RotateCcw,
  Table,
  Timer,
} from 'lucide-react'

/** 右侧功能入口：点击跳转到独立页面（不再是原地展开面板） */
const FUNCS: { path: string; icon: ReactNode; name: string; desc: string }[] = [
  { path: '/', icon: <MessageSquare size={18} />, name: '对话', desc: 'AI 聊天助手' },
  { path: '/skills', icon: <Puzzle size={18} />, name: '技能', desc: '技能库与人设' },
  { path: '/knowledge', icon: <BookOpen size={18} />, name: '知识库', desc: '上传资料与检索' },
  { path: '/notes', icon: <NotebookPen size={18} />, name: '笔记', desc: '按日期整理笔记' },
  { path: '/schedule', icon: <CalendarClock size={18} />, name: '日程', desc: '规划与提前提醒' },
  { path: '/timetable', icon: <Table size={18} />, name: '课表', desc: '一周课程表' },
  { path: '/weather', icon: <CloudSun size={18} />, name: '天气', desc: '实况与未来 3 天' },
  { path: '/todos', icon: <ListChecks size={18} />, name: '待办', desc: '待办事项管理' },
  { path: '/timer', icon: <Timer size={18} />, name: '计时器', desc: '倒计时 / 秒表' },
  { path: '/calendar', icon: <CalendarDays size={18} />, name: '日历', desc: '月视图与备忘' },
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
  // 记录本次按下是否落在拖拽手柄上：只有手柄才允许拖动，避免整块可拖导致"点击被当成拖拽吞掉"
  const dragFromHandle = useRef(false)

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
          <RotateCcw size={12} />
          重置
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
              onMouseDown={(e) => {
                // 只有按在左侧手柄上才允许拖动；按在别处时点击照常生效
                dragFromHandle.current = !!(e.target as HTMLElement).closest?.('.func-drag')
              }}
              onDragStart={(e) => {
                if (!dragFromHandle.current) {
                  e.preventDefault() // 非手柄处按下 → 取消拖拽，保证点击可用于切换页面
                  return
                }
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
                <GripVertical size={14} />
              </span>
              <span className="func-icon">{f.icon}</span>
              <span className="func-text">
                <span className="func-name">{f.name}</span>
                <span className="func-desc">{f.desc}</span>
              </span>
              <span className="func-arrow">
                <ChevronRight size={16} />
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
