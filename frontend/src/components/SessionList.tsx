import { useEffect, useRef, useState } from 'react'
import { ChevronsLeft, ChevronsRight, MessageSquare, Pencil, Plus, Search, X } from 'lucide-react'
import { searchApi } from '../api'
import type { SearchHit, Session, UserProfile } from '../types'

/** 头像可能是表情（预设），也可能是 data URL / http 图片（上传） */
function isImageAvatar(a: string) {
  return a.startsWith('data:') || a.startsWith('http://') || a.startsWith('https://')
}

export default function SessionList({
  sessions,
  currentId,
  sidebarOpen,
  onToggleSidebar,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  onLogout,
  profile,
}: {
  sessions: Session[]
  currentId: number | null
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onSelect: (id: number) => void
  onCreate: () => void
  onDelete: (id: number) => void
  onRename: (id: number, title: string) => void
  onLogout: () => void
  profile: UserProfile | null
}) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchHit[]>([])
  const timerRef = useRef<number | null>(null)

  const searching = q.trim().length > 0

  // 搜索历史消息：防抖 250ms
  useEffect(() => {
    const kw = q.trim()
    if (!kw) {
      setResults([])
      return
    }
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      searchApi
        .query(kw)
        .then(({ data }) => setResults(data))
        .catch(() => setResults([]))
    }, 250)
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [q])

  const openHit = (hit: SearchHit) => {
    onSelect(hit.conversation_id)
    setQ('')
    setResults([])
  }

  const startRename = (s: Session) => {
    setEditingId(s.id)
    setDraft(s.title || '')
  }

  const commit = () => {
    const t = draft.trim()
    if (editingId != null && t) onRename(editingId, t)
    setEditingId(null)
  }

  const avatar = profile?.avatar?.trim()
  const avatarNode = avatar ? (
    isImageAvatar(avatar) ? (
      <img src={avatar} alt="头像" />
    ) : (
      avatar
    )
  ) : (
    'AI'
  )

  return (
    <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
      <div className="brand">
        {sidebarOpen ? (
          <>
            <div className="brand-logo">{avatarNode}</div>
            <div className="brand-text">
              <div className="brand-name">智能助理</div>
              <div className="brand-user">
                {profile?.nickname || localStorage.getItem('username')}
              </div>
            </div>
            <button className="sidebar-toggle" onClick={onToggleSidebar} title="收起侧边栏">
              <ChevronsLeft size={15} />
            </button>
          </>
        ) : (
          <>
            <div
              className="brand-logo"
              title={profile?.nickname || localStorage.getItem('username') || ''}
            >
              {avatarNode}
            </div>
            <button className="sidebar-toggle" onClick={onToggleSidebar} title="展开侧边栏">
              <ChevronsRight size={15} />
            </button>
          </>
        )}
      </div>

      {sidebarOpen && (
        <>
          <button className="btn new-chat" onClick={onCreate}>
            <Plus size={14} /> 新建会话
          </button>

          <div className="search-area">
            <div className="search-row">
              <span className="search-ico"><Search size={13} /></span>
              <input
                className="sidebar-search"
                placeholder="搜索全部历史…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setQ('')
                    setResults([])
                  }
                }}
              />
              {searching && (
                <button
                  className="search-clear"
                  onClick={() => {
                    setQ('')
                    setResults([])
                  }}
                  title="清空搜索"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {searching && (
              <div className="search-results">
                {results.length === 0 ? (
                  <div className="search-empty">没有匹配结果</div>
                ) : (
                  results.map((r, i) => (
                    <div key={i} className="search-item" onClick={() => openHit(r)} title={r.title}>
                      <span className={`search-tag ${r.role}`}>
                        {r.role === 'user' ? '我' : r.role === 'assistant' ? 'AI' : '会话'}
                      </span>
                      <div className="search-body">
                        <div className="search-title">{r.title}</div>
                        <div className="search-snippet">{r.content}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {!searching && (
            <div className="session-scroll">
            {sessions.map((s) => (
              <div
                key={s.id}
                className={`session-item ${s.id === currentId ? 'active' : ''}`}
                onClick={() => onSelect(s.id)}
                onDoubleClick={() => startRename(s)}
              >
                <MessageSquare size={14} className="session-ico" />
                {editingId === s.id ? (
                  <input
                    className="rename-input"
                    value={draft}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commit()
                      else if (e.key === 'Escape') setEditingId(null)
                    }}
                    onBlur={commit}
                  />
                ) : (
                  <span className="session-title" title="双击重命名">
                    {s.title || '新对话'}
                  </span>
                )}
                <button
                  className="session-edit"
                  title="重命名"
                  onClick={(e) => {
                    e.stopPropagation()
                    startRename(s)
                  }}
                >
                  <Pencil size={13} />
                </button>
                <button
                  className="session-del"
                  title="删除"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm('删除该会话及其消息？')) onDelete(s.id)
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          )}

          <button className="logout" onClick={onLogout}>
            退出登录
          </button>
        </>
      )}
    </aside>
  )
}
