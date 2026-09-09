export interface Session {
  id: number
  title: string
  provider?: string
  model?: string
  active_skill_ids?: number[]
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
}

export interface Message {
  role: 'user' | 'assistant'
  content: string
  created_at: string
  // 用户消息引用的文档（气泡上方展示，点击在右侧查看详情）
  ref_files?: { id: number; filename: string; size: number }[]
}

export interface FileDetail {
  id: number
  filename: string
  size: number
  created_at: string
  content: string | null
}

export interface Todo {
  id: number
  task: string
  done: boolean
  created_at: string
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
