/**
 * App.tsx —— 应用根组件（登录态判定 + 顶层切换）
 *
 * 职责：
 *   按是否已登录切换两套界面，本身不含业务逻辑：
 *     · 未登录 → <Login />（登录 / 注册）
 *     · 已登录 → <MainLayout />（主界面：会话栏 + 对话区 + 功能页）
 *
 * 组件状态：
 *   isAuthed —— 是否已登录。初值直接读 localStorage 的 token，
 *               因此刷新页面不会掉登录态（token 失效由 api/client.ts 的 401 拦截兜底）。
 *   profile  —— 当前用户资料，是主题 / 字号 / 昵称 / 头像的数据源。
 *
 * 副作用：
 *   登录后拉取个人资料并与本地外观设置同步，保证换设备或清缓存后外观仍一致。
 */
import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import Login from './components/Login'
import MainLayout from './components/MainLayout'
import { usersApi } from './api'
import { I18nProvider, SUPPORTED_LANGS, type Lang } from './i18n'
import { applyAccent, applyFontSize, applyTheme, getAccent } from './theme'
import type { UserProfile } from './types'

// 把语言键持久化到 <html>，便于样式/非组件代码读取
function applyLang(l: Lang) {
  document.documentElement.setAttribute('data-lang', l)
}

export default function App() {
  const [isAuthed, setIsAuthed] = useState(!!localStorage.getItem('token'))
  const [profile, setProfile] = useState<UserProfile | null>(null)

  // 登录后拉取个人资料
  useEffect(() => {
    if (!isAuthed) {
      setProfile(null)
      return
    }
    usersApi
      .me()
      .then((p) => {
        setProfile(p.data)
        // 用服务端偏好覆盖本地默认值
        applyTheme(p.data.theme)
        applyFontSize(p.data.font_size)
        applyAccent(getAccent())
        if (SUPPORTED_LANGS.find((x) => x.value === p.data.language)) applyLang(p.data.language)
        else applyLang('zh')
      })
      .catch((err: any) => {
        // 401 = token 失效 → 退回登录；其它情况（后端未更新缺 /users/me、网络抖动等）→ 不阻断登录，
        // 用默认外观继续进入主界面，避免"输入密码后进不去"
        if (err?.response?.status === 401) {
          localStorage.removeItem('token')
          localStorage.removeItem('username')
          setIsAuthed(false)
        } else {
          console.warn('拉取个人资料失败（若后端未更新到最新代码会出现）：', err)
          setProfile(null)
        }
      })
  }, [isAuthed])

  const onLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('username')
    setIsAuthed(false)
  }

  if (!isAuthed) {
    return (
      <I18nProvider>
        <Login onLogin={() => setIsAuthed(true)} />
      </I18nProvider>
    )
  }

  return (
    <I18nProvider>
      <Routes>
        {/* 通配路由：MainLayout 内部按 pathname 决定中间区渲染聊天还是功能页 */}
        <Route
          path="*"
          element={<MainLayout profile={profile} onProfileUpdate={setProfile} onLogout={onLogout} />}
        />
      </Routes>
    </I18nProvider>
  )
}
