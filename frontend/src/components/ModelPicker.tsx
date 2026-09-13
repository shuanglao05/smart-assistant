import { Fragment, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Cloud, Cpu } from 'lucide-react'
import type { LlmOption } from '../types'

/**
 * 自绘模型选择器（替代原生 select）——只负责切换模型。
 * 分组展示：本地 → 阿里云百炼 → 智谱 → OpenAI → DeepSeek → ... → 其他平台；
 * 当前模型打勾；未配置的云端模型点击时触发 onUnconfiguredHint。
 */
const PLATFORM_ORDER = [
  '本地',
  '阿里云百炼',
  '智谱',
  'OpenAI',
  'DeepSeek',
  '月之暗面',
  '豆包',
  '其他平台',
]

export default function ModelPicker({
  options,
  value,
  disabled,
  onChange,
  onUnconfiguredHint,
}: {
  options: LlmOption[]
  value: string // "provider|model" 或 "provider|model|provider_id"
  disabled?: boolean
  onChange: (provider: string, model: string, provider_id?: number) => void
  onUnconfiguredHint?: () => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const keyOf = (o: LlmOption) =>
    o.provider_id != null ? `${o.provider}|${o.model}|${o.provider_id}` : `${o.provider}|${o.model}`

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const cur = options.find((o) => keyOf(o) === value)

  // 按 platform 分组，保持固定顺序，不同平台的模型不混
  const groups = new Map<string, LlmOption[]>()
  for (const o of options) {
    const key = o.platform ?? (o.provider === 'cloud' ? '其他平台' : '本地')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(o)
  }
  const orderedKeys = [...groups.keys()].sort((a, b) => {
    const ia = PLATFORM_ORDER.indexOf(a)
    const ib = PLATFORM_ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

  const pick = (o: LlmOption) => {
    setOpen(false)
    if (o.provider === 'cloud' && !o.configured) {
      onUnconfiguredHint?.()
      return
    }
    onChange(o.provider, o.model, o.provider_id)
  }

  const renderItem = (o: LlmOption) => {
    const key = keyOf(o)
    // 多 API provider 显示「名称 · 模型」，默认云端/本地只显示模型名
    const label = o.provider_id != null ? o.label : o.model
    return (
      <button
        key={key}
        className={`mp-item ${key === value ? 'on' : ''}`}
        onClick={() => pick(o)}
        title={o.desc}
      >
        {o.provider === 'cloud' ? (
          <Cloud size={14} className="mp-ico" />
        ) : (
          <Cpu size={14} className="mp-ico" />
        )}
        <span className="mp-name">{label}</span>
        {o.provider === 'cloud' && !o.configured && <span className="mp-warn">未配置</span>}
        {key === value && <Check size={14} className="mp-check" />}
      </button>
    )
  }

  return (
    <div className="model-picker" ref={wrapRef}>
      <button
        className={`mp-trigger ${open ? 'on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title="切换当前会话使用的模型"
      >
        {cur?.provider === 'cloud' ? <Cloud size={14} /> : <Cpu size={14} />}
        <span className="mp-cur">{cur ? (cur.provider_id != null ? cur.label : cur.model) : '选择模型'}</span>
        <ChevronDown size={14} className="mp-caret" />
      </button>

      {open && (
        <div className="mp-menu">
          {orderedKeys.map((key) => (
            <Fragment key={key}>
              <div className="mp-group">{key}</div>
              {groups.get(key)!.map(renderItem)}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
