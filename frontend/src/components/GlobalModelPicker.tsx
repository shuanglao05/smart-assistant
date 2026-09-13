import { useEffect, useState } from 'react'
import { llmApi } from '../api'
import type { LlmOption } from '../types'
import { globalModelKey, setGlobalModel } from '../globalModel'
import { toast } from '../toast'
import ModelPicker from './ModelPicker'

/** 全局模型选择器（功能页头部）：与对话界面同款自绘下拉，聊天/各 AI 功能共用同一模型。 */
export default function GlobalModelPicker() {
  const [options, setOptions] = useState<LlmOption[]>([])
  const [value, setValue] = useState('')

  useEffect(() => {
    llmApi
      .options()
      .then(({ data }) => setOptions(data))
      .catch(() => setOptions([]))
    // value 用 globalModelKey()，格式与 ModelPicker 的 key 一致（含 provider_id），
    // 否则多 API 模型会因 key 对不上而不显示当前模型。
    const sync = () => setValue(globalModelKey())
    sync()
    window.addEventListener('global-model-change', sync)
    return () => window.removeEventListener('global-model-change', sync)
  }, [])

  return (
    <ModelPicker
      options={options}
      value={value}
      onChange={(provider, model, provider_id) => setGlobalModel(provider, model, provider_id)}
      onUnconfiguredHint={() => toast('云端模型未配置：请到 设置 → API 管理 接入')}
    />
  )
}
