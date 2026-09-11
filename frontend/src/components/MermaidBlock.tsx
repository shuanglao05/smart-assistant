import { useEffect, useRef, useState } from 'react'
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react'

const MMD_MIN = 0.4
const MMD_MAX = 3
const clampZoom = (z: number) => Math.min(MMD_MAX, Math.max(MMD_MIN, +z.toFixed(2)))

/**
 * Mermaid 图表块：懒加载 mermaid，把 ```mermaid 代码块渲染成流程图 / 时序图 / 柱状图等。
 *  - 流式进行中先不渲染（语法不完整会反复报错、页面被"语法错误炸弹"刷屏），等内容结束再渲染；
 *  - suppressErrorRendering 关掉 mermaid 往页面里注入的错误 SVG；
 *  - 渲染失败回退普通代码块；渲染成功后可用按钮 / Ctrl+滚轮 缩放。
 */
export default function MermaidBlock({ code, streaming }: { code: string; streaming?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [err, setErr] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    if (streaming) return
    let cancelled = false
    setErr(null)
    ;(async () => {
      try {
        const mermaid = (await import('mermaid')).default
        const dark = document.documentElement.getAttribute('data-theme') === 'dark'
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          suppressErrorRendering: true,
          theme: dark ? 'dark' : 'default',
        })
        const id = 'mmd' + Math.random().toString(36).slice(2)
        const { svg } = await mermaid.render(id, code.trim())
        if (!cancelled && ref.current) ref.current.innerHTML = svg
      } catch (e: any) {
        if (!cancelled) setErr(String(e?.message || e))
      } finally {
        document.querySelectorAll('[id^="dmmd"]').forEach((el) => el.remove())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code, streaming])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom((z) => clampZoom(z - Math.sign(e.deltaY) * 0.1))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [streaming, err])

  if (streaming) return <pre className="mermaid-pending">{code}</pre>
  if (err) {
    return (
      <pre className="mermaid-fallback" title={err}>
        {code}
      </pre>
    )
  }
  return (
    <div className="mermaid-wrap">
      <div className="mermaid-tools">
        <button type="button" title="缩小" onClick={() => setZoom((z) => clampZoom(z - 0.2))}>
          <ZoomOut size={13} />
        </button>
        <span className="mermaid-zoom-label">{Math.round(zoom * 100)}%</span>
        <button type="button" title="放大" onClick={() => setZoom((z) => clampZoom(z + 0.2))}>
          <ZoomIn size={13} />
        </button>
        <button type="button" title="重置缩放" onClick={() => setZoom(1)}>
          <Maximize2 size={13} />
        </button>
        <span className="mermaid-tip">Ctrl+滚轮缩放</span>
      </div>
      <div className="mermaid-scroll" ref={scrollRef}>
        <div className="mermaid-block" ref={ref} style={{ zoom } as any} />
      </div>
    </div>
  )
}
