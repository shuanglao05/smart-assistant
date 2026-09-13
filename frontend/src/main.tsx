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
