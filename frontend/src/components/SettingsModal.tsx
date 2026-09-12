import { useEffect, useRef, useState } from 'react'
import { Check, Cloud, Cpu, Eye, EyeOff, Loader2, RefreshCw, Search, Zap } from 'lucide-react'
import { apiKeysApi, llmApi, usersApi } from '../api'
import type { ApiKeyInfo, LlmConfigPayload, UserProfile } from '../types'
import { useI18n } from '../i18n'

type Tab = 'appearance' | 'api' | 'account'

// 20 个表情预设头像
const AVATAR_PRESETS = [
  '😀', '😎', '🤓', '🧐', '🤖', '👨‍💻', '👩‍💻', '🦊', '🐱', '🐶',
  '🐼', '🦉', '🦄', '🐲', '🌟', '🚀', '⚡', '🌈', '🍀', '🎯',
]

const FONT_SIZES: Array<{ value: 'small' | 'medium' | 'large'; key: string }> = [
  { value: 'small', key: 'settings.fontSize.small' },
  { value: 'medium', key: 'settings.fontSize.medium' },
  { value: 'large', key: 'settings.fontSize.large' },
]

// 常用 OpenAI 兼容平台：点击自动填充 API Host 和模型名
const PRESETS = [
  { name: '阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
]

const parseList = (t: string) =>
  Array.from(new Set(t.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)))

function applyTheme(theme: 'dark' | 'light') {
  document.documentElement.setAttribute('data-theme', theme)
}
function applyFontSize(size: 'small' | 'medium' | 'large') {
  document.documentElement.setAttribute('data-fs', size)
}

/** 头像原图上限：3MB */
const MAX_AVATAR_SRC = 3 * 1024 * 1024

/**
 * 上传前压缩：最长边缩到 320px 并重编码为 JPEG。
 * 这样 3MB 的原图也能压到几十 KB，存进数据库不会爆字段。
 */
function compressImage(file: File, maxSide = 320): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const w0 = img.naturalWidth || img.width || 1
      const h0 = img.naturalHeight || img.height || 1
      const scale = Math.min(1, maxSide / Math.max(w0, h0))
      const w = Math.max(1, Math.round(w0 * scale))
      const h = Math.max(1, Math.round(h0 * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('浏览器不支持 canvas'))
        return
      }
      // 透明 PNG 直接转 JPEG 会发黑，先铺白底
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}

export default function SettingsModal({
  open,
  onClose,
  profile: initialProfile,
  onProfileUpdate,
  onConnectCloud,
  onLogout,
}: {
  open: boolean
  onClose: () => void
  profile: UserProfile | null
  onProfileUpdate: (p: UserProfile) => void
  onConnectCloud: (payload: LlmConfigPayload) => Promise<void>
  onLogout: () => void
}) {
  const { t } = useI18n()
  const [tab, setTab] = useState<Tab>('appearance')

  // 本地表单状态（避免每次输入都打 PATCH；onBlur/change-then-save 触发 PATCH）
  const [nickname, setNickname] = useState(initialProfile?.nickname || '')
  const [avatar, setAvatar] = useState<string>(initialProfile?.avatar || '')
  const [pwdCurrent, setPwdCurrent] = useState('')
  const [pwdNew, setPwdNew] = useState('')

  const [apiKey, setApiKey] = useState<ApiKeyInfo | null>(null)

  // ---- API 管理（ChatBox 式双栏）表单状态 ----
  const [navSel, setNavSel] = useState<'cloud' | 'local'>('cloud')
  const [cloudConfigured, setCloudConfigured] = useState(false)
  const [localModel, setLocalModel] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [modelsText, setModelsText] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [savingCloud, setSavingCloud] = useState(false)
  const [cloudErr, setCloudErr] = useState('')
  const [fetching, setFetching] = useState(false)
  // 深度思考开关（阿里云百炼/Qwen 思考型模型；关 = 快，开 = 先推理更透彻）
  const [deepThinking, setDeepThinking] = useState(false)
  const [thinkBudget, setThinkBudget] = useState(0)
  // 该端点是否支持深度思考（非阿里云百炼则开关无意义，置灰）
  const [thinkSupported, setThinkSupported] = useState(true)
  // 是否绕过系统代理直连（默认关；网络必须走代理时开着会极慢）
  const [bypassProxy, setBypassProxy] = useState(false)
  // 代理地址（直连慢时的救命配置；代理软件端口常变，靠「自动检测」找）
  const [proxyUrl, setProxyUrl] = useState('')
  const [proxyEnv, setProxyEnv] = useState('')
  const [proxyEffective, setProxyEffective] = useState('')
  const [proxyCandidates, setProxyCandidates] = useState<string[]>([])
  const [detecting, setDetecting] = useState(false)
  // 上一次「检查」返回的详情（用于展示端点能力）
  const [checkInfo, setCheckInfo] = useState('')

  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 当 modal 打开 / 初始 profile 变化时同步本地状态
  useEffect(() => {
    if (!open) return
    setNickname(initialProfile?.nickname || '')
    setAvatar(initialProfile?.avatar || '')
    setPwdCurrent('')
    setPwdNew('')
    setTab('appearance')
  }, [open, initialProfile])

  // 切到 API tab：拉取密钥信息 + 当前云端配置 + 模型清单，并重置表单
  useEffect(() => {
    if (!open || tab !== 'api') return
    setKeyInput('')
    setShowKey(false)
    setCheckResult(null)
    setCloudErr('')
    apiKeysApi
      .info()
      .then(({ data }) => setApiKey(data))
      .catch(() => setApiKey(null))
    llmApi
      .getConfig()
      .then(({ data }) => {
        setBaseUrl(data.cloud_base_url || '')
        setModel(data.cloud_model || '')
        setModelsText((data.cloud_models || []).join('\n'))
        setDeepThinking(!!data.enable_thinking)
        setThinkBudget(data.thinking_budget || 0)
        setThinkSupported(data.supports_thinking !== false)
        setBypassProxy(!!data.trust_env)
        setProxyUrl(data.proxy_url || '')
        setProxyEnv(data.env_proxy || '')
        setProxyEffective(data.effective_proxy || '')
      })
      .catch(() => {})
    llmApi
      .options()
      .then(({ data }) => {
        setCloudConfigured(data.some((o) => o.provider === 'cloud' && o.configured))
        setLocalModel(data.find((o) => o.provider !== 'cloud')?.model || 'ollama')
      })
      .catch(() => {})
  }, [open, tab])

  // 切到外观 tab 即应用主题/字号（语言已移除，固定中文）
  useEffect(() => {
    if (!open || !initialProfile) return
    if (tab === 'appearance') {
      applyTheme(initialProfile.theme)
      applyFontSize(initialProfile.font_size)
    }
  }, [open, tab, initialProfile])

  if (!open || !initialProfile) return null

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2000)
  }

  // ----- 外观：主题 / 字号 -----
  const changeTheme = async (theme: 'dark' | 'light') => {
    applyTheme(theme)
    setSaving(true)
    try {
      const p = await usersApi.update({ theme })
      onProfileUpdate(p.data)
    } finally {
      setSaving(false)
    }
  }
  const changeFontSize = async (size: 'small' | 'medium' | 'large') => {
    applyFontSize(size)
    setSaving(true)
    try {
      const p = await usersApi.update({ font_size: size })
      onProfileUpdate(p.data)
    } finally {
      setSaving(false)
    }
  }

  // ----- 账户：昵称 / 头像 -----
  const saveNickname = async () => {
    setSaving(true)
    try {
      const p = await usersApi.update({ nickname })
      onProfileUpdate(p.data)
      showToast(t('settings.saved'))
    } finally {
      setSaving(false)
    }
  }
  const pickAvatar = async (v: string) => {
    setAvatar(v)
    setSaving(true)
    try {
      const p = await usersApi.update({ avatar: v })
      onProfileUpdate(p.data)
    } finally {
      setSaving(false)
    }
  }
  const uploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) {
      alert('请选择图片文件')
      return
    }
    if (f.size > MAX_AVATAR_SRC) {
      alert(`图片不能超过 ${MAX_AVATAR_SRC / 1024 / 1024}MB，请换一张或先压缩`)
      return
    }
    setSaving(true)
    try {
      const dataUrl = await compressImage(f)
      setAvatar(dataUrl)
      const p = await usersApi.update({ avatar: dataUrl })
      onProfileUpdate(p.data)
      showToast(t('settings.saved'))
    } catch (err: any) {
      alert(`头像上传失败：${err?.message || err}`)
    } finally {
      setSaving(false)
    }
  }

  // ----- 账户：改密 -----
  const savePassword = async () => {
    if (!pwdCurrent || !pwdNew) return
    setSaving(true)
    try {
      await usersApi.update({ current_password: pwdCurrent, new_password: pwdNew })
      setPwdCurrent('')
      setPwdNew('')
      showToast(t('settings.pwd.saved'))
    } catch (e: any) {
      alert(e?.response?.data?.detail || '修改失败')
    } finally {
      setSaving(false)
    }
  }

  // ----- API 管理：检查 / 拉取模型 / 保存 -----
  const runCheck = async () => {
    setChecking(true)
    setCheckResult(null)
    setCloudErr('')
    try {
      const { data } = await llmApi.testConfig({
        cloud_api_key: keyInput.trim(),
        cloud_base_url: baseUrl.trim() || undefined,
        cloud_model: model.trim() || undefined,
      })
      setCheckResult({ ok: data.ok, message: data.message })
      setCheckInfo(data.message)
      if (typeof data.thinking_supported === 'boolean') {
        setThinkSupported(data.thinking_supported)
      }
    } catch (e: any) {
      setCheckResult({ ok: false, message: e?.response?.data?.detail || e?.message || '检查失败' })
    } finally {
      setChecking(false)
    }
  }

  const fetchCloudModels = async () => {
    setFetching(true)
    setCloudErr('')
    try {
      const { data } = await llmApi.fetchModels()
      setModelsText(data.models.join('\n'))
    } catch (e: any) {
      setCloudErr(e?.response?.data?.detail || '拉取失败，请手动填写模型名')
    } finally {
      setFetching(false)
    }
  }

  // 自动检测本机可用代理（直连慢 / 代理端口变化时的救命按钮）
  const detectProxy = async () => {
    setDetecting(true)
    setCloudErr('')
    try {
      const { data } = await llmApi.detectProxy()
      setProxyCandidates(data.candidates || [])
      setProxyEnv(data.env_proxy || '')
      if (data.candidates?.length) {
        setProxyUrl(data.candidates[0])
        showToast(
          `检测到 ${data.candidates.length} 个可用代理，已填入 ${data.candidates[0]}（记得点保存）`
        )
      } else {
        setCloudErr('未检测到可用代理：请确认代理软件已开启，或手动填写其 HTTP 端口')
      }
    } catch (e: any) {
      setCloudErr(e?.response?.data?.detail || '检测失败，请重试')
    } finally {
      setDetecting(false)
    }
  }

  const saveCloud = async () => {
    const models = parseList(modelsText)
    if (!keyInput.trim() && !cloudConfigured && models.length === 0) {
      setCloudErr('请填写 API Key，或至少填一个模型名')
      return
    }
    setSavingCloud(true)
    setCloudErr('')
    try {
      // Key 留空 = 后端沿用已保存的 Key（仍会整体测连 + 保存 Host / 模型）
      await onConnectCloud({
        cloud_api_key: keyInput.trim(),
        cloud_base_url: baseUrl.trim() || undefined,
        cloud_model: model.trim() || undefined,
        cloud_models: models,
        enable_thinking: deepThinking,
        thinking_budget: thinkBudget,
        trust_env: bypassProxy,
        proxy_url: proxyUrl.trim(),
      })
      setKeyInput('')
      setShowKey(false)
      showToast('云端配置已保存')
      apiKeysApi
        .info()
        .then(({ data }) => setApiKey(data))
        .catch(() => {})
      llmApi
        .options()
        .then(({ data }) =>
          setCloudConfigured(data.some((o) => o.provider === 'cloud' && o.configured))
        )
        .catch(() => {})
    } catch (e: any) {
      setCloudErr(e?.response?.data?.detail || '保存失败，请重试')
    } finally {
      setSavingCloud(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal settings-modal ${tab === 'api' ? 'settings-modal-api' : ''}`}>
        <div className="modal-title">{t('settings.title')}</div>

        <div className="settings-tabs">
          {(['appearance', 'api', 'account'] as Tab[]).map((k) => (
            <button
              key={k}
              className={`settings-tab ${tab === k ? 'active' : ''}`}
              onClick={() => setTab(k)}
            >
              {t(`settings.tab.${k}`)}
            </button>
          ))}
        </div>

        <div className="settings-body">
          {/* ---------- 外观 ---------- */}
          {tab === 'appearance' && (
            <div className="settings-pane">
              <div className="settings-row">
                <div className="settings-label">{t('settings.theme.label')}</div>
                <div className="seg">
                  {(['dark', 'light'] as const).map((v) => (
                    <button
                      key={v}
                      className={`seg-btn ${initialProfile.theme === v ? 'active' : ''}`}
                      onClick={() => changeTheme(v)}
                      disabled={saving}
                    >
                      {t(`settings.theme.${v}`)}
                    </button>
                  ))}
                </div>
              </div>
              <p className="settings-hint">{t('settings.theme.hint')}</p>

              <div className="settings-row">
                <div className="settings-label">{t('settings.fontSize.label')}</div>
                <div className="seg">
                  {FONT_SIZES.map((f) => (
                    <button
                      key={f.value}
                      className={`seg-btn ${initialProfile.font_size === f.value ? 'active' : ''}`}
                      onClick={() => changeFontSize(f.value)}
                      disabled={saving}
                    >
                      {t(f.key)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ---------- API 管理（ChatBox 式双栏） ---------- */}
          {tab === 'api' && (
            <div className="api-grid">
              {/* 左：服务列表 */}
              <div className="api-nav">
                <div className="api-nav-group">模型服务</div>
                <button
                  className={`api-nav-item ${navSel === 'cloud' ? 'on' : ''}`}
                  onClick={() => setNavSel('cloud')}
                >
                  <Cloud size={15} className="mp-ico" />
                  <span className="api-nav-name">云端 API</span>
                  {cloudConfigured ? (
                    <Check size={13} className="api-nav-ok" />
                  ) : (
                    <span className="api-nav-badge">未配置</span>
                  )}
                </button>
                <button
                  className={`api-nav-item ${navSel === 'local' ? 'on' : ''}`}
                  onClick={() => setNavSel('local')}
                >
                  <Cpu size={15} className="mp-ico" />
                  <span className="api-nav-name">本地 Ollama</span>
                  <Check size={13} className="api-nav-ok" />
                </button>
                <p className="settings-hint api-nav-hint">
                  本地模型随 Ollama 服务自动可用，无需配置。
                </p>
              </div>

              {/* 右：明细 */}
              <div className="api-detail">
                {navSel === 'local' ? (
                  <>
                    <div className="api-detail-head">
                      <span className="api-detail-title">本地 Ollama</span>
                    </div>
                    <div className="settings-kv">
                      <span>当前模型</span>
                      <code className="settings-mono">{localModel || '—'}</code>
                    </div>
                    <p className="settings-hint">
                      本地模型无需 API Key，只要电脑上 Ollama 服务在运行即可使用，
                      适合不联网或没有云端 Key 的场景。
                    </p>
                  </>
                ) : (
                  <>
                    <div className="api-detail-head">
                      <span className="api-detail-title">云端 API</span>
                      {checking && (
                        <span className="check-badge">
                          <Loader2 size={12} className="spin" /> 检查中…
                        </span>
                      )}
                      {!checking && checkResult && (
                        <span className={`check-badge ${checkResult.ok ? 'ok' : 'err'}`}>
                          {checkResult.ok ? '✓' : '✗'} {checkResult.message}
                        </span>
                      )}
                    </div>
                    <p className="settings-hint">
                      接入任一 OpenAI 兼容平台。保存时会先做一次真实测连；
                      <b>已配置过时，Key 留空表示沿用现有 Key</b>。
                    </p>

                    <label className="modal-label">常用平台（点击自动填充）</label>
                    <div className="preset-row">
                      {PRESETS.map((p) => (
                        <button
                          key={p.name}
                          type="button"
                          className="preset-chip"
                          onClick={() => {
                            setBaseUrl(p.baseUrl)
                            setModel(p.model)
                            setCloudErr('')
                          }}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>

                    <label className="modal-label">API Key</label>
                    <div className="key-row">
                      <input
                        className="input"
                        type={showKey ? 'text' : 'password'}
                        placeholder={
                          apiKey?.masked_key
                            ? `已保存 ${apiKey.masked_key}，留空沿用`
                            : '粘贴平台申请的 API Key'
                        }
                        value={keyInput}
                        onChange={(e) => setKeyInput(e.target.value)}
                      />
                      <button
                        type="button"
                        className="key-eye"
                        onClick={() => setShowKey((v) => !v)}
                        title={showKey ? '隐藏' : '显示'}
                        aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                      >
                        {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                    <div className="api-check-row">
                      <button
                        className="btn"
                        onClick={runCheck}
                        disabled={checking || savingCloud}
                      >
                        <Zap size={14} />
                        检查
                      </button>
                      <a
                        className="btn"
                        href={apiKey?.usage_url || '#'}
                        target="_blank"
                        rel="noreferrer"
                      >
                        获取 API Key ↗
                      </a>
                    </div>

                    <label className="modal-label">API Host（OpenAI 兼容接口地址）</label>
                    <input
                      className="input"
                      placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                    />

                    <div className="api-sub-field">
                      <label className="modal-label">代理地址</label>
                      <div className="settings-row-inline">
                        <input
                          className="input"
                          placeholder="http://127.0.0.1:7890（留空 = 跟随系统环境变量）"
                          value={proxyUrl}
                          onChange={(e) => setProxyUrl(e.target.value)}
                        />
                        <button
                          className="btn"
                          onClick={detectProxy}
                          disabled={detecting || savingCloud}
                          title="扫描本机端口，找出可用的代理"
                        >
                          {detecting ? (
                            <Loader2 size={14} className="spin" />
                          ) : (
                            <Search size={14} />
                          )}
                          自动检测
                        </button>
                      </div>
                      <p className="settings-hint">
                        当前生效：<b>{proxyEffective || '直连（未使用代理）'}</b>
                        {proxyEnv && proxyEffective !== proxyEnv && (
                          <>
                            ；环境变量里是 <code>{proxyEnv}</code>
                            （后端启动时读取，代理重启后可能已失效）
                          </>
                        )}
                      </p>
                      <p className="settings-hint">
                        ⚠️ 直连云端平台很慢（TLS 握手 30~46 秒，常超时）。若回答要等一两分钟，
                        点「自动检测」填入可用代理即可恢复到 1 秒级。
                      </p>
                      {proxyCandidates.length > 0 && (
                        <div className="preset-row">
                          {proxyCandidates.map((c) => (
                            <button
                              key={c}
                              type="button"
                              className={`preset-chip ${proxyUrl === c ? 'active' : ''}`}
                              onClick={() => setProxyUrl(c)}
                            >
                              {c}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <label className="modal-label">默认模型（切换时的首选）</label>
                    <input
                      className="input"
                      placeholder="qwen-plus"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                    />

                    <div className="api-think-row">
                      <div className="api-think-text">
                        <span className="modal-label">
                          深度思考
                          {!thinkSupported && <span className="api-tag-muted">该端点不支持</span>}
                        </span>
                        <p className="settings-hint">
                          {!thinkSupported
                            ? '当前 API Host 非阿里云百炼，不支持思考模式开关。'
                            : '开启后模型先推理再回答，更透彻但更慢；关闭 = 响应更快。'}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={deepThinking}
                        disabled={!thinkSupported}
                        title={deepThinking ? '深度思考：开' : '深度思考：关'}
                        className={`llm-switch ${deepThinking ? 'on' : ''}`}
                        onClick={() => setDeepThinking((v) => !v)}
                      >
                        <span className="llm-switch-knob" />
                      </button>
                    </div>

                    {deepThinking && thinkSupported && (
                      <div className="api-sub-field">
                        <label className="modal-label">思维链上限（thinking_budget）</label>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          max={32768}
                          placeholder="0 = 平台默认（约 4000）"
                          value={thinkBudget || ''}
                          onChange={(e) => setThinkBudget(Number(e.target.value) || 0)}
                        />
                        <p className="settings-hint">
                          限制模型思考的最长长度，避免无限推理导致长时间等待（1~32768，留空用默认）。
                        </p>
                      </div>
                    )}

                    <div className="api-think-row">
                      <div className="api-think-text">
                        <span className="modal-label">绕过系统代理直连</span>
                        <p className="settings-hint">
                          {bypassProxy
                            ? '⚠️ 已开启直连：若本机装有代理且访问该平台必须经代理，会导致首字极慢、频繁超时。'
                            : '默认关闭（跟随系统代理）。仅当代理会缓冲流式响应、导致打字机卡顿时才开启。'}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={bypassProxy}
                        title={bypassProxy ? '直连：开' : '跟随系统代理'}
                        className={`llm-switch ${bypassProxy ? 'on' : ''}`}
                        onClick={() => setBypassProxy((v) => !v)}
                      >
                        <span className="llm-switch-knob" />
                      </button>
                    </div>

                    {checkInfo && (
                      <p className="settings-hint api-check-info">上次检查：{checkInfo}</p>
                    )}

                    <label className="modal-label">
                      可选模型清单（每行一个，出现在「切换模型」下拉里）
                    </label>
                    <textarea
                      className="input"
                      rows={5}
                      placeholder={'qwen-plus\nqwen-max\ndeepseek-chat'}
                      value={modelsText}
                      onChange={(e) => setModelsText(e.target.value)}
                    />
                    <div className="mp-fetch-row">
                      <button
                        className="btn"
                        onClick={fetchCloudModels}
                        disabled={fetching || checking || savingCloud}
                      >
                        {fetching ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                        从平台拉取模型列表
                      </button>
                      <span className="settings-hint">部分平台不支持，拉不到就手动填。</span>
                    </div>

                    {cloudErr && <div className="error">{cloudErr}</div>}

                    <div className="api-actions">
                      <button
                        className="btn primary"
                        onClick={saveCloud}
                        disabled={checking || savingCloud}
                      >
                        {savingCloud ? '正在测试连接…' : '保存'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ---------- 账户 ---------- */}
          {tab === 'account' && (
            <div className="settings-pane">
              <div className="settings-section">
                <div className="settings-label">{t('settings.avatar.label')}</div>
                <div className="avatar-grid">
                  {AVATAR_PRESETS.map((e) => (
                    <button
                      key={e}
                      className={`avatar-cell ${avatar === e ? 'active' : ''}`}
                      onClick={() => pickAvatar(e)}
                      disabled={saving}
                    >
                      {e}
                    </button>
                  ))}
                </div>
                <div className="avatar-row-actions">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={uploadAvatar}
                  />
                  <button className="btn" onClick={() => fileRef.current?.click()} disabled={saving}>
                    {t('settings.avatar.upload')}
                  </button>
                  {avatar && avatar.startsWith('data:') && (
                    <div className="avatar-current-preview">
                      <img src={avatar} alt="avatar" />
                    </div>
                  )}
                </div>
                <p className="settings-hint">{t('settings.avatar.hint')}</p>
              </div>

              <div className="settings-section">
                <div className="settings-label">{t('settings.nickname.label')}</div>
                <div className="settings-row-inline">
                  <input
                    className="input"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder={t('settings.nickname.placeholder')}
                    maxLength={50}
                  />
                  <button className="btn primary" onClick={saveNickname} disabled={saving}>
                    {t('common.save')}
                  </button>
                </div>
              </div>

              <div className="settings-section">
                <div className="settings-label">{t('settings.username.label')}</div>
                <div className="settings-kv">
                  <code className="settings-mono">{initialProfile.username}</code>
                  <span className="settings-muted">{t('settings.username.locked')}</span>
                </div>
              </div>

              <div className="settings-section">
                <div className="settings-label">{t('settings.pwd.label')}</div>
                <div className="settings-row-stack">
                  <input
                    className="input"
                    type="password"
                    placeholder={t('settings.pwd.current')}
                    value={pwdCurrent}
                    onChange={(e) => setPwdCurrent(e.target.value)}
                  />
                  <input
                    className="input"
                    type="password"
                    placeholder={t('settings.pwd.new')}
                    value={pwdNew}
                    onChange={(e) => setPwdNew(e.target.value)}
                  />
                  <button
                    className="btn primary"
                    onClick={savePassword}
                    disabled={saving || !pwdCurrent || !pwdNew}
                  >
                    {t('settings.pwd.save')}
                  </button>
                </div>
              </div>

              <div className="settings-section">
                <button className="btn danger" onClick={onLogout}>
                  {t('settings.logout')}
                </button>
              </div>
            </div>
          )}
        </div>

        {toast && <div className="settings-toast">{toast}</div>}
      </div>
    </div>
  )
}
