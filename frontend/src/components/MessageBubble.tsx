import ReactMarkdown from 'react-markdown'

export default function MessageBubble({ role, content }: { role: string; content: string }) {
  const isUser = role === 'user'
  return (
    <div className={`bubble-row ${isUser ? 'right' : 'left'}`}>
      <div className="avatar">{isUser ? '我' : 'AI'}</div>
      <div className={`bubble ${isUser ? 'bubble-user' : 'bubble-assistant'}`}>
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  )
}
