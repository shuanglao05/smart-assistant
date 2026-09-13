/** 全局大模型偏好：存在 localStorage，聊天与所有功能页共用一个选择。
 *
 * 存储格式（分隔符 "|"）：`provider|model` 或 `provider|model|provider_id`
 * —— provider_id 是多 API 接入后用于区分同平台不同 provider（见 llm_providers 表）。
 */

export type GlobalModel = { provider: string; model: string; provider_id?: number }

const KEY = 'globalModel'
const EVT = 'global-model-change'

/** 把 GlobalModel 归一成 "provider|model" 或 "provider|model|provider_id" */
export function encodeGlobalModel(g: GlobalModel): string {
  return g.provider_id != null ? `${g.provider}|${g.model}|${g.provider_id}` : `${g.provider}|${g.model}`
}

export function getGlobalModel(): GlobalModel | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parts = raw.split('|')
    if (parts.length < 2) return null
    const [provider, model, pid] = parts
    if (!provider || !model) return null
    const pidNum = pid != null && pid !== '' ? Number(pid) : NaN
    return { provider, model, provider_id: Number.isFinite(pidNum) ? pidNum : undefined }
  } catch {
    return null
  }
}

export function setGlobalModel(provider: string, model: string, provider_id?: number | null) {
  const val = provider_id != null ? `${provider}|${model}|${provider_id}` : `${provider}|${model}`
  localStorage.setItem(KEY, val)
  window.dispatchEvent(new CustomEvent(EVT))
}

/** 当前全局模型串（与 ModelPicker 的 key 格式一致：provider|model[|provider_id]） */
export function globalModelKey(): string {
  const g = getGlobalModel()
  return g ? encodeGlobalModel(g) : ''
}
