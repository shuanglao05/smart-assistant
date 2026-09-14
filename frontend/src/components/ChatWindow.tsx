/**
 * ChatWindow.tsx —— 对话主窗口（本应用最核心的前端组件）
 *
 * 职责：
 *   承载一个会话的完整交互：消息列表渲染、输入区（附件 / 技能入口）、
 *   顶栏（模型切换、导出、右侧面板开关），以及 **SSE 流式对话的发起与中断**。
 *
 * Props（由 MainLayout 下发）：
 *   【会话与模型】
 *     sessionId            —— 当前会话 id，流式请求与历史拉取都用它
 *     title                —— 会话标题（顶栏展示）
 *     provider / model / providerId —— 当前模型；providerId 指向多 API provider
 *     options              —— 可选模型清单（来自 GET /api/llm-options）
 *     onModelChange        —— 切换模型后回调父级更新会话
 *     onUnconfiguredHint   —— 点到「未配置」的云端模型时，提示并打开设置
 *   【布局】
 *     panelOpen / onTogglePanel —— 右侧功能面板的开合
 *     onTitleChange        —— 首条消息后标题变化，通知父级刷新左侧会话列表
 *   【与外部联动】
 *     incomingText / onIncomingConsumed —— 外部（技能卡片、示例问题）把文字送进输入框
 *     onTodoChanged        —— AI 经工具改了待办后，通知待办页刷新
 *     activeSkillIds / onSkillsChanged  —— 本会话启用的技能
 *     activeKbIds / onKbChanged         —— 本会话启用（参与检索）的知识库
 *
 * State：
 *   messages         —— 当前会话的消息列表
 *   input / inputH   —— 输入框内容；inputH 是手动拖动后的高度（null = 自动增高）
 *   streamingSids    —— 正在流式输出的会话 id 集合（切换会话时后台仍可继续生成）
 *   attaches / attaching / limits —— 待发送附件、上传中标记、上传限制说明
 *   viewing          —— 右侧文档查看器当前打开的文件
 *   exportOpen       —— 导出下拉菜单开合
 *
 * 关键函数：
 *   runStream()          —— **SSE 流式对话核心**：用 fetch（非 axios）逐块读取
 *                           `data: {...}` 事件，按字段分派 token / reasoning /
 *                           sources / error / done 五类处理。
 *   exportConversation() —— 按 format 导出 Markdown / 纯文本 / JSON / 网页。
 *   send / stop / regenerate / deleteMessage —— 发送、停止、重新生成、删除单条。
 *
 * ⚠️ 为什么流式必须用 fetch：SSE 要读取响应体的分块流，axios 不支持流式响应体。
 * ⚠️ messages 与 streamsRef 是两份状态，streamingSids 只是派生视图（用于渲染），
 *    改动时注意三者保持同步，不要把 streamingSids 当成独立真相源。
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Cloud,
  Copy,
  Cpu,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Square,
  X,
} from 'lucide-react'
import { filesApi, sessionApi, type FileLimits } from '../api'
import type { FileInfo, LlmOption, Message } from '../types'
import MessageBubble from './MessageBubble'
import NotificationBell from './NotificationBell'

/** 导出格式：Markdown / 纯文本 / JSON / 网页（可在浏览器里「打印 → 另存为 PDF」）。 */
type ExportFormat = 'md' | 'txt' | 'json' | 'html'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 生成自带样式的 HTML 版对话（适合分享 / 打印成 PDF）。 */
function buildConversationHtml(
  title: string,
  date: Date,
  msgs: { role: string; content: string }[]
): string {
  const body = msgs
    .map(
      (m) => `
    <div class="msg ${m.role}">
      <div class="who">${m.role === 'user' ? '我' : 'AI'}</div>
      <div class="text">${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>
    </div>`
    )
    .join('')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body{font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;max-width:820px;margin:40px auto;padding:0 22px;color:#222;line-height:1.75}
  h1{font-size:20px;border-bottom:1px solid #e3e3e3;padding-bottom:12px}
  .meta{color:#888;font-size:12px;margin-bottom:26px}
  .msg{margin:0 0 18px;padding:12px 15px;border-radius:10px}
  .msg.user{background:#eef3ff}
  .msg.assistant{background:#f6f7f9}
  .who{font-weight:600;font-size:12px;color:#666;margin-bottom:6px}
  .text{white-space:pre-wrap;word-break:break-word}
  @media print{body{margin:0;max-width:none}.msg{break-inside:avoid;page-break-inside:avoid}}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">导出时间：${date.toLocaleString()}　·　共 ${msgs.length} 条消息</div>
${body}
</body>
</html>`
}
import SkillCards from './SkillCards'
import KbPicker from './KbPicker'
import ModelPicker from './ModelPicker'
import DocViewer from './DocViewer'

/** 判断文件名是不是图片（用于切换图标 / 提示） */
const isImgName = (n: string) => /\.(png|jpe?g|webp|gif|bmp)$/i.test(n)

/** 思考过程折叠块：流式时自动展开、出结果后自动收起，点标题可手动展开 */
function ThinkBox({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming)
  useEffect(() => {
    setOpen(streaming)
  }, [streaming])
  return (
    <div className={`think-box ${open ? 'open' : ''}`}>
      <button className="think-head" onClick={() => setOpen((v) => !v)}>
        <Brain size={12} />
        <span>{streaming ? '正在思考…' : '思考过程'}</span>
        <ChevronDown size={12} className="think-caret" />
      </button>
      {open && <div className="think-body">{text}</div>}
    </div>
  )
}

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
  providerId,
  options,
  onModelChange,
  onUnconfiguredHint,
  panelOpen,
  onTogglePanel,
  incomingText,
  onIncomingConsumed,
  onTitleChange,
  onTodoChanged,
  activeSkillIds,
  onSkillsChanged,
  activeKbIds,
  onKbChanged,
}: {
  sessionId: number
  title?: string
  provider?: string
  model?: string
  providerId?: number | null
  options: LlmOption[]
  onModelChange: (provider: string, model: string, provider_id?: number) => void
  /** 点击了「未配置」的云端模型：父级提示并打开设置 */
  onUnconfiguredHint: () => void
  panelOpen: boolean
  onTogglePanel: () => void
  incomingText: string | null
  onIncomingConsumed: () => void
  onTitleChange: () => void
  onTodoChanged: () => void
  activeSkillIds: number[]
  onSkillsChanged: () => void
  activeKbIds: number[]
  onKbChanged: () => void
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [inputH, setInputH] = useState<number | null>(null) // 手动拖动后的输入框高度（null=自动增高）
  // loading 改为「按会话」跟踪：切到别的对话时，正在后台生成的会话不应阻塞当前会话的输入。
  // streamingSids 记录哪些会话正在生成；当前会话的 loading 由它派生。
  const [streamingSids, setStreamingSids] = useState<Set<number>>(new Set())
  const loading = streamingSids.has(sessionId)
  const [attaches, setAttaches] = useState<FileInfo[]>([])
  const [attaching, setAttaching] = useState(false)
  // 上传限制（类型 / 大小），用于附件按钮提示与预检
  const [limits, setLimits] = useState<FileLimits | null>(null)
  // 右侧文档查看器：当前正在查看的引用文档（null 表示未打开）
  const [viewing, setViewing] = useState<{ id: number; filename: string } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  // 导出下拉菜单（Markdown / 纯文本 / JSON / 网页）
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  // 点空白处 / 按 Esc 关闭导出菜单
  useEffect(() => {
    if (!exportOpen) return
    const onDown = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExportOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [exportOpen])
  // 「贴底」标志：用户停在底部时为 true，自动跟随新内容；一旦向上翻看历史就置 false，
  // 这样 AI 流式生成时不会每次都强行把窗口拽回底部，用户可以自由查看聊天记录。
  const stickToBottom = useRef(true)
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // 每个会话独立的 AbortController：切走不打断，切回还能继续（或停止对应会话的生成）。
  const streamsRef = useRef<Map<number, AbortController>>(new Map())
  // 当前「正在显示」的会话 id：流式 token 只在它等于发起会话时才写入 UI，
  // 避免切到别的对话后，后台还在跑的流把 token 串进当前会话。
  const activeSidRef = useRef<number | null>(sessionId)

  // 输入框高度：未手动拖动时按内容自动增高（最高 200px）；手动拖动后固定为用户设定高度
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    if (inputH != null) {
      el.style.height = `${inputH}px`
      return
    }
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [input, inputH])

  // 拖动输入框上沿自由调整高度（双击手柄恢复自动增高）
  const startComposerResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const el = inputRef.current
    if (!el) return
    const startY = e.clientY
    const startH = el.offsetHeight
    const move = (ev: MouseEvent) => {
      // 向上拖 = 变高：新高度 = 起始高度 - 鼠标位移
      setInputH(Math.max(28, Math.min(400, startH - (ev.clientY - startY))))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Enter 发送，Shift+Enter 换行；中文输入法拼写中的 Enter 不发送
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  /** 导出当前对话到文件，支持 4 种格式：Markdown / 纯文本 / JSON / 网页(可打印成 PDF)。 */
  const exportConversation = (format: ExportFormat) => {
    if (messages.length === 0) return
    const name = (title || '对话记录').slice(0, 30)
    const now = new Date()
    let content = ''
    let mime = 'text/plain;charset=utf-8'

    if (format === 'md') {
      const lines = [`# ${title || '对话记录'}`, '', `_导出时间：${now.toLocaleString()}_`, '']
      for (const m of messages) {
        lines.push(m.role === 'user' ? '### 我' : '### AI', '', m.content, '')
      }
      content = lines.join('\n')
      mime = 'text/markdown;charset=utf-8'
    } else if (format === 'txt') {
      const lines = [title || '对话记录', `导出时间：${now.toLocaleString()}`, '='.repeat(44), '']
      for (const m of messages) {
        lines.push(`【${m.role === 'user' ? '我' : 'AI'}】`, m.content, '')
      }
      content = lines.join('\n')
    } else if (format === 'json') {
      content = JSON.stringify(
        {
          title: title || '对话记录',
          exported_at: now.toISOString(),
          message_count: messages.length,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            created_at: m.created_at,
            ...(m.ref_files?.length ? { ref_files: m.ref_files.map((f) => f.filename) } : {}),
            ...(m.sources?.length ? { sources: m.sources } : {}),
          })),
        },
        null,
        2
      )
      mime = 'application/json;charset=utf-8'
    } else {
      // html：自带样式，浏览器里 Ctrl+P 即可「另存为 PDF」
      content = buildConversationHtml(title || '对话记录', now, messages)
      mime = 'text/html;charset=utf-8'
    }

    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.${format}`
    a.click()
    URL.revokeObjectURL(url)
    setExportOpen(false)
  }

  // 切换会话时加载历史。注意【不 abort 正在跑的流】：
  // 切走只是把「显示会话」切走，后台生成继续；切回时再从后端拉最新内容。
  useEffect(() => {
    activeSidRef.current = sessionId
    setMessages([])
    setInput('')
    setAttaches([])
    sessionApi.messages(sessionId).then(({ data }) => setMessages(data))
  }, [sessionId])

  // 拉取上传限制（供附件按钮提示与大小预检；失败不影响正常使用）
  useEffect(() => {
    filesApi
      .limits()
      .then(({ data }) => setLimits(data))
      .catch(() => {})
  }, [])

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
    // 按后端上限预检，超限直接拦下（附件与知识库共用同一套限制）
    const maxBytes = (limits?.max_mb ?? 50) * 1024 * 1024
    const tooBig = Array.from(list).filter((f) => f.size > maxBytes)
    if (tooBig.length > 0) {
      alert(
        `以下附件超过 ${limits?.max_mb ?? 50}MB 上限：\n` +
          tooBig.map((f) => `· ${f.name}（${(f.size / 1024 / 1024).toFixed(1)}MB）`).join('\n')
      )
      return
    }
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

  // 流异常后从服务端拉回本会话最新消息：云端网络抖动时，后端可能已经把完整/部分回答落库，
  // 但前端因 SSE 断连没收到 done 事件。这里主动重拉一次，省去用户手动刷新页面。
  const recoverMessages = useCallback(() => {
    sessionApi
      .messages(sessionId)
      .then(({ data }) => setMessages(data))
      .catch(() => {})
  }, [sessionId])

  // ---------- 流式请求核心：把 token 追加到最后一个 assistant 气泡 ----------
  const runStream = async (body: Record<string, unknown>) => {
    const sid = sessionId // 发起流时的会话：token 只写回这个会话
    const ctrl = new AbortController()
    streamsRef.current.set(sid, ctrl)
    setStreamingSids((s) => {
      const n = new Set(s)
      n.add(sid)
      return n
    })
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
      let doneReceived = false // 是否正常收到结束事件（没收到 = 连接中途断掉，需要恢复）
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
          if (data.done) {
            // 结束事件：①置位恢复标志（不再触发 recoverMessages）；
            // ②标注本条回答所用模型（done 带回 provider/model）；
            // ③补齐这轮问答在后端的 id（done 带回 user_id/assistant_id，用于单条删除）；
            // ④刷新会话标题 / Todo 角标。
            // 注意：此分支必须唯一。此前链尾曾残留一个 else if (data.done) 死代码，
            // 导致模型标注/补 id 永远不执行、要刷新页面才能显示。
            doneReceived = true
            if (sid === activeSidRef.current) {
              if (data.provider || data.model) {
                const pv = data.provider as string | undefined
                const md = data.model as string | undefined
                setMessages((m) => {
                  const c = [...m]
                  const last = c[c.length - 1]
                  if (last && last.role === 'assistant') {
                    c[c.length - 1] = { ...last, provider: pv, model: md }
                  }
                  return c
                })
              }
              const uid = data.user_id as number | undefined
              const aid = data.assistant_id as number | undefined
              if (uid != null || aid != null) {
                setMessages((m) => {
                  const c = [...m]
                  if (aid != null) {
                    for (let k = c.length - 1; k >= 0; k--) {
                      if (c[k].role === 'assistant') {
                        if (c[k].id == null) c[k] = { ...c[k], id: aid }
                        break
                      }
                    }
                  }
                  if (uid != null) {
                    for (let k = c.length - 1; k >= 0; k--) {
                      if (c[k].role === 'user') {
                        if (c[k].id == null) c[k] = { ...c[k], id: uid }
                        break
                      }
                    }
                  }
                  return c
                })
              }
            }
            onTitleChange()
            onTodoChanged()
          } else if (typeof data.token === 'string') {
            const tok = data.token
            if (sid === activeSidRef.current) {
              setMessages((m) => {
                const c = [...m]
                const last = c[c.length - 1]
                if (last && last.role === 'assistant') {
                  c[c.length - 1] = { ...last, content: last.content + tok }
                }
                return c
              })
            }
          } else if (typeof data.reasoning === 'string') {
            // 思考过程增量：与正文分开累积，单独展示
            const r = data.reasoning
            if (sid === activeSidRef.current) {
              setMessages((m) => {
                const c = [...m]
                const last = c[c.length - 1]
                if (last && last.role === 'assistant') {
                  c[c.length - 1] = { ...last, reasoning: (last.reasoning || '') + r }
                }
                return c
              })
            }
          } else if (Array.isArray(data.sources)) {
            // 知识库命中来源：挂到最后一条 assistant 消息上，回答下方展示
            const srcs: string[] = data.sources
            if (sid === activeSidRef.current) {
              setMessages((m) => {
                const c = [...m]
                const last = c[c.length - 1]
                if (last && last.role === 'assistant') {
                  c[c.length - 1] = { ...last, sources: srcs }
                }
                return c
              })
            }
          } else if (typeof data.error === 'string') {
            // 后端异常事件：保留可读的真实原因（401/超时/参数不合法等），
            // 便于用户自助排查，而不是只看到一句笼统的"请求失败"。
            const msg = data.error
            if (sid === activeSidRef.current) {
              setMessages((m) => {
                const c = [...m]
                const last = c[c.length - 1]
                if (last && last.role === 'assistant' && !last.content) {
                  c[c.length - 1] = { ...last, content: `出错了: ${msg}` }
                }
                return c
              })
            }
          }
        }
      }
      // 流结束但没收到 done 事件（连接中途被掐断）：从服务端拉回已落库的内容，免得手动刷新
      // 仅在「当前仍显示这个会话」时才拉回，避免切走后把别的会话内容覆盖到当前界面。
      if (!doneReceived && sid === activeSidRef.current) recoverMessages()
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        // 非用户主动停止的异常：标记失败（仅当前显示该会话时）
        if (sid === activeSidRef.current) {
          setMessages((m) => {
            const c = [...m]
            const last = c[c.length - 1]
            if (last && !last.content) c[c.length - 1] = { ...last, content: '请求失败，请重试（云端可能不稳定，已自动尝试恢复）' }
            return c
          })
          // 网络抖动导致流中断：后端可能已把完整/部分回答落库，主动拉回
          recoverMessages()
        }
      } else {
        // 用户主动点了「停止」：后端会把已生成的部分落库，并带回这轮问答的 id。
        // 延迟拉回带 id 的消息，让删除按钮无需刷新页面就能出现。
        // （不立即拉：后端 GeneratorExit 里异步落库，稍等一拍再取。）
        setTimeout(() => {
          if (sid === activeSidRef.current) recoverMessages()
        }, 300)
      }
    } finally {
      setStreamingSids((s) => {
        const n = new Set(s)
        n.delete(sid)
        return n
      })
      if (streamsRef.current.get(sid) === ctrl) streamsRef.current.delete(sid)
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
  // 只停止「当前会话」的流；别的会话若在后台生成，不受影响。
  const stop = () => streamsRef.current.get(sessionId)?.abort()

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

  // ---------- 删除单条消息（连同同一轮的另一条）----------
  const deleteMessage = async (id?: number) => {
    if (id == null) return
    if (!confirm('删除这条消息？（同一轮的提问与回答会一起删除）')) return
    try {
      const { data } = await sessionApi.removeMessage(sessionId, id)
      const removed = new Set<number>(data.ids || [id])
      setMessages((m) => m.filter((x) => !(x.id != null && removed.has(x.id))))
    } catch (e: any) {
      alert(`删除失败：${e?.response?.data?.detail || e?.message || e}`)
    }
  }

  // 点击来源 → 按文件名找到对应文档并打开右侧查看器
  const openSource = async (name: string) => {
    try {
      const { data } = await filesApi.list()
      const hit = data.find((f) => f.filename === name)
      if (hit) setViewing({ id: hit.id, filename: hit.filename })
      else alert(`未找到文档《${name}》`)
    } catch {
      /* ignore */
    }
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
          <ModelPicker
            options={options}
            value={`${provider || 'ollama'}|${model || ''}${providerId != null ? `|${providerId}` : ''}`}
            disabled={loading}
            onChange={onModelChange}
            onUnconfiguredHint={onUnconfiguredHint}
          />
          <div className="export-wrap" ref={exportRef}>
            <button
              className="topbar-btn"
              onClick={() => setExportOpen((v) => !v)}
              disabled={messages.length === 0}
              title="导出当前对话（支持多种格式）"
            >
              <Download size={14} />
              导出
              <ChevronDown size={12} />
            </button>
            {exportOpen && (
              <div className="export-menu">
                <button onClick={() => exportConversation('md')}>
                  Markdown<span className="ex-ext">.md</span>
                </button>
                <button onClick={() => exportConversation('txt')}>
                  纯文本<span className="ex-ext">.txt</span>
                </button>
                <button onClick={() => exportConversation('json')}>
                  JSON<span className="ex-ext">.json</span>
                </button>
                <button onClick={() => exportConversation('html')}>
                  网页 / PDF<span className="ex-ext">.html</span>
                </button>
              </div>
            )}
          </div>
          <button
            className="panel-toggle"
            onClick={onTogglePanel}
            title={panelOpen ? '收起右侧面板' : '展开右侧面板'}
            aria-label={panelOpen ? '收起面板' : '展开面板'}
          >
            {panelOpen ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
          </button>
        </div>
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
          const isLast = i === messages.length - 1
          const streaming = loading && isLast

          if (m.role === 'user') {
            return (
              <Fragment key={i}>
                {m.ref_files && m.ref_files.length > 0 && (
                  <div className="ref-docs">
                    <span className="ref-docs-label">引用文档：</span>
                    {m.ref_files.map((f) => (
                      <button
                        key={f.id}
                        className="ref-doc-chip"
                        title={`查看 ${f.filename}`}
                        onClick={() => setViewing({ id: f.id, filename: f.filename })}
                      >
                        {isImgName(f.filename) ? (
                          <ImageIcon size={12} />
                        ) : (
                          <FileText size={12} />
                        )}{' '}
                        {f.filename}
                      </button>
                    ))}
                  </div>
                )}
                <MessageBubble
                  role={m.role}
                  content={m.content}
                  onDelete={m.id != null && !loading ? () => deleteMessage(m.id) : undefined}
                />
              </Fragment>
            )
          }

          // 助手消息：思考过程（若有）+ 正文 / 加载态 / 已停止
          return (
            <Fragment key={i}>
              {m.reasoning && (
                <ThinkBox text={m.reasoning} streaming={streaming && !m.content} />
              )}
              {!m.content ? (
                streaming ? (
                  <div className="bubble-row left">
                    <div className="avatar">AI</div>
                    <div className="bubble bubble-assistant typing">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                ) : (
                  <div className="bubble-row left">
                    <div className="avatar">AI</div>
                    <div className="bubble bubble-assistant stopped">
                      <span className="stopped-text">已停止生成</span>
                      {isLast && (
                        <button className="stopped-regen" onClick={regenerate}>
                          <RefreshCw size={12} /> 重新生成
                        </button>
                      )}
                    </div>
                  </div>
                )
              ) : (
                <>
                  <MessageBubble
                    role={m.role}
                    content={m.content}
                    streaming={streaming}
                    onDelete={m.id != null && !loading ? () => deleteMessage(m.id) : undefined}
                  />
                  {m.sources && m.sources.length > 0 && (
                    <div className="msg-sources">
                      <span className="msg-sources-label">来源：</span>
                      {m.sources.map((s) => (
                        <button
                          key={s}
                          className="src-chip"
                          onClick={() => openSource(s)}
                          title={`查看 ${s}`}
                        >
                          <FileText size={12} /> {s}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="msg-footer">
                    {m.model && (
                      <span
                        className="msg-model"
                        title={`本条回答由${m.provider === 'cloud' ? '云端' : '本地'}模型 ${m.model} 生成`}
                      >
                        {m.provider === 'cloud' ? <Cloud size={11} /> : <Cpu size={11} />}
                        {m.provider === 'cloud' ? '云端' : '本地'} · {m.model}
                      </span>
                    )}
                    <MsgBar
                      content={m.content}
                      canRegen={isLast && !loading}
                      onRegen={regenerate}
                    />
                  </div>
                </>
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
                {isImgName(a.filename) ? <ImageIcon size={12} /> : <FileText size={12} />}{' '}
                {a.filename}
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
          <div
            className="composer-resize"
            onMouseDown={startComposerResize}
            onDoubleClick={() => setInputH(null)}
            title="拖动调整输入框高度（双击恢复自动）"
          />
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
              accept={limits?.all_exts.join(',') || undefined}
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
                title={`上传附件：PDF / Word(.docx) / 文本 / 图片，单文件 ≤ ${limits?.max_mb ?? 50}MB，助手会阅读或看图后回答`}
              >
                {attaching ? <Loader2 size={14} className="spin" /> : <Paperclip size={14} />}
              </button>
              <SkillCards
                sessionId={sessionId}
                activeSkillIds={activeSkillIds}
                onChanged={onSkillsChanged}
              />
              <KbPicker
                sessionId={sessionId}
                activeKbIds={activeKbIds}
                onChanged={onKbChanged}
              />
            </div>
            <div className="composer-tools-right">
              {loading ? (
                <button className="btn primary send stop" onClick={stop} title="停止生成">
                  <Square size={13} /> 停止
                </button>
              ) : (
                <button
                  className="btn primary send"
                  onClick={send}
                  disabled={!input.trim()}
                  title="发送（Enter 发送，Shift+Enter 换行）"
                >
                  <ArrowUp size={15} /> 发送
                </button>
              )}
            </div>
          </div>
        </div>
        {lastAssistantIsEmpty && <div className="composer-hint">生成中…点「停止」可中断</div>}
      </div>

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
