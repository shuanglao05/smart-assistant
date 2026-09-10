import { Fragment, useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  Check,
  Copy,
  Download,
  FileText,
  Loader2,
  MessageSquare,
  PanelRight,
  Paperclip,
  RefreshCw,
  Settings,
  Square,
  X,
} from 'lucide-react'
import { filesApi, sessionApi } from '../api'
import type { FileInfo, LlmConfigPayload, LlmOption, Message, UserProfile } from '../types'
import MessageBubble from './MessageBubble'
import NotificationBell from './NotificationBell'
import CloudConnectModal from './CloudConnectModal'
import SettingsModal from './SettingsModal'
import SkillCards from './SkillCards'
import DocViewer from './DocViewer'

/** 每条 AI 回复下方的操作条（复制 / 重新生成）——不放进气泡内 */
function MsgBar({
  content,
  canRegen,
  onRegen,
}: {
  content: string
  canRegen: boolean
  onRegen: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }
  return (
    <div className="msg-bar">
      <button className="msg-bar-btn" onClick={copy} title="复制本条回复">
        {copied ? (
          <>
            <Check size={12} /> 已复制
          </>
        ) : (
          <>
            <Copy size={12} /> 复制
          </>
        )}
      </button>
      {canRegen && (
        <button className="msg-bar-btn regen" onClick={onRegen} title="重新生成本条回答">
          <RefreshCw size={12} /> 重新生成
        </button>
      )}
    </div>
  )
}

export default function ChatWindow({
  sessionId,
  title,
  provider,
  model,
  options,
  onModelChange,
  onConnectCloud,
  panelOpen,
  onTogglePanel,
  incomingText,
  onIncomingConsumed,
  onTitleChange,
  onTodoChanged,
  activeSkillIds,
  onSkillsChanged,
  profile,
  onProfileUpdate,
  onLogout,
}: {
  sessionId: number
  title?: string
  provider?: string
  model?: string
  options: LlmOption[]
  onModelChange: (provider: string, model: string) => void
  onConnectCloud: (payload: LlmConfigPayload) => Promise<void>
  panelOpen: boolean
  onTogglePanel: () => void
  incomingText: string | null
  onIncomingConsumed: () => void
  onTitleChange: () => void
  onTodoChanged: () => void
  activeSkillIds: number[]
  onSkillsChanged: () => void
  profile: UserProfile | null
  onProfileUpdate: (p: UserProfile) => void
  onLogout: () => void
}) {
  const [showCloud, setShowCloud] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [attaches, setAttaches] = useState<FileInfo[]>([])
  const [attaching, setAttaching] = useState(false)
  // 右侧文档查看器：当前正在查看的引用文档（null 表示未打开）
  const [viewing, setViewing] = useState<{ id: number; filename: string } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  // 「贴底」标志：用户停在底部时为 true，自动跟随新内容；一旦向上翻看历史就置 false，
  // 这样 AI 流式生成时不会每次都强行把窗口拽回底部，用户可以自由查看聊天记录。
  const stickToBottom = useRef(true)
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const ctrlRef = useRef<AbortController | null>(null)

  // 输入框跟随内容自动增高（最高 200px，再高就内部滚动）
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [input])

  // Enter 发送，Shift+Enter 换行；中文输入法拼写中的 Enter 不发送
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  const exportMarkdown = () => {
    if (messages.length === 0) return
    const md: string[] = [`# ${title || '对话记录'}`, '', `_导出时间：${new Date().toLocaleString()}_`, '']
    for (const m of messages) {
      md.push(m.role === 'user' ? '### 我' : '### AI')
      md.push('')
      md.push(m.content)
      md.push('')
    }
    const blob = new Blob([md.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(title || '对话记录').slice(0, 30)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  // 切换会话时加载历史
  useEffect(() => {
    setMessages([])
    setInput('')
    setAttaches([])
    sessionApi.messages(sessionId).then(({ data }) => setMessages(data))
  }, [sessionId])

  // Skill 点"使用"后把 prompt 填入输入框
  useEffect(() => {
    if (incomingText != null) {
      setInput(incomingText)
      onIncomingConsumed()
    }
  }, [incomingText, onIncomingConsumed])

  // 跟随到底部：仅在用户处于底部（stickToBottom）时才自动滚动；
  // 向上翻看历史时不再强行拽回，AI 流式生成也能自由浏览。
  useEffect(() => {
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, loading])

  // 监听滚动：距底 < 60px 视为「在底部」，恢复自动跟随
  const onListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottom.current = distance < 60
  }

  // ---------- 附件上传 ----------
  const uploadFiles = async (list: FileList | null) => {
    if (!list || list.length === 0 || attaching) return
    setAttaching(true)
    try {
      for (const f of Array.from(list)) {
        const { data } = await filesApi.upload(f)
        setAttaches((prev) => [...prev, data])
      }
    } catch (e: any) {
      alert(`附件上传失败：${e?.response?.data?.detail || e?.message || e}`)
    } finally {
      setAttaching(false)
    }
  }

  // ---------- 流式请求核心：把 token 追加到最后一个 assistant 气泡 ----------
  const runStream = async (body: Record<string, unknown>) => {
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    setLoading(true)
    try {
      const resp = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token') ?? ''}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      if (!resp.ok) {
        let detail = `请求失败（${resp.status}）`
        try {
          const j = await resp.json()
          detail = j.detail || detail
        } catch {
          /* ignore */
        }
        setMessages((m) => {
          const c = [...m]
          const last = c[c.length - 1]
          if (last && !last.content) c[c.length - 1] = { ...last, content: detail }
          return c
        })
        return
      }
      if (!resp.body) return

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const evt = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const line = evt.split('\n').find((l) => l.startsWith('data:'))
          if (!line) continue
          let data: any
          try {
            data = JSON.parse(line.slice(5).trim())
          } catch {
            continue
          }
          if (typeof data.token === 'string') {
            const tok = data.token
            setMessages((m) => {
              const c = [...m]
              const last = c[c.length - 1]
              if (last && last.role === 'assistant') {
                c[c.length - 1] = { ...last, content: last.content + tok }
              }
              return c
            })
          } else if (data.done) {
            onTitleChange()
            onTodoChanged()
          }
        }
      }
    } catch (err: any) {
      // 用户点了"停止"：保留已生成的部分；其它异常标记失败
      if (err?.name !== 'AbortError') {
        setMessages((m) => {
          const c = [...m]
          const last = c[c.length - 1]
          if (last && !last.content) c[c.length - 1] = { ...last, content: '请求失败，请重试' }
          return c
        })
      }
    } finally {
      setLoading(false)
      if (ctrlRef.current === ctrl) ctrlRef.current = null
    }
  }

  // ---------- 发送新消息 ----------
  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    const attachIds = attaches.map((a) => a.id)
    // 把本次引用的文档快照进消息，气泡上方立即显示名称（后端也会持久化 ref_file_ids）
    const refFiles = attaches.map((a) => ({ id: a.id, filename: a.filename, size: a.size }))
    const t = new Date().toISOString()
    setMessages((m) => [
      ...m,
      { role: 'user', content: text, created_at: t, ref_files: refFiles },
      { role: 'assistant', content: '', created_at: t },
    ])
    setInput('')
    setAttaches([])
    stickToBottom.current = true // 主动发消息：跳到底部跟随新回复
    await runStream({
      session_id: sessionId,
      message: text,
      file_ids: attachIds.length ? attachIds : undefined,
    })
  }

  // ---------- 停止生成 ----------
  const stop = () => ctrlRef.current?.abort()

  // ---------- 重新生成最后一条回答 ----------
  const regenerate = async () => {
    if (loading) return
    let lastUserIdx = -1
    messages.forEach((m, i) => {
      if (m.role === 'user') lastUserIdx = i
    })
    if (lastUserIdx < 0) return
    const t = new Date().toISOString()
    setMessages((m) => [
      ...m.slice(0, lastUserIdx + 1),
      { role: 'assistant', content: '', created_at: t },
    ])
    stickToBottom.current = true // 重新生成：跟随新回复滚动到底部
    await runStream({ session_id: sessionId, regenerate: true })
  }

  const lastAssistantIsEmpty =
    loading &&
    messages.length > 0 &&
    messages[messages.length - 1].role === 'assistant' &&
    messages[messages.length - 1].content === ''

  return (
    <div className="chat-window">
      <div className="chat-topbar">
        <span className="topbar-title">{title || '对话'}</span>
        <div className="topbar-actions">
          <NotificationBell />
          <select
            className="model-select"
            value={`${provider || 'ollama'}|${model || ''}`}
            disabled={loading}
            onChange={(e) => {
              const [p, m] = e.target.value.split('|')
              if (p === 'cloud' && !options.find((o) => o.provider === 'cloud')?.configured) {
                setShowCloud(true)
                return
              }
              onModelChange(p, m)
            }}
            title="切换当前会话使用的模型"
          >
            {options.map((o) => (
              <option key={`${o.provider}|${o.model}`} value={`${o.provider}|${o.model}`}>
                {o.label}
                {o.configured ? '' : '（未配置，点击接入）'}
              </option>
            ))}
          </select>
          <button
            className="topbar-btn"
            onClick={exportMarkdown}
            disabled={messages.length === 0}
            title="导出当前对话为 Markdown 文件"
          >
            <Download size={14} />
            导出
          </button>
          <button
            className="topbar-btn"
            onClick={onTogglePanel}
            title={panelOpen ? '收起右侧面板' : '展开右侧面板'}
          >
            <PanelRight size={14} />
            {panelOpen ? '收起面板' : '展开面板'}
          </button>
          <button
            className="topbar-btn settings-btn"
            onClick={() => setShowSettings(true)}
            title="设置"
            aria-label="设置"
          >
            <Settings size={16} />
          </button>
        </div>
        <CloudConnectModal
          open={showCloud}
          onClose={() => setShowCloud(false)}
          onSubmit={onConnectCloud}
        />
      </div>

      <div className="message-list" onScroll={onListScroll}>
        {messages.length === 0 && !loading && (
          <div className="chat-placeholder">
            <div className="ph-ico">
              <MessageSquare size={30} />
            </div>
            <p>开聊吧</p>
            <span>试试：「帮我计算 12*15」或「记一下明天交报告」</span>
          </div>
        )}
        {messages.map((m, i) => {
          if (m.role === 'assistant' && !m.content) {
            return (
              <div key={i} className="bubble-row left">
                <div className="avatar">AI</div>
                <div className="bubble bubble-assistant typing">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            )
          }
          const isFinal = i === messages.length - 1
          return (
            <Fragment key={i}>
              {m.role === 'user' && m.ref_files && m.ref_files.length > 0 && (
                <div className="ref-docs">
                  <span className="ref-docs-label">引用文档：</span>
                  {m.ref_files.map((f) => (
                    <button
                      key={f.id}
                      className="ref-doc-chip"
                      title={`查看 ${f.filename}`}
                      onClick={() => setViewing({ id: f.id, filename: f.filename })}
                    >
                      <FileText size={12} /> {f.filename}
                    </button>
                  ))}
                </div>
              )}
              <MessageBubble role={m.role} content={m.content} />
              {m.role === 'assistant' && !!m.content && (
                <MsgBar
                  content={m.content}
                  canRegen={isFinal && !loading}
                  onRegen={regenerate}
                />
              )}
            </Fragment>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
        {attaches.length > 0 && (
          <div className="attach-chips">
            {attaches.map((a) => (
              <span key={a.id} className="chip">
                <FileText size={12} /> {a.filename}
                <button
                  className="chip-del"
                  onClick={() => setAttaches((prev) => prev.filter((x) => x.id !== a.id))}
                  disabled={loading}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer-box">
          <textarea
            ref={inputRef}
            className="composer-input"
            rows={1}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKeyDown}
          />
          {/* 工具行：附件 / 技能在左，发送在右 */}
          <div className="composer-tools">
            <input
              ref={fileRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                uploadFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <div className="composer-tools-left">
              <button
                className="attach-btn"
                onClick={() => fileRef.current?.click()}
                disabled={loading || attaching}
                title="上传附件（txt/md/csv/json/pdf…）让助手阅读后回答"
              >
                {attaching ? <Loader2 size={16} className="spin" /> : <Paperclip size={16} />}
              </button>
              <SkillCards
                sessionId={sessionId}
                activeSkillIds={activeSkillIds}
                onChanged={onSkillsChanged}
              />
            </div>
            <div className="composer-tools-right">
              {loading ? (
                <button className="btn primary send stop" onClick={stop} title="停止生成">
                  <Square size={13} /> 停止
                </button>
              ) : (
                <button className="btn primary send" onClick={send} disabled={!input.trim()}>
                  <ArrowUp size={15} /> 发送
                </button>
              )}
            </div>
          </div>
        </div>
        {lastAssistantIsEmpty && <div className="composer-hint">生成中…点「停止」可中断</div>}
      </div>

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        profile={profile}
        onProfileUpdate={onProfileUpdate}
        onConnectCloud={async () => setShowCloud(true)}
        onLogout={onLogout}
      />

      {viewing && (
        <DocViewer
          fileId={viewing.id}
          filename={viewing.filename}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  )
}
