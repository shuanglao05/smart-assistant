import { useEffect, useState } from 'react'
import { llmApi } from '../api'
import type { LlmOption } from '../types'
import { getGlobalModel, setGlobalModel } from '../globalModel'
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
    const sync = () => {
      const g = getGlobalModel()
      setValue(g ? `${g.provider}|${g.model}` : '')
    }
    sync()
    window.addEventListener('global-model-change', sync)
    return () => window.removeEventListener('global-model-change', sync)
  }, [])

  const current =
    value || (options[0] ? `${options[0].provider}|${options[0].model}` : '')

  return (
    <ModelPicker
      options={options}
      value={current}
      onChange={(provider, model) => setGlobalModel(provider, model)}
      onNeedCloud={() => toast('请在对话界面右上角「设置 → 接入云端模型」中配置')}
    />
  )
}
