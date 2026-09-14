/**
 * TodosPage.tsx —— 待办事项（独立页面）
 *
 * 职责：
 *   用 PageShell 包一层页头，内部复用 TodoTool 展示与增删待办。
 *
 * Props：
 *   refreshKey —— 由上层递增的刷新信号；该值变化时 TodoTool 会重新拉取列表。
 *                 用途：AI 通过 add_todo 工具新增待办后，界面能同步显示出来。
 *
 * 说明：
 *   model={null} 表示页头右侧不显示模型标识——本页不涉及大模型调用。
 */
import { ListChecks } from 'lucide-react'
import PageShell from '../components/PageShell'
import TodoTool from '../components/TodoTool'

export default function TodosPage({ refreshKey }: { refreshKey: number }) {
  return (
    <PageShell icon={<ListChecks size={18} />} title="待办事项" model={null}>
      <div className="page-card">
        <TodoTool refreshKey={refreshKey} />
      </div>
    </PageShell>
  )
}
