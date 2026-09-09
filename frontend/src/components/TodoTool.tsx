import { useEffect, useState } from 'react'
import { todoApi } from '../api'
import type { Todo } from '../types'

/** 待办功能（纯功能组件，供「待办」页面使用） */
export default function TodoTool({ refreshKey }: { refreshKey: number }) {
  const [todos, setTodos] = useState<Todo[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => todoApi.list().then(({ data }) => setTodos(data)).catch(() => setTodos([]))

  // refreshKey 变化（如 AI 帮你记了待办）即重新拉取
  useEffect(() => {
    load()
  }, [refreshKey])

  const add = async () => {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    try {
      await todoApi.create(t)
      setText('')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const toggle = (todo: Todo) => todoApi.update(todo.id, { done: !todo.done }).then(load)
  const remove = (id: number) => todoApi.remove(id).then(load)

  const done = todos.filter((t) => t.done).length

  return (
    <div className="todo-tool">
      <div className="todo-summary">
        <span>{todos.length ? `${done}/${todos.length} 已完成` : '还没有任务'}</span>
        <span className="todo-badge">{todos.length}</span>
      </div>

      <div className="todo-add">
        <input
          className="input"
          placeholder="添加一条待办…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn-icon" onClick={add} disabled={busy || !text.trim()} title="添加">
          ＋
        </button>
      </div>

      <div className="todo-list">
        {todos.length === 0 ? (
          <div className="todo-empty">
            <div className="todo-empty-ico">✓</div>
            <p>还没有待办</p>
            <span>也可以直接问助理「帮我记一下…」</span>
          </div>
        ) : (
          todos.map((t) => (
            <div key={t.id} className={`todo-item ${t.done ? 'done' : ''}`}>
              <button className="check" onClick={() => toggle(t)} aria-label="切换完成">
                {t.done ? '✓' : ''}
              </button>
              <span className="todo-task" onClick={() => toggle(t)}>
                {t.task}
              </span>
              <button className="todo-del" onClick={() => remove(t.id)} title="删除">
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
