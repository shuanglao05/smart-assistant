import { useState } from 'react'
import { authApi } from '../api'

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } =
        mode === 'login'
          ? await authApi.login(username, password)
          : await authApi.register(username, password)
      localStorage.setItem('token', data.token)
      localStorage.setItem('username', data.username)
      onLogin()
    } catch (err: any) {
      setError(err.response?.data?.detail || '请求失败，请确认后端已启动')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">AI</div>
        <h1>智能个人助理</h1>
        <p className="login-sub">
          {mode === 'login' ? '登录后开始与助理对话' : '创建一个账号，开启你的私人助理'}
        </p>

        <input
          className="input"
          placeholder="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />
        <input
          className="input"
          type="password"
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        />

        {error && <div className="error">{error}</div>}

        <button className="btn primary block" disabled={loading || !username || !password}>
          {loading ? '处理中…' : mode === 'login' ? '登录' : '注册并进入'}
        </button>

        <div className="login-switch">
          {mode === 'login' ? '还没有账号？' : '已有账号？'}
          <a onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? '去注册' : '去登录'}
          </a>
        </div>
      </form>
    </div>
  )
}
