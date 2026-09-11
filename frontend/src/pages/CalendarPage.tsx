import { useMemo, useState, type CSSProperties } from 'react'
import { CalendarDays } from 'lucide-react'
import PageShell from '../components/PageShell'
import GridZoom from '../components/GridZoom'

const WEEK = ['一', '二', '三', '四', '五', '六', '日']
const STORE_KEY = 'calendar.memos'
const CELL_KEY = 'calendar.cell'
const CELL_MIN = 30
const CELL_MAX = 76
const CELL_DEF = 46

function loadCell(): number {
  const v = Number(localStorage.getItem(CELL_KEY))
  return Number.isFinite(v) && v >= CELL_MIN && v <= CELL_MAX ? v : CELL_DEF
}

// 公历固定节日（key 为 月-日，月份从 1 开始）
const SOLAR_FESTIVALS: Record<string, string> = {
  '1-1': '元旦',
  '2-14': '情人节',
  '3-8': '妇女节',
  '3-12': '植树节',
  '4-1': '愚人节',
  '5-1': '劳动节',
  '5-4': '青年节',
  '6-1': '儿童节',
  '7-1': '建党节',
  '8-1': '建军节',
  '9-10': '教师节',
  '10-1': '国庆节',
  '10-2': '国庆节',
  '10-3': '国庆节',
  '12-24': '平安夜',
  '12-25': '圣诞节',
}

// 农历节日（年份不固定，仅收录已核实的年份；key 为 月-日，月份从 1 开始）
const LUNAR_FESTIVALS: Record<number, Record<string, string>> = {
  2025: {
    '1-29': '春节',
    '2-12': '元宵',
    '4-4': '清明',
    '5-31': '端午',
    '8-29': '七夕',
    '10-6': '中秋',
    '10-29': '重阳',
  },
  2026: {
    '1-26': '腊八',
    '2-17': '春节',
    '3-3': '元宵',
    '3-20': '龙抬头',
    '4-5': '清明',
    '6-19': '端午',
    '8-19': '七夕',
    '9-25': '中秋',
    '10-18': '重阳',
    '12-22': '冬至',
  },
  2027: {
    '1-15': '腊八',
    '2-6': '春节',
    '2-20': '元宵',
    '4-5': '清明',
    '6-9': '端午',
    '8-8': '七夕',
    '9-15': '中秋',
    '10-8': '重阳',
  },
}

function festivalOf(y: number, m: number, d: number): string | undefined {
  const key = `${m + 1}-${d}`
  return LUNAR_FESTIVALS[y]?.[key] ?? SOLAR_FESTIVALS[key]
}

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
  const [cell, setCell] = useState<number>(loadCell)

  const changeCell = (v: number) => {
    setCell(v)
    localStorage.setItem(CELL_KEY, String(v))
  }

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
      icon={<CalendarDays size={18} />}
      title="日历"
      model={null}
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
          <GridZoom value={cell} min={CELL_MIN} max={CELL_MAX} onChange={changeCell} label="格子大小" />
        </div>
      }
    >
      <div className="cal-wrap" style={{ '--cal-cell': `${cell}px` } as CSSProperties}>
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
            const fest = festivalOf(year, month, d)
            return (
              <button
                key={key}
                className={`cal-cell ${isToday ? 'today' : ''} ${isSel ? 'sel' : ''} ${weekend ? 'weekend' : ''} ${fest ? 'has-fest' : ''}`}
                onClick={() => pickDate(d)}
              >
                {fest && <span className="cal-fest">{fest}</span>}
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
