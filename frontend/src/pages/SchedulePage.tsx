import { useEffect, useState } from 'react'
import { CalendarClock, Plus, Trash2 } from 'lucide-react'
import PageShell from '../components/PageShell'
import { schedulesApi } from '../api'
import type { Schedule } from '../types'

const fmt = (epoch: number) =>
  new Date(epoch * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

/** 日程规划：添加日程，开始前 5 分钟由后端自动在通知中心提醒 */
export default function SchedulePage() {
  const [items, setItems] = useState<Schedule[]>([])
  const [title, setTitle] = useState('')
  const [when, setWhen] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () =>
    schedulesApi
      .list()
      .then(({ data }) => setItems(data))
      .catch(() => {})
  useEffect(() => {
    load()
  }, [])

  const add = async () => {
    if (!title.trim() || !when) return
    setSaving(true)
    try {
      await schedulesApi.create({
        title: title.trim(),
        start_at: new Date(when).getTime() / 1000,
        note: note.trim() || undefined,
      })
      setTitle('')
      setWhen('')
      setNote('')
      await load()
    } catch (e: any) {
      alert(`添加失败：${e?.response?.data?.detail || e?.message || e}`)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    if (!confirm('删除该日程？')) return
    await schedulesApi.remove(id)
    setItems((p) => p.filter((x) => x.id !== id))
  }

  const now = Date.now() / 1000

  return (
    <PageShell icon={<CalendarClock size={18} />} title="日程规划" model={null}>
      <div className="sched-add">
        <input
          className="input"
          placeholder="日程标题，如：组会 / 交作业"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="input"
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
        <input
          className="input"
          placeholder="备注（可选）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button className="btn primary" onClick={add} disabled={saving || !title.trim() || !when}>
          <Plus size={14} /> 添加
        </button>
      </div>
      <p className="sched-hint">日程开始前 5 分钟，会自动在右上角「通知中心」提醒你。</p>

      {items.length === 0 ? (
        <div className="sched-empty">还没有日程</div>
      ) : (
        <div className="sched-list">
          {items.map((s) => {
            const past = s.start_at <= now
            const soon = !past && s.start_at - now <= 300
            return (
              <div key={s.id} className={`sched-item ${past ? 'past' : ''} ${soon ? 'soon' : ''}`}>
                <div className="sched-time">{fmt(s.start_at)}</div>
                <div className="sched-body">
                  <div className="sched-title">{s.title}</div>
                  {s.note && <div className="sched-note">{s.note}</div>}
                </div>
                {soon && <span className="sched-badge">即将开始</span>}
                <button className="sched-del" onClick={() => remove(s.id)} title="删除">
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </PageShell>
  )
}
