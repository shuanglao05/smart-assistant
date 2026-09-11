/** 全局大模型偏好：存在 localStorage，聊天与所有功能页共用一个选择。 */

export type GlobalModel = { provider: string; model: string }

const KEY = 'globalModel'
const EVT = 'global-model-change'

export function getGlobalModel(): GlobalModel | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const i = raw.indexOf('|')
    if (i <= 0) return null
    const provider = raw.slice(0, i)
    const model = raw.slice(i + 1)
    if (!provider || !model) return null
    return { provider, model }
  } catch {
    return null
  }
}

export function setGlobalModel(provider: string, model: string) {
  localStorage.setItem(KEY, `${provider}|${model}`)
  window.dispatchEvent(new CustomEvent(EVT))
}

/** 当前全局模型串 "provider|model"（无则返回空串） */
export function globalModelKey(): string {
  const g = getGlobalModel()
  return g ? `${g.provider}|${g.model}` : ''
}
