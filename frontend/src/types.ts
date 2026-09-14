export interface Session {
  id: number
  title: string
  provider?: string
  model?: string
  provider_id?: number | null
  active_skill_ids?: number[]
  active_kb_ids?: number[]
  created_at: string
  updated_at: string
}

export interface LlmProvider {
  id: number
  name: string
  base_url: string
  model: string
  models: string[]
  masked_key: string
  created_at?: string | null
}

export interface LlmOption {
  provider: string
  model: string
  label: string
  configured: boolean
  desc: string
  /** 多 API：指向 llm_providers.id；本地 Ollama / 默认云端为 undefined */
  provider_id?: number
  /** 平台分组名：本地 / 阿里云百炼 / 智谱 / OpenAI / DeepSeek / 其他平台 */
  platform?: string
  /** 上下文窗口大小（token 数）；未知为 null */
  context_window?: number | null
  /** 上下文窗口的易读文本，如 "8K" / "128K" / "1M" */
  context_window_text?: string
}

export interface LlmConfigPayload {
  cloud_api_key: string
  cloud_base_url?: string
  cloud_model?: string
  cloud_models?: string[]
  /** 深度思考开关（阿里云百炼/Qwen 思考型模型；undefined = 不改动） */
  enable_thinking?: boolean
  /** 思维链最大 token 数（0 = 平台默认，不传该参数） */
  thinking_budget?: number
  /** true = 绕过系统代理直连（一般无需开启） */
  trust_env?: boolean
  /** 显式代理地址，如 http://127.0.0.1:7890（"" = 清空，回退环境变量/直连） */
  proxy_url?: string
}

export interface Message {
  id?: number
  role: 'user' | 'assistant'
  content: string
  created_at: string
  // 用户消息引用的文档（气泡上方展示，点击在右侧查看详情）
  ref_files?: { id: number; filename: string; size: number }[]
  // 助手回答时命中的知识库来源文件名（回答下方展示）
  sources?: string[]
  // 推理模型的"思考过程"（有则单独展示，与正文分开）
  reasoning?: string
  // 产生这条回答所用的模型（助手消息才有；在回答下方标注）
  provider?: string
  model?: string
}

export interface FileDetail {
  id: number
  filename: string
  size: number
  created_at: string
  content: string | null
}

export interface KbDocument {
  id: number
  filename: string
  size: number
  created_at: string
  chunks: number
  collection_id: number | null
}

export interface KbCollection {
  id: number
  name: string
  created_at: string
  files: number
  chunks: number
  /** 该库单独的检索 Top-K；null = 跟随全局默认 */
  top_k: number | null
}

export interface KbChunkPreview {
  index: number
  preview: string
}

export interface KbGraphDoc {
  id: number
  filename: string
  chunks: number
  previews: KbChunkPreview[]
}

export interface KbGraph {
  collection: KbCollection
  documents: KbGraphDoc[]
}

export interface Todo {
  id: number
  task: string
  done: boolean
  created_at: string
}

export interface Note {
  id: number
  title: string
  content: string
  day: string // YYYY-MM-DD
  created_at: string
  updated_at: string
}

export interface Schedule {
  id: number
  title: string
  start_at: number // epoch 秒
  note?: string | null
  reminded: boolean
  created_at: string
}

export interface Course {
  id: number
  name: string
  teacher?: string | null
  location?: string | null
  weekday: number // 1=周一 … 7=周日
  start_section: number
  end_section: number
  weeks?: string | null
  color?: string | null
  created_at: string
}

/** AI 解析出的课程草稿（尚未入库） */
export interface ParsedCourse {
  name: string
  teacher?: string | null
  location?: string | null
  weekday: number
  start_section: number
  end_section: number
  weeks?: string | null
}

export interface AuthResult {
  token: string
  token_type: string
  username: string
}

export interface UserProfile {
  id: number
  username: string
  nickname?: string | null
  avatar?: string | null
  language: 'zh' | 'en'
  font_size: string // fs12/fs14/fs16/fs18/fs20/fs22（兼容旧值 small/medium/large）
  theme: string // light/dark/sepia/contrast
  created_at?: string
}

export interface UserUpdatePayload {
  nickname?: string
  avatar?: string
  language?: 'zh' | 'en'
  font_size?: string
  theme?: string
  current_password?: string
  new_password?: string
}

export interface ApiKeyInfo {
  provider: string
  base_url?: string | null
  model?: string | null
  masked_key: string
  usage_url: string
  configured: boolean
}

export interface Skill {
  id: number
  user_id: number
  name: string
  description?: string
  prompt: string
  is_enabled: boolean
  created_at: string
  updated_at: string
}

export interface SkillCreate {
  name: string
  description?: string
  prompt: string
}

export interface SkillUpdate {
  name?: string
  description?: string
  prompt?: string
  is_enabled?: boolean
}

export interface FileInfo {
  id: number
  filename: string
  size: number
  created_at: string
}

export interface SearchHit {
  conversation_id: number
  title: string
  role: 'user' | 'assistant' | 'title'
  content: string
  created_at?: string
}

export interface NotificationItem {
  id: number
  title: string
  body?: string
  type: string
  is_read: boolean
  created_at: string
}
