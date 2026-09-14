import client from './client'
import type {
  ApiKeyInfo,
  AuthResult,
  Course,
  FileDetail,
  FileInfo,
  KbCollection,
  KbDocument,
  KbGraph,
  LlmConfigPayload,
  LlmOption,
  LlmProvider,
  Message,
  Note,
  NotificationItem,
  ParsedCourse,
  Schedule,
  SearchHit,
  Session,
  Skill,
  SkillCreate,
  SkillUpdate,
  Todo,
  UserProfile,
  UserUpdatePayload,
} from '../types'

export const authApi = {
  register: (username: string, password: string) =>
    client.post<AuthResult>('/auth/register', { username, password }),
  login: (username: string, password: string) =>
    client.post<AuthResult>('/auth/login', { username, password }),
}

export const sessionApi = {
  list: () => client.get<Session[]>('/sessions'),
  create: (title?: string) => client.post<Session>('/sessions', { title }),
  messages: (id: number) => client.get<Message[]>(`/sessions/${id}/messages`),
  update: (
    id: number,
    data: {
      title?: string
      provider?: string
      model?: string
      provider_id?: number | null
      active_skill_ids?: number[]
      active_kb_ids?: number[]
    }
  ) => client.patch<Session>(`/sessions/${id}`, data),
  remove: (id: number) => client.delete(`/sessions/${id}`),
  removeMessage: (sessionId: number, messageId: number) =>
    client.delete(`/sessions/${sessionId}/messages/${messageId}`),
  clearAll: () => client.delete(`/sessions`),
}

// 多 API 接入管理（「已接入列表」与「接入新 API」分离）
export const llmProvidersApi = {
  list: () => client.get<LlmProvider[]>('/llm-providers'),
  create: (data: {
    name: string
    base_url: string
    api_key: string
    model: string
    models?: string[]
  }) => client.post<LlmProvider>('/llm-providers', data),
  update: (
    id: number,
    data: {
      name?: string
      base_url?: string
      api_key?: string
      model?: string
      models?: string[]
    }
  ) => client.patch<LlmProvider>(`/llm-providers/${id}`, data),
  remove: (id: number) => client.delete(`/llm-providers/${id}`),
  test: (id: number) =>
    client.post<{ ok: boolean; message: string }>(`/llm-providers/${id}/test`),
}

export const llmApi = {
  options: () => client.get<LlmOption[]>('/llm-options'),
  configure: (data: LlmConfigPayload) => client.post<LlmOption[]>('/llm-config', data),
  // 连通性检查：恒 200，{ ok, message }；Key 留空时后端用已保存的 Key 测
  testConfig: (data: { cloud_api_key?: string; cloud_base_url?: string; cloud_model?: string }) =>
    client.post<{
      ok: boolean
      message: string
      thinking_supported?: boolean
      thinking_hint?: string
    }>('/llm-config/test', data),
  getConfig: () =>
    client.get<{
      cloud_base_url: string
      cloud_model: string
      cloud_models: string[]
      enable_thinking: boolean
      thinking_budget: number
      supports_thinking: boolean
      thinking_hint: string
      trust_env: boolean
      proxy_url: string
      env_proxy: string
      effective_proxy: string
    }>('/llm-config'),
  fetchModels: (base_url: string, api_key: string) =>
    client.post<{ models: string[] }>('/llm-config/models/fetch', { base_url, api_key }),
  // 扫描本机可用代理（直连慢 / 代理端口变化时用）
  detectProxy: () =>
    client.post<{
      candidates: string[]
      target: string
      current: string
      env_proxy: string
      effective: string
    }>('/llm-config/detect-proxy'),
  saveModels: (models: string[]) =>
    client.post<LlmOption[]>('/llm-config/models', { cloud_models: models }),
  // 本地 Ollama 模型：列出 / 删除
  localModels: () =>
    client.get<{ models: string[]; base_url: string; current: string }>('/llm-config/local-models'),
  deleteLocalModel: (name: string) =>
    client.delete('/llm-config/local-models', { data: { name } }),
  // 上下文窗口（本地 Ollama 的 num_ctx）
  getContextWindow: () =>
    client.get<{
      ollama_num_ctx: number
      presets: number[]
      min: number
      max: number
      note: string
    }>('/llm-config/context-window'),
  setContextWindow: (ollama_num_ctx: number) =>
    client.post<{ ok: boolean; ollama_num_ctx: number }>('/llm-config/context-window', {
      ollama_num_ctx,
    }),
}

export const chatApi = {
  send: (session_id: number, message: string) =>
    client.post<{ reply: string }>('/chat', { session_id, message }),
}

export const todoApi = {
  list: () => client.get<Todo[]>('/todos'),
  create: (task: string) => client.post<Todo>('/todos', { task }),
  update: (id: number, data: { done?: boolean; task?: string }) =>
    client.patch<Todo>(`/todos/${id}`, data),
  remove: (id: number) => client.delete(`/todos/${id}`),
}

export const notesApi = {
  list: () => client.get<Note[]>('/notes'),
  create: (data: { title?: string; content?: string; day?: string }) =>
    client.post<Note>('/notes', data),
  update: (id: number, data: { title?: string; content?: string; day?: string }) =>
    client.patch<Note>(`/notes/${id}`, data),
  remove: (id: number) => client.delete(`/notes/${id}`),
  summarize: (day: string, provider?: string, model?: string) =>
    client.post<{ day: string; summary: string; count: number }>('/notes/summarize', {
      day,
      provider,
      model,
    }),
}

export const schedulesApi = {
  list: () => client.get<Schedule[]>('/schedules'),
  create: (data: { title: string; start_at: number; note?: string }) =>
    client.post<Schedule>('/schedules', data),
  update: (id: number, data: { title?: string; start_at?: number; note?: string }) =>
    client.patch<Schedule>(`/schedules/${id}`, data),
  remove: (id: number) => client.delete(`/schedules/${id}`),
}

export const coursesApi = {
  list: () => client.get<Course[]>('/courses'),
  create: (data: {
    name: string
    weekday: number
    start_section: number
    end_section: number
    teacher?: string
    location?: string
    weeks?: string
    color?: string
  }) => client.post<Course>('/courses', data),
  update: (id: number, data: Partial<Course>) => client.patch<Course>(`/courses/${id}`, data),
  remove: (id: number) => client.delete(`/courses/${id}`),
  // 智能导入：给网址 / 粘贴文本 / 课表截图，由 AI 解析成课程草稿（不落库）
  import: (data: {
    url?: string
    text?: string
    image?: string
    provider?: string
    model?: string
  }) => client.post<{ count: number; courses: ParsedCourse[] }>('/courses/import', data),
}

export const weatherApi = {
  get: (city: string, mode: 'now' | 'forecast' = 'now', days = 3) =>
    client.get<{ city: string; mode: string; result: string }>('/weather', {
      params: { city, mode, days },
    }),
}

/** 节假日：放假 / 调休补班安排（数据源 timor.tech，后端缓存） */
export interface HolidayDay {
  off: boolean // 放假（显示「休」）
  work: boolean // 调休补班（显示「班」）
  name: string // 节日名或「某某补班」
  wage: number // 薪资倍数：3=法定核心日、2=假期其余天、1=补班
}

export const calendarApi = {
  holidays: (year: number) =>
    client.get<{
      year: number
      source: 'cache' | 'timor' | 'unavailable'
      days: Record<string, HolidayDay>
    }>('/calendar/holidays', { params: { year } }),
}

export const skillsApi = {
  list: () => client.get<Skill[]>('/skills'),
  create: (data: SkillCreate) => client.post<Skill>('/skills', data),
  update: (id: number, data: SkillUpdate) => client.patch<Skill>(`/skills/${id}`, data),
  remove: (id: number) => client.delete(`/skills/${id}`),
}

/** 上传限制说明（由后端返回，避免前后端各写一份导致不一致） */
export interface FileLimits {
  max_mb: number
  max_content_chars: number
  groups: { label: string; exts: string[] }[]
  all_exts: string[]
  top_k: number
  chunk_size: number
  chunk_overlap: number
}

export const filesApi = {
  // 支持的文件类型与大小上限（供界面标注）
  limits: () => client.get<FileLimits>('/files/limits'),
  upload: (file: File, collectionId?: number) => {
    const fd = new FormData()
    fd.append('file', file)
    if (collectionId != null) fd.append('collection_id', String(collectionId))
    return client.post<FileInfo>('/files', fd)
  },
  list: () => client.get<FileInfo[]>('/files'),
  get: (id: number) => client.get<FileDetail>(`/files/${id}`),
  remove: (id: number) => client.delete<{ ok: boolean }>(`/files/${id}`),
  reindex: (id: number) => client.post<FileInfo>(`/files/${id}/reindex`),
}

export const kbApi = {
  collections: () => client.get<KbCollection[]>('/kb/collections'),
  createCollection: (name: string) => client.post<KbCollection>('/kb/collections', { name }),
  // 更新知识库：改名 / 设置该库专属 Top-K（top_k=null 表示回退跟随全局默认）
  updateCollection: (
    id: number,
    payload: { name?: string; top_k?: number | null }
  ) => client.patch<KbCollection>(`/kb/collections/${id}`, payload),
  removeCollection: (id: number) => client.delete<{ ok: boolean }>(`/kb/collections/${id}`),
  documents: (collectionId?: number) =>
    client.get<KbDocument[]>(
      '/kb/documents',
      collectionId != null ? { params: { collection_id: collectionId } } : undefined
    ),
  graph: (collectionId: number) =>
    client.get<KbGraph>('/kb/graph', { params: { collection_id: collectionId } }),
  reindexAll: () =>
    client.post<{ indexed: number; failed: number; total: number }>('/kb/reindex-all'),
  // RAG 检索参数（Top-K / 切片），展示与调整
  ragConfig: () =>
    client.get<{
      top_k: number
      chunk_size: number
      chunk_overlap: number
      embed_batch: number
    }>('/kb/rag-config'),
  setRagConfig: (top_k: number) => client.post<{ top_k: number }>('/kb/rag-config', { top_k }),
}

export const searchApi = {
  query: (q: string) => client.get<SearchHit[]>('/search', { params: { q } }),
}

export const notificationApi = {
  list: (unreadOnly = false) =>
    client.get<NotificationItem[]>('/notifications', { params: { unread_only: unreadOnly } }),
  unread: () => client.get<{ count: number }>('/notifications/unread-count'),
  create: (title: string, body?: string, type = 'info') =>
    client.post<NotificationItem>('/notifications', { title, body, type }),
  markRead: (id: number) => client.patch<NotificationItem>(`/notifications/${id}`),
  readAll: () => client.post('/notifications/read-all'),
  clearAll: () => client.delete('/notifications'),
}

export const usersApi = {
  me: () => client.get<UserProfile>('/users/me'),
  update: (data: UserUpdatePayload) => client.patch<UserProfile>('/users/me', data),
}

export const apiKeysApi = {
  info: () => client.get<ApiKeyInfo>('/api-keys'),
  // 修改走原有 llm-config 端点（共享 .env 写入 + 内存立即生效）
  update: (data: LlmConfigPayload) => client.post<LlmOption[]>('/llm-config', data),
}

// 系统设置：数据存储位置（数据库 / 上传文件 / 缓存）
export const systemApi = {
  getDataDir: () =>
    client.get<{
      current: string
      default: string
      is_default: boolean
      size_mb: number
      db_exists: boolean
    }>('/system/data-dir'),
  setDataDir: (path: string, migrate = true) =>
    client.post<{ ok: boolean; path: string; migrated: boolean; need_restart: boolean }>(
      '/system/data-dir',
      { path, migrate }
    ),
}
