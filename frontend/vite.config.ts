import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 前端所有 /api 请求转发到后端，避免跨域
      // 注意：必须写 127.0.0.1 而不是 localhost——Windows 下 localhost 会解析到 ::1，
      // 而 uvicorn 默认只监听 127.0.0.1，代理会报 "upstream connect failed"
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
