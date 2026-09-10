import client from './client'
import type {
  ApiKeyInfo,
  AuthResult,
  FileDetail,
  FileInfo,
  KbCollection,
  KbDocument,
  KbGraph,
  LlmConfigPayload,
  LlmOption,
  Message,
  NotificationItem,
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
