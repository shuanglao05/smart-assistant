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
      active_skill_ids?: number[]
      active_kb_ids?: number[]
    }
  ) => client.patch<Session>(`/sessions/${id}`, data),
  remove: (id: number) => client.delete(`/sessions/${id}`),
  removeMessage: (sessionId: number, messageId: number) =>
    client.delete(`/sessions/${sessionId}/messages/${messageId}`),
  clearAll: () => client.delete(`/sessions`),
}

export const llmApi = {
  options: () => client.get<LlmOption[]>('/llm-options'),
  configure: (data: LlmConfigPayload) => client.post<LlmOption[]>('/llm-config', data),
  getConfig: () =>
    client.get<{ cloud_base_url: string; cloud_model: string; cloud_models: string[] }>(
      '/llm-config'
    ),
  fetchModels: () => client.get<{ models: string[] }>('/llm-config/models'),
  saveModels: (models: string[]) =>
    client.post<LlmOption[]>('/llm-config/models', { cloud_models: models }),
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

export const skillsApi = {
  list: () => client.get<Skill[]>('/skills'),
  create: (data: SkillCreate) => client.post<Skill>('/skills', data),
  update: (id: number, data: SkillUpdate) => client.patch<Skill>(`/skills/${id}`, data),
  remove: (id: number) => client.delete(`/skills/${id}`),
}

export const filesApi = {
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
  renameCollection: (id: number, name: string) =>
    client.patch<KbCollection>(`/kb/collections/${id}`, { name }),
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
