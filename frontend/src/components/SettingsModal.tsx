import { useEffect, useRef, useState } from 'react'
import { apiKeysApi, usersApi } from '../api'
import type { ApiKeyInfo, UserProfile } from '../types'
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
  onConnectCloud: () => Promise<void> | void
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

  // 切到 API tab 时拉取密钥信息
  useEffect(() => {
    if (open && tab === 'api') {
      apiKeysApi
        .info()
        .then(({ data }) => setApiKey(data))
        .catch(() => setApiKey(null))
    }
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

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings-modal">
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

          {/* ---------- API 管理 ---------- */}
          {tab === 'api' && (
            <div className="settings-pane">
              {!apiKey ? (
                <p className="settings-hint">…</p>
              ) : (
                <>
                  <div className="settings-kv">
                    <span>{t('settings.api.provider')}</span>
                    <strong>{apiKey.provider}</strong>
                  </div>
                  <div className="settings-kv">
                    <span>{t('settings.api.baseUrl')}</span>
                    <code className="settings-mono">{apiKey.base_url || '—'}</code>
                  </div>
                  <div className="settings-kv">
                    <span>{t('settings.api.model')}</span>
                    <code className="settings-mono">{apiKey.model || '—'}</code>
                  </div>
                  <div className="settings-kv">
                    <span>{t('settings.api.key')}</span>
                    <code className="settings-mono">{apiKey.masked_key || t('settings.api.unset')}</code>
                  </div>

                  <div className="settings-api-actions">
                    <a
                      className="btn"
                      href={apiKey.usage_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('settings.api.usage')} ↗
                    </a>
                    <button
                      className="btn primary"
                      onClick={async () => {
                        await onConnectCloud()
                        // 云端弹窗关闭后刷新一下
                        const { data } = await apiKeysApi.info()
                        setApiKey(data)
                      }}
                    >
                      {t('settings.api.edit')}
                    </button>
                  </div>
                  <p className="settings-hint">{t('settings.api.shared')}</p>
                </>
              )}
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
