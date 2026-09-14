/**
 * SkillsPanel.tsx —— 技能面板（技能增删改查 + 按会话启用）
 *
 * 职责：
 *   以卡片形式列出技能，支持新建 / 编辑 / 删除，以及「是否在本会话启用」的勾选。
 *   同一套面板被右侧功能面板与独立的技能页共同复用，避免逻辑重复。
 *
 * 组件属性（props）：
 *   sessionId       —— 当前会话 id；未选中会话时无法勾选启用
 *   activeSkillIds  —— 本会话已启用的技能 id 列表
 *   onUseSkill      —— 点击卡片时把技能提示词填进对话输入框
 *   onSessionUpdate —— 启用状态变更后通知上层刷新
 *
 * 组件状态：
 *   skills / loading            —— 技能列表与加载中标记
 *   editing / showForm / form   —— 表单开合与正在编辑的技能
 *
 * 依赖：
 *   skillsApi —— 列表 / 新建 / 更新 / 删除 / 切换本会话启用。
 *   技能的启用状态存在 conversations.active_skill_ids，因此是「按会话」而非全局。
 */
import { useEffect, useRef, useState } from 'react'
import { FileText, FolderOpen, Pencil, Plus, Upload, X } from 'lucide-react'
import { skillsApi, sessionApi } from '../api'
import type { Skill } from '../types'

/** 解析 SKILL.md：--- frontmatter(name/description) --- + 正文作为 prompt */
function parseSkillMd(
  folderName: string,
  text: string
): { name: string; description: string; prompt: string } {
  let name = folderName
  let description = ''
  let prompt = text.trim()
  const body = text.replace(/^\uFEFF/, '')
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3)
    if (end > 0) {
      const fm = body.slice(3, end)
      const rest = body.slice(end + 4).trim()
      for (const line of fm.split('\n')) {
        const m = line.match(/^(name|description)\s*:\s*(.*)$/)
        if (!m) continue
        const val = m[2].trim().replace(/^["']|["']$/g, '')
        if (m[1] === 'name' && val) name = val
        if (m[1] === 'description' && val) description = val
      }
      if (rest) prompt = rest
    }
  }
  return { name: name || folderName, description, prompt }
}

export default function SkillsPanel({
  sessionId,
  activeSkillIds,
  onUseSkill,
  onSessionUpdate,
}: {
  sessionId?: number
  activeSkillIds: number[]
  onUseSkill?: (text: string) => void
  onSessionUpdate?: () => void
}) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<Skill | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', prompt: '' })
  const [showImport, setShowImport] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null) // 单个/多个 .md 文件
  const folderRef = useRef<HTMLInputElement>(null) // 整个文件夹

  const load = () =>
    skillsApi
      .list()
      .then(({ data }) => setSkills(data))
      .catch(() => setSkills([]))

  useEffect(() => {
    load()
  }, [])

  const openCreate = () => {
    setEditing(null)
    setForm({ name: '', description: '', prompt: '' })
    setShowForm(true)
  }

  const openEdit = (s: Skill) => {
    setEditing(s)
    setForm({ name: s.name, description: s.description || '', prompt: s.prompt })
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditing(null)
  }

  const save = async () => {
    if (!form.name.trim() || !form.prompt.trim() || loading) return
    setLoading(true)
    try {
      if (editing) {
        await skillsApi.update(editing.id, form)
      } else {
        await skillsApi.create(form)
      }
      closeForm()
      await load()
    } finally {
      setLoading(false)
    }
  }

  const remove = async (id: number) => {
    if (!confirm('删除该技能？')) return
    await skillsApi.remove(id)
    await load()
  }

  const toggleSession = async (id: number) => {
    if (sessionId == null) return
    const next = activeSkillIds.includes(id)
      ? activeSkillIds.filter((x) => x !== id)
      : [...activeSkillIds, id]
    await sessionApi.update(sessionId, { active_skill_ids: next })
    onSessionUpdate?.()
  }

  // 导入技能：mode='md'=用户手选的 .md 文件；mode='folder'=整个文件夹（只扫 *skill.md）
  const importSkillFiles = async (files: FileList | null, mode: 'md' | 'folder') => {
    if (!files || files.length === 0) return
    const isMd = (n: string) => /\.(md|markdown)$/i.test(n)
    const list = mode === 'folder' ? Array.from(files).filter((f) => /skill\.md$/i.test(f.name)) : Array.from(files)
    const mdFiles = mode === 'folder' ? list : list.filter((f) => isMd(f.name))
    if (mdFiles.length === 0) {
      alert(mode === 'folder' ? '该文件夹里没有找到 SKILL.md 技能文件' : '请选择 .md / .markdown 技能文件')
      return
    }
    const existingNames = new Set(skills.map((s) => s.name))
    let added = 0
    let skipped = 0
    setLoading(true)
    try {
      for (const f of mdFiles) {
        const text = await f.text()
        const fallback = f.webkitRelativePath
          ? f.webkitRelativePath.split('/')[0]
          : f.name.replace(/\.(md|markdown)$/i, '')
        const parsed = parseSkillMd(fallback, text)
        if (existingNames.has(parsed.name)) {
          skipped += 1
          continue
        }
        await skillsApi.create({
          name: parsed.name,
          description: parsed.description || undefined,
          prompt: parsed.prompt,
        })
        existingNames.add(parsed.name)
        added += 1
      }
      alert(`导入完成：新增 ${added} 个技能${skipped ? `，跳过重名 ${skipped} 个` : ''}`)
      await load()
    } catch (e: any) {
      alert(`导入失败：${e?.message || e}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="skills-tool">
      <div className="skills-tool-bar">
        <span className="skills-sub">勾选=当前会话启用；「使用」=填入输入框；「导入」可导入 .md 或文件夹</span>
        <div className="sec-head-actions">
          <div className="skills-import">
            <button
              className={`skills-add ghost ${showImport ? 'on' : ''}`}
              onClick={() => setShowImport((v) => !v)}
              title="导入技能（.md 文件 / 文件夹）"
            >
              <Upload size={14} />
            </button>
            {showImport && (
              <div className="import-menu">
                <button
                  onClick={() => {
                    setShowImport(false)
                    fileRef.current?.click()
                  }}
                >
                  <FileText size={16} /> 导入 .md 文件
                </button>
                <button
                  onClick={() => {
                    setShowImport(false)
                    folderRef.current?.click()
                  }}
                >
                  <FolderOpen size={16} /> 导入技能文件夹
                </button>
              </div>
            )}
          </div>
          <button className="skills-add" onClick={openCreate} title="新建技能">
            <Plus size={15} />
          </button>
        </div>
      </div>

      <div className="skills-list">
        {skills.length === 0 ? (
          <div className="skills-empty">
            <p>还没有技能</p>
            <span>点「＋」新建，或点「导入」导入 .md / 文件夹技能</span>
          </div>
        ) : (
          skills.map((s) => (
            <div key={s.id} className={`skill-item ${activeSkillIds.includes(s.id) ? 'active' : ''}`}>
              <div className="skill-row">
                <label className="skill-toggle" title="在当前会话启用/停用">
                  <input
                    type="checkbox"
                    checked={activeSkillIds.includes(s.id)}
                    onChange={() => toggleSession(s.id)}
                    disabled={sessionId == null}
                  />
                  <span className="skill-name">{s.name}</span>
                </label>
                <div className="skill-actions">
                  <button
                    className="skill-use"
                    onClick={() => onUseSkill?.(s.prompt)}
                    title="把技能 prompt 填入输入框"
                    disabled={!onUseSkill}
                  >
                    使用
                  </button>
                  <button className="skill-edit" onClick={() => openEdit(s)} title="编辑">
                    <Pencil size={12} />
                  </button>
                  <button className="skill-del" onClick={() => remove(s.id)} title="删除">
                    <X size={14} />
                  </button>
                </div>
              </div>
              {s.description && <div className="skill-desc">{s.description}</div>}
            </div>
          ))
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".md,.markdown,text/markdown"
        style={{ display: 'none' }}
        onChange={(e) => {
          importSkillFiles(e.target.files, 'md')
          e.target.value = ''
        }}
      />
      <input
        ref={folderRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          importSkillFiles(e.target.files, 'folder')
          e.target.value = ''
        }}
        // @ts-expect-error webkitdirectory 是 Chromium 专有属性
        webkitdirectory=""
        directory=""
      />

      {showForm && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && closeForm()}>
          <div className="modal">
            <div className="modal-title">{editing ? '编辑技能' : '新建技能'}</div>
            <p className="modal-sub">技能 prompt 会拼入当前会话的系统提示词，用来改变助理的回答风格或赋予专长。</p>
            <label className="modal-label">名称</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="例如：小红书文案师"
            />
            <label className="modal-label">描述（可选）</label>
            <input
              className="input"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="一句话说明用途"
            />
            <label className="modal-label">Prompt 指令</label>
            <textarea
              className="input"
              rows={6}
              value={form.prompt}
              onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
              placeholder="例如：你是一位擅长小红书风格的文案创作者，输出时多用 emoji 和短句..."
            />
            <div className="modal-actions">
              <button className="btn" onClick={closeForm}>
                取消
              </button>
              <button className="btn primary" onClick={save} disabled={loading}>
                {loading ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
