import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

/** 功能页统一外壳：标题 + 返回对话 */
export default function PageShell({
  icon,
  title,
  actions,
  children,
}: {
  icon: ReactNode
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <div className="page">
      <div className="page-head">
        <h2>
          <span className="page-icon">{icon}</span>
          {title}
        </h2>
        <div className="page-head-actions">
          {actions}
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
