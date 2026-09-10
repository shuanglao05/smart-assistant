import { ListChecks } from 'lucide-react'
import PageShell from '../components/PageShell'
import TodoTool from '../components/TodoTool'

export default function TodosPage({ refreshKey }: { refreshKey: number }) {
  return (
    <PageShell icon={<ListChecks size={18} />} title="待办事项">
      <div className="page-card">
        <TodoTool refreshKey={refreshKey} />
      </div>
    </PageShell>
  )
}
