import { useMemo, useState } from 'react'
import PageShell from '../components/PageShell'

const WEEK = ['一', '二', '三', '四', '五', '六', '日']
const STORE_KEY = 'calendar.memos'

function ymd(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function loadMemos(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
  } catch {
    return {}
  }
}

export default function CalendarPage() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth()) // 0-11
  const [selected, setSelected] = useState(ymd(today.getFullYear(), today.getMonth(), today.getDate()))
  const [memos, setMemos] = useState<Record<string, string>>(loadMemos)
  const [draft, setDraft] = useState(() => loadMemos()[ymd(today.getFullYear(), today.getMonth(), today.getDate())] || '')

  // 月视图：前置空格（周一开头）+ 当月天数
  const cells = useMemo(() => {
    const first = new Date(year, month, 1)
    const lead = (first.getDay() + 6) % 7 // 周一=0
    const days = new Date(year, month + 1, 0).getDate()
    return [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  }, [year, month])

  const moveMonth = (delta: number) => {
    let m = month + delta
    let y = year
    if (m < 0) {
      m = 11
      y -= 1
    } else if (m > 11) {
      m = 0
      y += 1
    }
    setMonth(m)
    setYear(y)
  }

  const pickDate = (d: number) => {
    // 先把当前草稿存下来，再切换
    saveDraft()
    const key = ymd(year, month, d)
    setSelected(key)
    setDraft(memos[key] || '')
  }

  const saveDraft = () => {
    setMemos((prev) => {
      const next = { ...prev, [selected]: draft }
      localStorage.setItem(STORE_KEY, JSON.stringify(next))
      return next
    })
  }

  const goToday = () => {
    saveDraft()
    const y = today.getFullYear()
    const m = today.getMonth()
    const d = today.getDate()
    setYear(y)
    setMonth(m)
    const key = ymd(y, m, d)
    setSelected(key)
    setDraft(memos[key] || '')
  }

  const todayKey = ymd(today.getFullYear(), today.getMonth(), today.getDate())
  const hasMemo = (d: number) => !!memos[ymd(year, month, d)]

  return (
    <PageShell
      icon="📅"
      title="日历"
      actions={
        <div className="cal-nav">
          <button className="btn" onClick={() => moveMonth(-1)} title="上个月">
            ‹
          </button>
          <span className="cal-title">
            {year} 年 {month + 1} 月
          </span>
          <button className="btn" onClick={() => moveMonth(1)} title="下个月">
            ›
          </button>
          <button className="btn" onClick={goToday}>
            今天
          </button>
        </div>
      }
    >
      <div className="cal-wrap">
        <div className="cal-grid-head">
          {WEEK.map((w) => (
            <div key={w} className="cal-week">
              {w}
            </div>
          ))}
        </div>
        <div className="cal-grid">
          {cells.map((d, i) => {
            if (d == null) return <div key={`e${i}`} className="cal-cell empty" />
            const key = ymd(year, month, d)
            const isToday = key === todayKey
            const isSel = key === selected
            const weekend = (new Date(year, month, d).getDay() + 6) % 7 >= 5
            return (
              <button
                key={key}
                className={`cal-cell ${isToday ? 'today' : ''} ${isSel ? 'sel' : ''} ${weekend ? 'weekend' : ''}`}
                onClick={() => pickDate(d)}
              >
                <span className="cal-day">{d}</span>
                {hasMemo(d) && <span className="cal-dot" />}
              </button>
            )
          })}
        </div>
      </div>

      <div className="cal-memo">
        <div className="settings-label">{selected} 备忘</div>
        <textarea
          className="input cal-memo-input"
          rows={5}
          placeholder="给这天写点什么…（自动保存在本机）"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={saveDraft}
        />
        <div className="cal-memo-actions">
          <button className="btn primary" onClick={saveDraft}>
            保存
          </button>
          <span className="settings-hint">备忘保存在浏览器本地（localStorage），换设备不会同步。</span>
        </div>
      </div>
    </PageShell>
  )
}
