import { useEffect, useState } from 'react'
import { Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react'
import { llmApi } from '../api'
import type { LlmConfigPayload, LlmOption } from '../types'

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
  options = [],
}: {
  open: boolean
  onClose: () => void
  onSubmit: (payload: LlmConfigPayload) => Promise<void>
  options?: LlmOption[]
}) {
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [modelsText, setModelsText] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [fetching, setFetching] = useState(false)

  // 打开时：预填当前配置（模型清单 / Base URL / 默认模型），避免保存时把已配好的地址冲掉
  useEffect(() => {
    if (!open) return
    const list = options.filter((o) => o.provider === 'cloud').map((o) => o.model)
    setModelsText(list.join('\n'))
    setErr('')
    llmApi
      .getConfig()
      .then(({ data }) => {
        setBaseUrl(data.cloud_base_url || '')
        setModel(data.cloud_model || '')
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setBaseUrl(p.baseUrl)
    setModel(p.model)
    setErr('')
  }

  const parseList = (t: string) =>
    Array.from(new Set(t.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)))

  const fetchModels = async () => {
    setFetching(true)
    setErr('')
    try {
      const { data } = await llmApi.fetchModels()
      setModelsText(data.models.join('\n'))
    } catch (e: any) {
      setErr(e?.response?.data?.detail || '拉取失败，请手动填写模型名')
    } finally {
      setFetching(false)
    }
  }

  const submit = async () => {
    const models = parseList(modelsText)
    if (!key.trim() && models.length === 0) {
      setErr('请填写 API Key，或至少填一个模型名')
      return
    }
    setBusy(true)
    setErr('')
    try {
      await onSubmit({
        cloud_api_key: key.trim(),
        cloud_base_url: baseUrl.trim() || undefined,
        cloud_model: model.trim() || undefined,
        cloud_models: models,
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
          选择平台或手动填写。填了 Key 会先测连接再保存；<b>只改模型清单可留空 Key</b>。
          Key 保存在后端 <code>.env</code> 中。
        </p>

        <label className="modal-label">常用平台（点击自动填充）</label>
        <div className="preset-row">
          {PRESETS.map((p) => (
            <button key={p.name} type="button" className="preset-chip" onClick={() => applyPreset(p)}>
              {p.name}
            </button>
          ))}
        </div>

        <label className="modal-label">API Key（已配置过可留空，仅更新模型清单）</label>
        <div className="key-row">
          <input
            className="input"
            type={showKey ? 'text' : 'password'}
            placeholder="粘贴平台申请的 API Key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
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

        <label className="modal-label">Base URL（留空保持不变；首次未配置时才用 OpenAI 官方）</label>
        <input
          className="input"
          placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />

        <label className="modal-label">默认模型名（如 qwen-plus，切换时的首选）</label>
        <input
          className="input"
          placeholder="qwen-plus"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />

        <label className="modal-label">
          可选模型清单（每行一个，会出现在「切换模型」下拉里）
        </label>
        <textarea
          className="input"
          rows={5}
          placeholder={'qwen-plus\nqwen-max\nqwen-vl-max\ndeepseek-chat'}
          value={modelsText}
          onChange={(e) => setModelsText(e.target.value)}
        />
        <div className="mp-fetch-row">
          <button className="btn" type="button" onClick={fetchModels} disabled={fetching || busy}>
            {fetching ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            从平台自动拉取模型列表
          </button>
          <span className="settings-hint">部分平台不支持，拉不到就手动填。</span>
        </div>

        {err && <div className="error">{err}</div>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? '正在测试连接…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
