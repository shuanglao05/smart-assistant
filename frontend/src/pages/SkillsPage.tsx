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
