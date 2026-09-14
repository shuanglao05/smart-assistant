/**
 * TimetablePage.tsx —— 课表（周视图 + 周次切换）
 *
 * 职责：
 *   以「节次 × 星期」的表格渲染课程，支持切换周次、显示全部周、调整行高档位，
 *   并接入课表导入与手动增删课程。
 *
 * 组件状态：
 *   courses            —— 课程列表
 *   semStart / week    —— 学期开始日期与当前周次（开学日持久化在本机）
 *   showAll            —— 是否显示全部周（忽略周次过滤）
 *   importing / adding —— 导入弹窗与新增表单的开合
 *   rowH               —— 表格行高（持久化），列宽按比例联动
 *
 * 关键函数：
 *   saveSemStart —— 设置开学日期，用于把「第 N 周」换算成具体日期
 *   add / remove —— 手动增删课程
 *   changeRowH   —— 调整行高
 *
 * 说明：
 *   课程颜色由后端存十六进制值；渲染时按颜色亮度自动决定用深色还是浅色文字，
 *   保证浅色课程块上的文字同样可读。
 */
import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Wand2 } from 'lucide-react'
import PageShell from '../components/PageShell'
import CourseImport from '../components/CourseImport'
import GridZoom from '../components/GridZoom'
import { coursesApi } from '../api'
import type { Course } from '../types'

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const SECTIONS = Array.from({ length: 12 }, (_, i) => i + 1)
const COLORS = ['#4d6bfe', '#12a594', '#f5a623', '#8e4ec6', '#0ea5e9', '#ec4899', '#e5484d']
const START_KEY = 'tt_semester_start'
const ROW_KEY = 'tt_rowh'
const ROW_MIN = 36
const ROW_MAX = 76
const ROW_DEF = 48
const MAX_WEEK = 30

function loadRowH(): number {
  const v = Number(localStorage.getItem(ROW_KEY))
  return Number.isFinite(v) && v >= ROW_MIN && v <= ROW_MAX ? v : ROW_DEF
}

/** 把 "1-16" / "1,3,5-8" / "1-16单周" / "1-16双周" 解析成周次数组；空串 = 每周都有（返回 null） */
function parseWeeks(spec: string | null | undefined): number[] | null {
  if (!spec || !spec.trim()) return null
  const s = spec.replace(/周/g, '').trim()
  const odd = /单/.test(s)
  const even = /双/.test(s)
  const nums = new Set<number>()
  for (const part of s.split(/[,，、;；\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/)
    if (m) {
      const a = +m[1]
      const b = +m[2]
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) nums.add(i)
    } else {
      const n = parseInt(part, 10)
      if (!isNaN(n)) nums.add(n)
    }
  }
  let arr = [...nums].filter((n) => n >= 1 && n <= MAX_WEEK).sort((a, b) => a - b)
  if (odd || even) {
    if (arr.length === 0) arr = Array.from({ length: MAX_WEEK }, (_, i) => i + 1)
    arr = arr.filter((n) => (odd ? n % 2 === 1 : n % 2 === 0))
  }
  return arr
}

/** 这门课在第 week 周是否要上 */
function inWeek(c: Course, week: number): boolean {
  const ws = parseWeeks(c.weeks)
  return ws === null ? true : ws.includes(week)
}

const mondayOf = (d: Date) => {
  const x = new Date(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)) // 周一为起点
  x.setHours(0, 0, 0, 0)
  return x
}

/** 按背景色亮度选黑/白文字，保证任意配色下都看得清 */
function textOn(hex: string): string {
  const c = (hex || '#4d6bfe').replace('#', '')
  const r = parseInt(c.slice(0, 2), 16) || 0
  const g = parseInt(c.slice(2, 4), 16) || 0
  const b = parseInt(c.slice(4, 6), 16) || 0
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.62 ? '#10233a' : '#ffffff'
}

/** 课表：表格（节次 × 星期），顶栏控制学习周；可按周次过滤 */
export default function TimetablePage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [semStart, setSemStart] = useState<string>(() => localStorage.getItem(START_KEY) || '')
  const [week, setWeek] = useState(1)
  const [showAll, setShowAll] = useState(false)
  const [importing, setImporting] = useState(false)
  const [adding, setAdding] = useState(false)
  // 表格行高（档位），列宽按比例联动；保存在本机
  const [rowH, setRowH] = useState<number>(loadRowH)

  const changeRowH = (v: number) => {
    setRowH(v)
    localStorage.setItem(ROW_KEY, String(v))
  }
  // 添加表单
  const [name, setName] = useState('')
  const [teacher, setTeacher] = useState('')
  const [location, setLocation] = useState('')
  const [weekday, setWeekday] = useState(1)
  const [startSection, setStartSection] = useState(1)
  const [endSection, setEndSection] = useState(2)
  const [weeks, setWeeks] = useState('1-16')

  const load = () =>
    coursesApi
      .list()
      .then(({ data }) => setCourses(data))
      .catch(() => {})
  useEffect(() => {
    load()
  }, [])

  // 由「学期第一周周一」推算当前周次
  const currentWeek = useMemo(() => {
    if (!semStart) return 1
    const start = mondayOf(new Date(semStart))
    const diff = Math.floor((Date.now() - start.getTime()) / (7 * 86400000))
    return Math.max(1, diff + 1)
  }, [semStart])

  useEffect(() => {
    if (semStart) setWeek(currentWeek)
  }, [currentWeek, semStart])

  const saveSemStart = (v: string) => {
    setSemStart(v)
    if (v) localStorage.setItem(START_KEY, v)
    else localStorage.removeItem(START_KEY)
  }

  const visible = showAll ? courses : courses.filter((c) => inWeek(c, week))

  const add = async () => {
    if (!name.trim()) return
    try {
      await coursesApi.create({
        name: name.trim(),
        weekday,
        start_section: startSection,
        end_section: endSection,
        teacher: teacher.trim() || undefined,
        location: location.trim() || undefined,
        weeks: weeks.trim() || undefined,
        color: COLORS[courses.length % COLORS.length],
      })
      setName('')
      setTeacher('')
      setLocation('')
      setAdding(false)
      await load()
    } catch (e: any) {
      alert(`添加失败：${e?.response?.data?.detail || e?.message || e}`)
    }
  }

  const remove = async (c: Course) => {
    if (!confirm(`删除课程「${c.name}」？`)) return
    await coursesApi.remove(c.id)
    setCourses((p) => p.filter((x) => x.id !== c.id))
  }

  return (
    <PageShell
      icon={<CalendarDays size={18} />}
      title="课表"
      wide
      actions={
        <>
          <div className="tt-weekctl">
            <button className="tt-nav" onClick={() => setWeek((w) => Math.max(1, w - 1))} title="上一周">
              <ChevronLeft size={15} />
            </button>
            <span className="tt-week-cur">
              第 {week} 周
              {semStart && week === currentWeek && <em className="tt-now">本周</em>}
            </span>
            <button className="tt-nav" onClick={() => setWeek((w) => Math.min(MAX_WEEK, w + 1))} title="下一周">
              <ChevronRight size={15} />
            </button>
            {semStart && (
              <button className="tt-today" onClick={() => setWeek(currentWeek)}>
                回到本周
              </button>
            )}
            <label className="tt-showall" title="勾选后忽略周次，展示全部课程">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              全部周
            </label>
            <input
              className="input tt-start"
              type="date"
              value={semStart}
              onChange={(e) => saveSemStart(e.target.value)}
              title="学期第一周周一：设置后自动推算当前是第几周"
            />
            <GridZoom value={rowH} min={ROW_MIN} max={ROW_MAX} onChange={changeRowH} label="表格大小" />
          </div>
          <button className="btn" onClick={() => setImporting(true)} title="从图片或粘贴内容自动导入课表">
            <Wand2 size={15} /> 智能导入
          </button>
          <button className="btn primary" onClick={() => setAdding(true)}>
            <Plus size={14} /> 添加课程
          </button>
        </>
      }
    >
      <p className="tt-hint">
        用顶栏箭头切换学习周查看；周次写 <code>1-16单周</code>／<code>1,3,5</code> 都能识别。点课程块可删除。
      </p>

      <div
        className="tt-grid"
        style={
          {
            '--tt-rowh': `${rowH}px`,
            '--tt-colw': `${Math.round(rowH * 2.2)}px`,
          } as CSSProperties
        }
      >
        <div className="tt-corner">节次</div>
        {WEEKDAYS.map((w) => (
          <div key={w} className="tt-head">
            {w}
          </div>
        ))}
        {SECTIONS.map((s) => (
          <Fragment key={s}>
            <div className="tt-sec" style={{ gridColumn: 1, gridRow: s + 1 }}>
              {s}
            </div>
            {WEEKDAYS.map((w, i) => (
              <div
                key={w + s}
                className="tt-cell"
                style={{ gridColumn: i + 2, gridRow: s + 1 }}
              />
            ))}
          </Fragment>
        ))}
        {visible.map((c) => (
          <button
            key={c.id}
            className="tt-course"
            style={{
              gridColumn: c.weekday + 1,
              gridRow: c.start_section + 1,
              background: c.color || '#4d6bfe',
              color: textOn(c.color || '#4d6bfe'),
            }}
            title={`${c.name}${c.teacher ? ' · ' + c.teacher : ''}${
              c.location ? ' @' + c.location : ''
            }${c.weeks ? ' · ' + c.weeks + '周' : ''}（点击删除）`}
            onClick={() => remove(c)}
          >
            <span className="tt-course-name">{c.name}</span>
            {c.location && <span className="tt-course-sub">{c.location}</span>}
            {c.teacher && <span className="tt-course-sub">{c.teacher}</span>}
          </button>
        ))}
      </div>
      {visible.length === 0 && (
        <div className="tt-empty">{showAll ? '还没有课程，点右上角「智能导入」快速录入' : `第 ${week} 周没有课`}</div>
      )}

      {importing && (
        <CourseImport
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false)
            load()
          }}
        />
      )}

      {adding && (
        <div className="modal-overlay" onClick={() => setAdding(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">添加课程</div>
            <input
              className="input"
              placeholder="课程名"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <div className="tt-add-row">
              <input
                className="input"
                placeholder="老师"
                value={teacher}
                onChange={(e) => setTeacher(e.target.value)}
              />
              <input
                className="input"
                placeholder="地点"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            <div className="tt-add-row">
              <select className="input" value={weekday} onChange={(e) => setWeekday(+e.target.value)}>
                {WEEKDAYS.map((w, i) => (
                  <option key={w} value={i + 1}>
                    {w}
                  </option>
                ))}
              </select>
              <select className="input" value={startSection} onChange={(e) => setStartSection(+e.target.value)}>
                {SECTIONS.map((s) => (
                  <option key={s} value={s}>
                    第{s}节
                  </option>
                ))}
              </select>
              <span className="tt-dash">~</span>
              <select className="input" value={endSection} onChange={(e) => setEndSection(+e.target.value)}>
                {SECTIONS.map((s) => (
                  <option key={s} value={s}>
                    第{s}节
                  </option>
                ))}
              </select>
            </div>
            <input
              className="input"
              placeholder="周次，如 1-16 / 1-16单周"
              value={weeks}
              onChange={(e) => setWeeks(e.target.value)}
              title="支持 1-16、1,3,5-8、1-16单周、1-16双周；留空=每周"
            />
            <div className="modal-actions">
              <button className="btn" onClick={() => setAdding(false)}>
                取消
              </button>
              <button className="btn primary" onClick={add} disabled={!name.trim()}>
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
