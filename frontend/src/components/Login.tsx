/**
 * Login.tsx —— 登录 / 注册页（未登录时的唯一入口）
 *
 * 职责：
 *   用同一套表单承载「登录」与「注册」两种模式，靠 mode 状态切换文案与所调接口；
 *   成功后把 JWT 与用户名写入 localStorage，再回调 onLogin() 让上层切到主界面。
 *
 * 组件属性（props）：
 *   onLogin —— 登录/注册成功后的回调，由 App 传入（收到即切换到已登录布局）。
 *
 * 组件状态（state）：
 *   mode                —— 'login' | 'register'，决定文案与接口
 *   username / password —— 受控输入
 *   error               —— 后端返回的错误信息（如「用户名或密码错误」）
 *   loading             —— 请求进行中标记，防止重复提交
 *
 * 依赖：
 *   authApi.login / authApi.register（见 api/index.ts），两者都返回 { token, username }。
 *
 * 注意：
 *   - 提交按钮在用户名/密码为空或请求进行中时禁用；
 *   - 错误文案优先取后端 detail（FastAPI HTTPException 的详情），取不到才用兜底提示，
 *     这样后端改提示语前端不用跟着改。
 */
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
