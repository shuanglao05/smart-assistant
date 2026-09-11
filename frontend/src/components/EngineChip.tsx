import type { ReactNode } from 'react'

/**
 * 只读引擎标签：外观与对话界面的模型选择器（.mp-trigger）一致，
 * 用于不调用文本大模型的页面（天气=高德、知识库=bge-m3 本地嵌入），
 * 让用户一眼看清该页面实际用的是哪个引擎，而不是误显示对话大模型。
 */
export default function EngineChip({
  icon,
  label,
  sub,
  title,
}: {
  icon: ReactNode
  label: string
  sub?: string
  title?: string
}) {
  return (
    <span className="engine-chip" title={title}>
      {icon}
      <span className="ec-cur">
        {label}
        {sub && <span className="ec-sub">{sub}</span>}
      </span>
    </span>
  )
}
