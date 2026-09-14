/**
 * MainLayout.tsx —— 主界面布局（三栏骨架 + 当前会话状态中枢）
 *
 * 职责：
 *   已登录后的整体骨架：左侧会话栏、中间对话区或功能页、右侧功能面板。
 *   它同时是「当前会话」这一核心状态的持有者，向下分发给各子组件。
 *
 * 组件属性（props）：
 *   profile         —— 当前用户资料（透传给设置面板）
 *   onProfileUpdate —— 资料更新后回传 App
 *   onLogout        —— 退出登录
 *
 * 组件状态：
 *   sessions / currentId —— 会话列表与当前选中会话
 *   options              —— 可选模型清单（供模型选择器）
 *   todoKey              —— 待办刷新信号：AI 通过工具改过待办后 +1，通知待办页重拉
 *   sidebarOpen          —— 左栏开合（持久化到 localStorage）
 *
 * 关键函数：
 *   handleDelete / handleClearAll —— 删除单个 / 清空全部会话
 *   handleModelChange            —— 切换当前会话使用的模型
 *   handleRename                 —— 重命名会话
 *   handleUseSkill               —— 把技能提示词送进对话输入框
 *   startResize                  —— 三栏列宽拖拽
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { llmApi, sessionApi } from '../api'
import { getGlobalModel, setGlobalModel } from '../globalModel'
import type { LlmConfigPayload, LlmOption, Session, UserProfile } from '../types'
import SessionList from './SessionList'
import ChatWindow from './ChatWindow'
import FunctionPanel from './FunctionPanel'
import SettingsModal from './SettingsModal'
import WeatherPage from '../pages/WeatherPage'
import SkillsPage from '../pages/SkillsPage'
import TodosPage from '../pages/TodosPage'
import TimerPage from '../pages/TimerPage'
import CalendarPage from '../pages/CalendarPage'
import KnowledgePage from '../pages/KnowledgePage'
import NotesPage from '../pages/NotesPage'
import SchedulePage from '../pages/SchedulePage'
import TimetablePage from '../pages/TimetablePage'

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
  const [toast, setToast] = useState<string | null>(null)
  // 设置弹窗提升到主布局：入口在左下角（退出登录旁），任意功能页都能打开。
  // 云端接入已并入 设置 → API 管理，不再有独立弹窗。
  const [showSettings, setShowSettings] = useState(false)
  const toastTimer = useRef<number | null>(null)

  // 全局轻提示（模型切换等操作反馈）
  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2200)
  }

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

  // 全局模型 ↔ 当前会话同步：改一处、另一处跟随，保证聊天与各功能用同一个模型
  const sessionsRef = useRef(sessions)
  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    const onGlobal = () => {
      const g = getGlobalModel()
      if (!g || currentId == null) return
      const cur = sessionsRef.current.find((s) => s.id === currentId)
      const same =
        cur &&
        cur.provider === g.provider &&
        cur.model === g.model &&
        (cur.provider_id ?? null) === (g.provider_id ?? null)
      if (same) return
      sessionApi
        .update(currentId, {
          provider: g.provider,
          model: g.model,
          provider_id: g.provider_id ?? null,
        })
        .then(({ data }) => setSessions((p) => p.map((s) => (s.id === currentId ? data : s))))
        .catch(() => {})
    }
    window.addEventListener('global-model-change', onGlobal)
    return () => window.removeEventListener('global-model-change', onGlobal)
  }, [currentId])

  // 首次：若还没设过全局模型，用当前会话的模型初始化
  useEffect(() => {
    const cur = sessions.find((s) => s.id === currentId)
    if (cur && cur.provider && cur.model && !getGlobalModel()) {
      setGlobalModel(cur.provider, cur.model, cur.provider_id ?? undefined)
    }
  }, [sessions, currentId])

  const handleDelete = async (id: number) => {
    await sessionApi.remove(id)
    const list = await refresh()
    if (currentId === id) setCurrentId(list.length > 0 ? list[0].id : null)
  }

  // 批量清空全部历史会话：删库 + 清记忆/缓存，再刷新列表并重置当前会话
  const handleClearAll = async () => {
    await sessionApi.clearAll()
    const list = await refresh()
    setCurrentId(list.length > 0 ? list[0].id : null)
    showToast('已清空全部历史会话')
  }

  const handleModelChange = async (provider: string, model: string, provider_id?: number) => {
    if (currentId == null) return
    try {
      const { data } = await sessionApi.update(currentId, {
        provider,
        model,
        provider_id: provider_id ?? null,
      })
      setSessions((prev) => prev.map((s) => (s.id === currentId ? data : s)))
      setGlobalModel(provider, model, provider_id) // 聊天里换模型 = 换全局模型，功能页跟着用
      // 切换成功不再弹提示：每条回答下方会标注所用模型，不额外打扰；仅失败时提示
    } catch (e: any) {
      showToast(`切换失败：${e?.response?.data?.detail || e?.message || e}`)
    }
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
    // 统一走 configure：填了 Key = 新 Key 测连；留空 = 沿用已保存 Key 仍整体测连并保存
    // （Host / 默认模型 / 模型清单一并落库，不再出现「只更新清单」丢字段的问题）
    const hasKey = !!payload.cloud_api_key?.trim()
    const { data: opts } = await llmApi.configure(payload)
    setOptions(opts)
    showToast(hasKey ? '云端已接入，已切换到云端模型' : '云端配置已更新')
    if (hasKey && currentId != null) {
      const cloud = opts.find((o) => o.provider === 'cloud')
      const { data } = await sessionApi.update(currentId, {
        provider: 'cloud',
        model: cloud?.model,
      })
      setSessions((prev) => prev.map((s) => (s.id === currentId ? data : s)))
    }
  }

  // 模型下拉里点了「未配置」的云端模型：提示 + 直接打开设置页
  const handleCloudUnconfigured = () => {
    showToast('云端模型未配置：请到 设置 → API 管理 接入')
    setShowSettings(true)
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
      case '/knowledge':
        return <KnowledgePage />
      case '/notes':
        return <NotesPage />
      case '/schedule':
        return <SchedulePage />
      case '/timetable':
        return <TimetablePage />
      default:
        return current ? (
          <ChatWindow
            sessionId={current.id}
            title={current.title}
            provider={current.provider}
            model={current.model}
            providerId={current.provider_id}
            options={options}
            onModelChange={handleModelChange}
            onUnconfiguredHint={handleCloudUnconfigured}
            panelOpen={panelOpen}
            onTogglePanel={() => setPanelOpen((v) => !v)}
            incomingText={incomingText}
            onIncomingConsumed={handleIncomingConsumed}
            onTitleChange={refresh}
            onTodoChanged={() => setTodoKey((k) => k + 1)}
            activeSkillIds={current.active_skill_ids || []}
            onSkillsChanged={refresh}
            activeKbIds={current.active_kb_ids || []}
            onKbChanged={refresh}
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
        onClearAll={handleClearAll}
        onOpenSettings={() => setShowSettings(true)}
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
      {toast && <div className="app-toast">{toast}</div>}

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        profile={profile}
        onProfileUpdate={onProfileUpdate}
        onConnectCloud={handleConnectCloud}
        onLogout={onLogout}
      />
    </div>
  )
}
