/**
 * SkillsPage.tsx —— 技能库（独立页面）
 *
 * 职责：
 *   把原本在聊天右侧面板里的「技能」搬成独立页面：用 PageShell 提供统一页头
 *   （图标 + 标题）与卡片容器，内部直接复用 SkillsPanel，避免逻辑重复。
 *
 * 组件属性（props）：
 *   sessionId       —— 当前会话 id；为空/undefined 表示尚未选中会话
 *   activeSkillIds  —— 该会话已启用的技能 id 列表
 *   onUseSkill      —— 点击技能卡片时，把它的提示词填进对话输入框
 *   onSessionUpdate —— 启用/停用技能后通知上层刷新会话状态
 *
 * 注意：
 *   技能是「按会话启用」的（存在 conversations.active_skill_ids），
 *   因此未选中会话时无法勾选——页面底部会给出对应提示，避免用户困惑。
 */
import { Puzzle } from 'lucide-react'
import PageShell from '../components/PageShell'
import SkillsPanel from '../components/SkillsPanel'

export default function SkillsPage({
  sessionId,
  activeSkillIds,
  onUseSkill,
  onSessionUpdate,
}: {
  sessionId?: number
  activeSkillIds: number[]
  onUseSkill: (text: string) => void
  onSessionUpdate: () => void
}) {
  return (
    <PageShell icon={<Puzzle size={18} />} title="技能库">
      <div className="page-card">
        <SkillsPanel
          sessionId={sessionId}
          activeSkillIds={activeSkillIds}
          onUseSkill={onUseSkill}
          onSessionUpdate={onSessionUpdate}
        />
      </div>
      {sessionId == null && (
        <p className="settings-hint">没有选中会话时，勾选启用会不可用；先回到对话页选一个会话即可。</p>
      )}
    </PageShell>
  )
}
