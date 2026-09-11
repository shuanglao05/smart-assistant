import ReactMarkdown from 'react-markdown'
import MermaidBlock from './MermaidBlock'

/** 统一 Markdown 渲染：支持 ```mermaid 图表。聊天气泡与笔记预览共用。 */
export default function Markdown({
  content,
  streaming,
}: {
  content: string
  streaming?: boolean
}) {
  return (
    <ReactMarkdown
      components={{
        code: ({ className, children, ...rest }: any) => {
          const lang = /language-(\w+)/.exec(className || '')?.[1]
          if (lang === 'mermaid') {
            return <MermaidBlock code={String(children ?? '')} streaming={streaming} />
          }
          return (
            <code className={className} {...rest}>
              {children}
            </code>
          )
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
