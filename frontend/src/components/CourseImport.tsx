import { useRef, useState } from 'react'
import {
  ClipboardPaste,
  Image as ImageIcon,
  Link2,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react'
import { coursesApi } from '../api'
import { getGlobalModel } from '../globalModel'
import type { ParsedCourse } from '../types'

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const SECTIONS = Array.from({ length: 12 }, (_, i) => i + 1)

/** 压缩图片（最长边 1400，JPEG）：减小请求体，也让识别更稳 */
function compressImage(file: File, maxSide = 1400): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const w0 = img.naturalWidth || 1
      const h0 = img.naturalHeight || 1
      const scale = Math.min(1, maxSide / Math.max(w0, h0))
      const w = Math.max(1, Math.round(w0 * scale))
      const h = Math.max(1, Math.round(h0 * scale))
      const cv = document.createElement('canvas')
      cv.width = w
      cv.height = h
      const ctx = cv.getContext('2d')
      if (!ctx) {
        reject(new Error('浏览器不支持 canvas'))
        return
      }
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      resolve(cv.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}

/** 智能导入课表：给网址 / 粘贴内容 / 截图 → AI 解析成课程草稿（可逐条编辑）→ 确认入库 */
export default function CourseImport({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: () => void
}) {
  const [tab, setTab] = useState<'url' | 'text' | 'image'>('url')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [image, setImage] = useState('')
  const [loading, setLoading] = useState(false)
  const [parsed, setParsed] = useState<ParsedCourse[] | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const canParse = tab === 'url' ? !!url.trim() : tab === 'text' ? !!text.trim() : !!image

  const parse = async () => {
    setLoading(true)
    setParsed(null)
    try {
      const g = getGlobalModel()
      // 图片识别用视觉模型（不带全局模型，避免用非视觉模型）；文本/网址用全局模型
      const body =
        tab === 'image'
          ? { image }
          : { ...(tab === 'url' ? { url } : { text }), provider: g?.provider, model: g?.model }
      const { data } = await coursesApi.import(body)
      if (data.count === 0) {
        alert('没解析出课程，换个内容或改用「粘贴内容 / 图片识别」再试')
        return
      }
      setParsed(data.courses)
    } catch (e: any) {
      alert(e?.response?.data?.detail || '解析失败')
    } finally {
      setLoading(false)
    }
  }

  const pickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) {
      alert('请选择图片文件')
      return
    }
    try {
      setImage(await compressImage(f))
    } catch (err: any) {
      alert(`图片处理失败：${err?.message || err}`)
    }
  }

  const upd = (i: number, patch: Partial<ParsedCourse>) =>
    setParsed((p) => (p ? p.map((x, k) => (k === i ? { ...x, ...patch } : x)) : p))
  const del = (i: number) => setParsed((p) => (p ? p.filter((_, k) => k !== i) : p))

  const confirmImport = async () => {
    const valid = (parsed || []).filter((c) => c.name.trim())
    if (valid.length === 0) {
      alert('没有可导入的课程（课程名不能为空）')
      return
    }
    setSaving(true)
    try {
      for (const c of valid) {
        await coursesApi.create({
          name: c.name.trim(),
          weekday: Math.min(7, Math.max(1, c.weekday || 1)),
          start_section: Math.max(1, Math.min(c.start_section, c.end_section)),
          end_section: Math.max(1, Math.max(c.start_section, c.end_section)),
          teacher: c.teacher?.trim() || undefined,
          location: c.location?.trim() || undefined,
          weeks: c.weeks?.trim() || undefined,
        })
      }
      onImported()
    } catch (e: any) {
      alert(`导入失败：${e?.response?.data?.detail || e?.message || e}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal course-import">
        <div className="modal-title">
          智能导入课表
          <button className="ci-close" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="ci-tabs">
          <button className={`ci-tab ${tab === 'url' ? 'active' : ''}`} onClick={() => setTab('url')}>
            <Link2 size={13} /> 网址导入
          </button>
          <button
            className={`ci-tab ${tab === 'text' ? 'active' : ''}`}
            onClick={() => setTab('text')}
          >
            <ClipboardPaste size={13} /> 粘贴内容
          </button>
          <button
            className={`ci-tab ${tab === 'image' ? 'active' : ''}`}
            onClick={() => setTab('image')}
          >
            <ImageIcon size={13} /> 图片识别
          </button>
        </div>

        {tab === 'url' && (
          <input
            className="input"
            placeholder="课表网页网址，如 https://jw.xxx.edu.cn/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        )}
        {tab === 'text' && (
          <textarea
            className="input ci-text"
            placeholder="把课表内容（整页复制 / 表格文字）粘贴到这里，AI 会自动解析"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}
        {tab === 'image' && (
          <div className="ci-image">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={pickImage}
            />
            {image ? (
              <img className="ci-image-preview" src={image} alt="课表截图" />
            ) : (
              <button className="ci-image-drop" onClick={() => fileRef.current?.click()}>
                <Upload size={20} />
                <span>点击选择课表截图</span>
              </button>
            )}
            {image && (
              <button className="btn ci-image-change" onClick={() => fileRef.current?.click()}>
                换一张
              </button>
            )}
          </div>
        )}

        <p className="ci-hint">
          需要登录的教务系统：用「<b>粘贴内容</b>」（复制课表文字）或「<b>图片识别</b>」（截图）最靠谱，网址导入只对公开页面有效。
        </p>

        <div className="ci-actions">
          <button className="btn primary" onClick={parse} disabled={loading || !canParse}>
            <Wand2 size={14} /> {loading ? '解析中…' : 'AI 解析'}
          </button>
        </div>

        {parsed && parsed.length > 0 && (
          <>
            <div className="ci-preview-head">解析出 {parsed.length} 门课（可直接修改，改完再导入）</div>
            <div className="ci-list">
              {parsed.map((c, i) => (
                <div key={i} className="ci-edit">
                  <div className="ci-edit-row">
                    <input
                      className="ci-in ci-in-name"
                      value={c.name}
                      onChange={(e) => upd(i, { name: e.target.value })}
                      placeholder="课程名"
                    />
                    <select
                      className="ci-sel"
                      value={c.weekday}
                      onChange={(e) => upd(i, { weekday: +e.target.value })}
                    >
                      {WEEKDAYS.map((w, k) => (
                        <option key={w} value={k + 1}>
                          {w}
                        </option>
                      ))}
                    </select>
                    <select
                      className="ci-sel"
                      value={c.start_section}
                      onChange={(e) => upd(i, { start_section: +e.target.value })}
                    >
                      {SECTIONS.map((s) => (
                        <option key={s} value={s}>
                          第{s}节
                        </option>
                      ))}
                    </select>
                    <span className="ci-tilde">~</span>
                    <select
                      className="ci-sel"
                      value={c.end_section}
                      onChange={(e) => upd(i, { end_section: +e.target.value })}
                    >
                      {SECTIONS.map((s) => (
                        <option key={s} value={s}>
                          第{s}节
                        </option>
                      ))}
                    </select>
                    <button className="ci-del" onClick={() => del(i)} title="删除这条">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="ci-edit-row">
                    <input
                      className="ci-in"
                      value={c.teacher || ''}
                      onChange={(e) => upd(i, { teacher: e.target.value })}
                      placeholder="老师"
                    />
                    <input
                      className="ci-in"
                      value={c.location || ''}
                      onChange={(e) => upd(i, { location: e.target.value })}
                      placeholder="地点"
                    />
                    <input
                      className="ci-in ci-in-weeks"
                      value={c.weeks || ''}
                      onChange={(e) => upd(i, { weeks: e.target.value })}
                      placeholder="周次 如 1-16单周（留空=每周）"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="ci-actions">
              <button className="btn primary" onClick={confirmImport} disabled={saving}>
                {saving ? '导入中…' : `确认导入 ${parsed.length} 门课`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
