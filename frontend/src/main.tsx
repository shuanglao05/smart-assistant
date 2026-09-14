/**
 * main.tsx —— 应用入口（挂载点）
 *
 * 职责：
 *   在渲染前完成「外观初始化」，再把 <App /> 与全局 <Tooltip /> 挂载到 #root。
 *
 * 关键顺序（不能颠倒）：
 *   applyTheme / applyFontSize / applyAccent 必须在 render 之前执行——
 *   它们改的是 <html> 上的 data-theme / data-font / data-accent 属性；
 *   若挪到组件内执行，页面会先按默认主题渲染一帧再切换，用户会看到「闪一下」。
 *
 * 依赖：
 *   theme.ts —— 提供外观读写函数（主题/字号与后端 users 表同步；强调色仅存本地）。
 *   Tooltip —— 挂在路由之外，全局监听页面上所有带 title 的元素。
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import Tooltip from './components/Tooltip'
import { applyAccent, applyFontSize, applyTheme, getAccent, getSavedFontSize, getSavedTheme } from './theme'
import './styles.css'

// 外观初始化（必须在渲染前，避免闪一下默认主题）：
// 主题 / 字号存 localStorage（也与后端 users 表同步）；强调色存 localStorage。
applyTheme(getSavedTheme())
applyFontSize(getSavedFontSize())
applyAccent(getAccent())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Tooltip />
    </BrowserRouter>
  </React.StrictMode>,
)
