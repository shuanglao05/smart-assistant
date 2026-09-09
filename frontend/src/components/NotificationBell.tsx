import { useEffect, useRef, useState } from 'react'
import { notificationApi } from '../api'
import type { NotificationItem } from '../types'

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  const loadUnread = () =>
    notificationApi
      .unread()
      .then(({ data }) => setUnread(data.count))
      .catch(() => setUnread(0))

  const loadList = () =>
    notificationApi
      .list()
      .then(({ data }) => setItems(data))
      .catch(() => setItems([]))

  // 打开时拉列表；定时刷新未读（供 AI 通知/其他入口产生的新提醒及时亮角标）
  useEffect(() => {
    loadUnread()
    const t = window.setInterval(loadUnread, 15000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (open) loadList()
  }, [open])

  // 点击外部关闭下拉
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const markRead = async (id: number) => {
    await notificationApi.markRead(id)
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)))
    loadUnread()
  }

  const readAll = async () => {
    await notificationApi.readAll()
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })))
    loadUnread()
  }

  const clearAll = async () => {
    if (!confirm('清空全部通知？')) return
    await notificationApi.clearAll()
    setItems([])
    loadUnread()
  }

  const sendTest = async () => {
    await notificationApi.create('测试通知 ✓', '通知中心工作正常。你也可以对 AI 说「提醒我…」让它发提醒。', 'remind')
    await loadList()
    loadUnread()
  }

  return (
    <div className="bell-wrap" ref={wrapRef}>
      <button
        className={`topbar-btn bell-btn ${open ? 'active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="通知中心"
      >
        🔔{unread > 0 && <span className="bell-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="bell-panel">
          <div className="bell-head">
            <span>通知中心</span>
            <div className="bell-ops">
              {unread > 0 && (
                <button className="bell-op" onClick={readAll}>
                  全部已读
                </button>
              )}
              <button className="bell-op" onClick={sendTest} title="发一条测试通知">
                测试
              </button>
              <button className="bell-op danger" onClick={clearAll}>
                清空
              </button>
            </div>
          </div>
          <div className="bell-list">
            {items.length === 0 ? (
              <div className="bell-empty">
                <div className="bell-empty-ico">🔕</div>
                <p>暂无通知</p>
                <span>试试对 AI 说「提醒我 30 分钟后喝水」</span>
              </div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={`bell-item ${n.is_read ? '' : 'unread'}`}
                  onClick={() => !n.is_read && markRead(n.id)}
                >
                  <div className="bell-item-title">
                    <span className={`bell-dot type-${n.type}`} />
                    {n.title}
                  </div>
                  {n.body && <div className="bell-item-body">{n.body}</div>}
                  <div className="bell-item-time">
                    {new Date(n.created_at).toLocaleString('zh-CN')}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
