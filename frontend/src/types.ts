export interface Session {
  id: number
  title: string
  provider?: string
  model?: string
  active_skill_ids?: number[]
  active_kb_ids?: number[]
  created_at: string
  updated_at: string
}

export interface LlmOption {
  provider: string
  model: string
  label: string
  configured: boolean
  desc: string
}

export interface LlmConfigPayload {
  cloud_api_key: string
  cloud_base_url?: string
  cloud_model?: string
  cloud_models?: string[]
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
  font_size: 'small' | 'medium' | 'large'
  theme: 'dark' | 'light'
  created_at?: string
}

export interface UserUpdatePayload {
  nickname?: string
  avatar?: string
  language?: 'zh' | 'en'
  font_size?: 'small' | 'medium' | 'large'
  theme?: 'dark' | 'light'
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
