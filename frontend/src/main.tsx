import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import Tooltip from './components/Tooltip'
import './styles.css'

// 主题初始化：默认深色，读取用户上次选择（必须在渲染前，避免闪一下浅色）
const savedTheme = localStorage.getItem('theme') || 'dark'
document.documentElement.setAttribute('data-theme', savedTheme)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Tooltip />
    </BrowserRouter>
  </React.StrictMode>,
)
