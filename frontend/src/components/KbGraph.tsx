/**
 * KbGraph.tsx —— 知识库关系图
 *
 * 职责：
 *   把一个知识库内的文档与片段可视化：点击节点可查看片段预览，
 *   用于直观判断「某个文件被切成了哪些片段、切分是否合理」。
 *
 * 组件属性（props）：
 *   collectionId —— 要展示的知识库 id；为 null 时不渲染（表示尚未选中知识库）
 *
 * 组件状态：
 *   data / loading —— 图谱数据与加载中标记
 *   sel            —— 当前选中节点（所属文档 / 片段序号 / 片段预览）
 *
 * 依赖：
 *   kbApi 的图谱接口；后端按 user_id + collection_id 过滤后返回，前端不做权限判断。
 */
import { useEffect, useMemo, useState } from 'react'
import { Network } from 'lucide-react'
import { kbApi } from '../api'
import type { KbGraph as KbGraphData } from '../types'

const CELL = 14 // 片段点阵的单元格边长
const DOT_R = 5 // 片段点半径
const PER_ROW = 12 // 每行多少个片段点
const COL_DOC = 196 // 文档列 x
const COL_DOC_W = 214 // 文档节点宽
const COL_CHUNK = 448 // 片段点阵起始 x
const ROOT_W = 142

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

/**
 * 知识库关系图：库 → 文档 → 片段（点阵）。
 * 纯 SVG 手绘，零依赖；点一下片段圆点可在下方看该片段开头。
 */
export default function KbGraph({ collectionId }: { collectionId: number | null }) {
  const [data, setData] = useState<KbGraphData | null>(null)
  const [loading, setLoading] = useState(false)
  const [sel, setSel] = useState<{ doc: string; index: number; preview: string } | null>(null)

  useEffect(() => {
    if (collectionId == null) {
      setData(null)
      return
    }
    setLoading(true)
    setSel(null)
    kbApi
      .graph(collectionId)
      .then(({ data }) => setData(data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [collectionId])

  const layout = useMemo(() => {
    if (!data) return null
    let y = 16
    const docs = data.documents.map((d) => {
      const shown = d.previews.length
      const rows = shown > 0 ? Math.ceil(shown / PER_ROW) : 1
      const h = d.chunks === 0 ? 42 : 28 + rows * CELL + 8
      const node = { d, y, h, shown }
      y += h + 12
      return node
    })
    return { docs, height: Math.max(y + 8, 130) }
  }, [data])

  if (collectionId == null) {
    return <div className="kbg-empty">先在左侧选择一个知识库</div>
  }
  if (loading) {
    return <div className="kbg-empty">加载中…</div>
  }
  if (!data || data.documents.length === 0) {
    return <div className="kbg-empty">这个库还没有文档，先点右上「上传到当前库」</div>
  }

  const H = layout!.height
  const rootY = H / 2

  return (
    <div className="kbg-wrap">
      <svg viewBox={`0 0 680 ${H}`} width="100%" preserveAspectRatio="xMinYMin meet" role="img">
        <title>{`知识库关系图：${data.collection.name}，${data.collection.files} 篇文档、${data.collection.chunks} 个片段`}</title>

        {layout!.docs.map(({ d, y, h }) => (
          <path
            key={'c' + d.id}
            d={`M ${ROOT_W + 8} ${rootY} C 175 ${rootY}, 175 ${y + h / 2}, ${COL_DOC} ${y + h / 2}`}
            fill="none"
            stroke="var(--line)"
            strokeWidth="1.5"
          />
        ))}

        <g>
          <rect
            x="8"
            y={rootY - 24}
            width={ROOT_W}
            height="48"
            rx="11"
            fill="var(--brand-tint)"
            stroke="var(--brand)"
            strokeWidth="1"
          />
          <text x={8 + ROOT_W / 2} y={rootY - 3} textAnchor="middle" fontSize="13" fontWeight="500" fill="var(--brand)">
            {truncate(data.collection.name, 11)}
          </text>
          <text x={8 + ROOT_W / 2} y={rootY + 14} textAnchor="middle" fontSize="11" fill="var(--ink-soft)">
            {data.collection.files} 篇 · {data.collection.chunks} 片段
          </text>
        </g>

        {layout!.docs.map(({ d, y, h, shown }) => (
          <g key={d.id}>
            <rect
              x={COL_DOC}
              y={y}
              width={COL_DOC_W}
              height={h}
              rx="9"
              fill="var(--panel-2)"
              stroke="var(--line)"
            />
            <text x={COL_DOC + 12} y={y + 19} fontSize="12.5" fill="var(--ink)">
              {truncate(d.filename, 20)}
            </text>
            <text x={COL_DOC + COL_DOC_W - 12} y={y + 19} textAnchor="end" fontSize="11" fill="var(--ink-soft)">
              {d.chunks} 段
            </text>

            {d.chunks === 0 && (
              <text x={COL_DOC + 12} y={y + 35} fontSize="11" fill="var(--warn)">
                未索引
              </text>
            )}

            {shown > 0 && (
              <line
                x1={COL_DOC + COL_DOC_W}
                y1={y + h / 2}
                x2={COL_CHUNK - 8}
                y2={y + h / 2}
                stroke="var(--line)"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
            )}

            {d.previews.map((p, i) => {
              const cx = COL_CHUNK + (i % PER_ROW) * CELL
              const cy = y + 30 + Math.floor(i / PER_ROW) * CELL
              const active = sel && sel.doc === d.filename && sel.index === p.index
              return (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={active ? DOT_R + 1.5 : DOT_R}
                  fill="var(--brand)"
                  opacity={active ? 1 : 0.72}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSel({ doc: d.filename, index: p.index, preview: p.preview })}
                >
                  <title>{p.preview}</title>
                </circle>
              )
            })}
          </g>
        ))}
      </svg>

      <div className="kbg-legend">
        <span className="kbg-dot" /> 每个圆点 = 一个知识片段（点一下看内容）
        {data.documents.some((d) => d.chunks > d.previews.length) && (
          <span className="kbg-more">（每篇最多展示 40 个片段）</span>
        )}
      </div>

      {sel ? (
        <div className="kbg-panel">
          <div className="kbg-panel-head">
            <Network size={13} /> 片段 #{sel.index} · {sel.doc}
          </div>
          <div className="kbg-panel-body">{sel.preview}…</div>
        </div>
      ) : (
        <div className="kbg-panel kbg-panel-idle">点上方任意圆点，这里会显示该片段的开头内容。</div>
      )}
    </div>
  )
}
