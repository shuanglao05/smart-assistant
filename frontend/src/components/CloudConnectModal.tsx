import { useState } from 'react'
import type { LlmConfigPayload } from '../types'

// 常用 OpenAI 兼容平台：点击自动填充 Base URL 和模型名
const PRESETS = [
  { name: '阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
]

export default function CloudConnectModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (payload: LlmConfigPayload) => Promise<void>
}) {
  const [key, setKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  if (!open) return null

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setBaseUrl(p.baseUrl)
    setModel(p.model)
    setErr('')
  }

  const submit = async () => {
    if (!key.trim()) {
      setErr('请填写 API Key')
      return
    }
    setBusy(true)
    setErr('')
    try {
      await onSubmit({
        cloud_api_key: key.trim(),
        cloud_base_url: baseUrl.trim() || undefined,
        cloud_model: model.trim() || undefined,
      })
      setKey('')
      setBaseUrl('')
      setModel('')
      onClose()
    } catch (e: any) {
      setErr(e?.response?.data?.detail || '保存失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">接入云端大模型</div>
        <p className="modal-sub">
          选择平台或手动填写，保存时会先测试连接（Key 错、模型名不对会直接提示）。
          通过后当前会话立即切换到云端模型，Key 保存在后端 <code>.env</code> 中。
        </p>

        <label className="modal-label">常用平台（点击自动填充）</label>
        <div className="preset-row">
          {PRESETS.map((p) => (
            <button key={p.name} type="button" className="preset-chip" onClick={() => applyPreset(p)}>
              {p.name}
            </button>
          ))}
        </div>

        <label className="modal-label">API Key *</label>
        <input
          className="input"
          type="password"
          placeholder="粘贴平台申请的 API Key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />

        <label className="modal-label">Base URL（留空默认 OpenAI 官方）</label>
        <input
          className="input"
          placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />

        <label className="modal-label">模型名（如 qwen-plus，不是平台名）</label>
        <input
          className="input"
          placeholder="qwen-plus"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />

        {err && <div className="error">{err}</div>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? '正在测试连接…' : '保存并切换'}
          </button>
        </div>
      </div>
    </div>
  )
}
