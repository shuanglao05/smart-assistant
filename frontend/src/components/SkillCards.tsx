import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { skillsApi, sessionApi } from '../api'
import type { Skill } from '../types'

/**
 * 输入框里的技能入口：平时只占一个 🧩 图标（角标显示已启用数量），
 * 点击才弹出技能卡片面板供勾选；再点图标 / 点面板外 / Esc 收起。
 * 勾选状态存在当前会话的 active_skill_ids 上（后端随会话持久化）。
 */
export default function SkillCards({
  sessionId,
  activeSkillIds,
  onChanged,
}: {
  sessionId?: number
  activeSkillIds: number[]
  onChanged?: () => void
}) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    skillsApi
      .list()
      .then(({ data }) => setSkills(data))
      .catch(() => setSkills([]))
  }, [])

  // 点击面板外或按 Esc 收起
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const save = async (next: number[]) => {
    if (sessionId == null) return
    try {
      await sessionApi.update(sessionId, { active_skill_ids: next })
      onChanged?.()
    } catch (e: any) {
      alert(`技能启用失败：${e?.response?.data?.detail || e?.message || e}`)
    }
  }

  const toggle = (id: number) =>
    save(
      activeSkillIds.includes(id)
        ? activeSkillIds.filter((x) => x !== id)
        : [...activeSkillIds, id]
    )

  const activeCount = activeSkillIds.length

  return (
    <div className="skill-picker" ref={wrapRef}>
      <button
        className={`skill-picker-btn ${open ? 'on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="技能（点击展开勾选）"
        aria-label="技能"
      >
        🧩
        {activeCount > 0 && <span className="skill-badge">{activeCount}</span>}
      </button>

      {open && (
        <div className="skill-pop">
          <div className="skill-pop-head">
            <span>本次对话启用的技能</span>
            {activeCount > 0 && (
              <button className="skill-pop-clear" onClick={() => save([])}>
                清空
              </button>
            )}
          </div>

          <div className="skill-pop-list">
            {skills.length === 0 ? (
              <div className="skill-pop-empty">还没有技能，点下面「管理技能」去新建或导入</div>
            ) : (
              skills.map((s) => {
                const on = activeSkillIds.includes(s.id)
                return (
                  <button
                    key={s.id}
                    className={`skill-pop-card ${on ? 'on' : ''}`}
                    onClick={() => toggle(s.id)}
                    title={s.description || s.name}
                  >
                    <span className="skill-pop-check">{on ? '✓' : ''}</span>
                    <span className="skill-pop-body">
                      <span className="skill-pop-name">{s.name}</span>
                      {s.description && <span className="skill-pop-desc">{s.description}</span>}
                    </span>
                  </button>
                )
              })
            )}
          </div>

          <button
            className="skill-pop-manage"
            onClick={() => {
              setOpen(false)
              navigate('/skills')
            }}
          >
            ⚙ 管理技能
          </button>
        </div>
      )}
    </div>
  )
}
