/**
 * api/client.ts —— axios 实例与全局拦截器（所有接口请求的公共出口）
 *
 * 职责：
 *   创建统一配置的 axios 实例，并在请求 / 响应两端挂拦截器，
 *   避免每个业务模块各写一遍鉴权与错误处理。
 *
 * 两个拦截器：
 *   【请求】自动注入 JWT —— 从 localStorage 取 token，写入 Authorization: Bearer xxx。
 *           因此业务代码调接口时【不需要手写鉴权头】。
 *   【响应】统一处理 401 —— token 过期或被清除时，清掉本地凭证并刷新页面回登录页；
 *           其它状态码原样 reject，交给调用方决定怎么提示。
 *
 * 约定：
 *   baseURL 固定为 '/api'，开发环境由 Vite 代理到后端（见 vite.config.ts）。
 *   ⚠️ 流式对话（SSE）不走这里 —— axios 不支持流式响应体，
 *       ChatWindow 里用 fetch 直接读 /api/chat/stream 的分块流。
 */
import axios from 'axios'

const client = axios.create({ baseURL: '/api' })

// 请求拦截：自动带上 JWT
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// 响应拦截：401 直接踢回登录
client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('username')
      window.location.reload()
    }
    return Promise.reject(err)
  },
)

export default client
