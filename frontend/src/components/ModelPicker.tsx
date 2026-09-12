import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Cloud, Cpu } from 'lucide-react'
import type { LlmOption } from '../types'

/**
 * 自绘模型选择器（替代原生 select）——只负责切换模型。
 * 分组展示：云端（按清单逐条列出）+ 本地；当前模型打勾；
 * 未配置的云端模型点击时触发 onUnconfiguredHint（由父级提示去设置里接入）。
 */
export default function ModelPicker({
  options,
  value,
  disabled,
  onChange,
  onUnconfiguredHint,
}: {
  options: LlmOption[]
  value: string // "provider|model"
  disabled?: boolean
  onChange: (provider: string, model: string) => void
  onUnconfiguredHint?: () => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

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

  const cur = options.find((o) => `${o.provider}|${o.model}` === value)
  const clouds = options.filter((o) => o.provider === 'cloud')
  const locals = options.filter((o) => o.provider !== 'cloud')

  const pick = (o: LlmOption) => {
    setOpen(false)
    if (o.provider === 'cloud' && !o.configured) {
      onUnconfiguredHint?.()
      return
    }
    onChange(o.provider, o.model)
  }

  const renderItem = (o: LlmOption) => {
    const key = `${o.provider}|${o.model}`
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
        <span className="mp-name">{o.model}</span>
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
        <span className="mp-cur">{cur ? cur.model : '选择模型'}</span>
        <ChevronDown size={14} className="mp-caret" />
      </button>

      {open && (
        <div className="mp-menu">
          {clouds.length > 0 && <div className="mp-group">云端</div>}
          {clouds.map(renderItem)}
          {locals.length > 0 && <div className="mp-group">本地</div>}
          {locals.map(renderItem)}
        </div>
      )}
    </div>
  )
}
