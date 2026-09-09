import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { llmApi, sessionApi } from '../api'
import type { LlmConfigPayload, LlmOption, Session, UserProfile } from '../types'
import SessionList from './SessionList'
import ChatWindow from './ChatWindow'
import FunctionPanel from './FunctionPanel'
import WeatherPage from '../pages/WeatherPage'
import SkillsPage from '../pages/SkillsPage'
import TodosPage from '../pages/TodosPage'
import TimerPage from '../pages/TimerPage'
import CalendarPage from '../pages/CalendarPage'

/** 登录后主布局：左=会话列表，中=路由内容（对话/功能页），右=功能入口 */
export default function MainLayout({
  profile,
  onProfileUpdate,
  onLogout,
}: {
  profile: UserProfile | null
  onProfileUpdate: (p: UserProfile) => void
  onLogout: () => void
}) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [currentId, setCurrentId] = useState<number | null>(null)
  const [options, setOptions] = useState<LlmOption[]>([])
  const [todoKey, setTodoKey] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('sidebarOpen') !== '0')
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem('panelOpen') !== '0')
  const [panelWidth, setPanelWidth] = useState(() => Number(localStorage.getItem('panelWidth')) || 320)
  const [incomingText, setIncomingText] = useState<string | null>(null)

  const navigate = useNavigate()
  const { pathname } = useLocation()

  useEffect(() => {
    localStorage.setItem('sidebarOpen', sidebarOpen ? '1' : '0')
  }, [sidebarOpen])

  useEffect(() => {
    localStorage.setItem('panelOpen', panelOpen ? '1' : '0')
  }, [panelOpen])

  useEffect(() => {
    localStorage.setItem('panelWidth', String(panelWidth))
  }, [panelWidth])

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const move = (ev: MouseEvent) => {
      const w = window.innerWidth - ev.clientX
      setPanelWidth(Math.max(260, Math.min(560, w)))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const refresh = useCallback(async () => {
    const { data } = await sessionApi.list()
    setSessions(data)
    return data
  }, [])

  const handleCreate = useCallback(async () => {
    const { data } = await sessionApi.create()
    setSessions((prev) => [data, ...prev])
    setCurrentId(data.id)
  }, [])

  // 拉取会话。这里必须 catch：否则一旦接口抽风，currentId 永远是 null，
  // 中间区会一直停在只有「新建会话」按钮的空白页，看起来像换了个界面。
  useEffect(() => {
    let cancelled = false
    llmApi.options().then(({ data }) => setOptions(data)).catch(() => setOptions([]))
    refresh()
      .then((list) => {
        if (cancelled) return
        if (list.length > 0) setCurrentId(list[0].id)
        else handleCreate()
      })
      .catch(() => {
        if (!cancelled) handleCreate().catch(() => {})
      })
    return () => {
      cancelled = true
    }
  }, [refresh, handleCreate])

  // 兜底：切换账号后，若 currentId 为空或已不属于当前账号的会话列表，自动选中第一条
  useEffect(() => {
    if (sessions.length === 0) return
    if (currentId == null || !sessions.some((s) => s.id === currentId)) {
      setCurrentId(sessions[0].id)
    }
  }, [sessions, currentId])

  const handleDelete = async (id: number) => {
    await sessionApi.remove(id)
    const list = await refresh()
    if (currentId === id) setCurrentId(list.length > 0 ? list[0].id : null)
  }

  const handleModelChange = async (provider: string, model: string) => {
    if (currentId == null) return
    const { data } = await sessionApi.update(currentId, { provider, model })
    setSessions((prev) => prev.map((s) => (s.id === currentId ? data : s)))
  }

  const handleRename = async (id: number, title: string) => {
    const { data } = await sessionApi.update(id, { title })
    setSessions((prev) => prev.map((s) => (s.id === id ? data : s)))
  }

  // 技能「使用」：把 prompt 带回聊天输入框并跳转到对话页
  const handleUseSkill = (text: string) => {
    setIncomingText(text)
    navigate('/')
  }

  const handleIncomingConsumed = () => {
    setIncomingText(null)
  }

  const handleConnectCloud = async (payload: LlmConfigPayload) => {
    const { data: opts } = await llmApi.configure(payload)
    setOptions(opts)
    if (currentId != null) {
      const cloud = opts.find((o) => o.provider === 'cloud')
      const { data } = await sessionApi.update(currentId, {
        provider: 'cloud',
        model: cloud?.model,
      })
      setSessions((prev) => prev.map((s) => (s.id === currentId ? data : s)))
    }
  }

  const current = sessions.find((s) => s.id === currentId) || null
  const SIDEBAR_WIDTH = 200

  /** 中间区：按路由渲染聊天或功能页 */
  const renderMain = () => {
    switch (pathname) {
      case '/weather':
        return <WeatherPage />
      case '/skills':
        return (
          <SkillsPage
            sessionId={current?.id}
            activeSkillIds={current?.active_skill_ids || []}
            onUseSkill={handleUseSkill}
            onSessionUpdate={refresh}
          />
        )
      case '/todos':
        return <TodosPage refreshKey={todoKey} />
      case '/timer':
        return <TimerPage />
      case '/calendar':
        return <CalendarPage />
      default:
        return current ? (
          <ChatWindow
            key={current.id}
            sessionId={current.id}
            title={current.title}
            provider={current.provider}
            model={current.model}
            options={options}
            onModelChange={handleModelChange}
            onConnectCloud={handleConnectCloud}
            panelOpen={panelOpen}
            onTogglePanel={() => setPanelOpen((v) => !v)}
            incomingText={incomingText}
            onIncomingConsumed={handleIncomingConsumed}
            onTitleChange={refresh}
            onTodoChanged={() => setTodoKey((k) => k + 1)}
            activeSkillIds={current.active_skill_ids || []}
            onSkillsChanged={refresh}
            profile={profile}
            onProfileUpdate={onProfileUpdate}
            onLogout={onLogout}
          />
        ) : (
          <div className="chat-empty">
            <button className="btn primary" onClick={handleCreate}>
              新建会话
            </button>
          </div>
        )
    }
  }

  return (
    <div
      className="app-shell"
      style={{
        gridTemplateColumns: `${sidebarOpen ? SIDEBAR_WIDTH : 48}px 1fr ${panelOpen ? `6px ${panelWidth}px` : '0 0'}`,
      }}
    >
      <SessionList
        sessions={sessions}
        currentId={currentId}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onSelect={(id) => {
          setCurrentId(id)
          navigate('/')
        }}
        onCreate={() => {
          handleCreate()
          navigate('/')
        }}
        onDelete={handleDelete}
        onRename={handleRename}
        onLogout={onLogout}
        profile={profile}
      />
      <main className="chat-main">{renderMain()}</main>
      {panelOpen && (
        <>
          <div className="col-resizer" onMouseDown={startResize} title="拖动调整右侧面板宽度" />
          <FunctionPanel />
        </>
      )}
    </div>
  )
}
