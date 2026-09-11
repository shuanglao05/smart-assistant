import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import GlobalModelPicker from './GlobalModelPicker'

/** 功能页统一外壳：标题 + 固定顶栏（返回对话 / 模型或引擎标签）。 */
export default function PageShell({
  icon,
  title,
  actions,
  wide,
  model,
  children,
}: {
  icon: ReactNode
  title: string
  actions?: ReactNode
  wide?: boolean
  /** 顶栏模型/引擎区：不传则默认显示全局大模型选择器；传 null 表示此页无模型（纯本地功能） */
  model?: ReactNode
  children: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <div className={`page ${wide ? 'page-wide' : ''}`}>
      <div className="page-head">
        <h2>
          <span className="page-icon">{icon}</span>
          {title}
        </h2>
        <div className="page-head-actions">
          {actions}
          {model === undefined ? <GlobalModelPicker /> : model}
          <button className="btn" onClick={() => navigate('/')} title="回到对话">
            <ArrowLeft size={15} />
            返回对话
          </button>
        </div>
      </div>
      {children}
    </div>
  )
}
