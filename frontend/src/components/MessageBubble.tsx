import { Trash2 } from 'lucide-react'
import Markdown from './Markdown'

export default function MessageBubble({
  role,
  content,
  streaming,
  onDelete,
}: {
  role: string
  content: string
  streaming?: boolean
  onDelete?: () => void
}) {
  const isUser = role === 'user'
  return (
    <div className={`bubble-row ${isUser ? 'right' : 'left'}`}>
      <div className="avatar">{isUser ? '我' : 'AI'}</div>
      <div className={`bubble ${isUser ? 'bubble-user' : 'bubble-assistant'}`}>
        <Markdown content={content} streaming={streaming} />
      </div>
      {onDelete && (
        <button className="msg-del" title="删除这条消息（连同同一轮问答）" onClick={onDelete}>
          <Trash2 size={13} />
        </button>
      )}
    </div>
  )
}
