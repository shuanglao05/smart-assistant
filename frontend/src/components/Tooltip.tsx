import { useEffect, useRef, useState } from 'react'

type Tip = { text: string; x: number; y: number; below: boolean }

/**
 * 全局悬浮提示：自动把页面上带 title 的元素，换成统一风格的小浮层说明。
 * 鼠标移入时临时移除原生 title（屏蔽系统那种慢半拍的提示）并显示自绘框，移出时恢复。
 * 只需挂载一次，无需逐个改按钮。
 */
export default function Tooltip() {
  const [tip, setTip] = useState<Tip | null>(null)
  const cur = useRef<HTMLElement | null>(null)
  const saved = useRef('')

  useEffect(() => {
    const show = (el: HTMLElement) => {
      const text = el.getAttribute('title') || ''
      if (!text) return
      saved.current = text
      el.removeAttribute('title') // 屏蔽原生 tooltip
      const r = el.getBoundingClientRect()
      const below = r.top < 52 // 太靠顶部就显示在下方，避免被切掉
      setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom : r.top, below })
    }
    const restore = () => {
      if (cur.current && saved.current) cur.current.setAttribute('title', saved.current)
      cur.current = null
      saved.current = ''
    }
    const hide = () => {
      restore()
      setTip(null)
    }
    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[title]') as HTMLElement | null
      if (!el || el === cur.current) return
      restore()
      cur.current = el
      show(el)
    }
    const onOut = (e: MouseEvent) => {
      const el = cur.current
      if (!el) return
      const to = e.relatedTarget as Node | null
      if (to && el.contains(to)) return
      hide()
    }
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
      restore()
    }
  }, [])

  if (!tip) return null
  return (
    <div className={`tooltip ${tip.below ? 'below' : ''}`} style={{ left: tip.x, top: tip.y }}>
      {tip.text}
    </div>
  )
}
