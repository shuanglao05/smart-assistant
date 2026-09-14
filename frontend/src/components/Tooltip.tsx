/**
 * Tooltip.tsx —— 全局悬浮提示（把原生 title 换成自绘浮层）
 *
 * 职责：
 *   在文档级别监听鼠标移入 / 移出：凡带 title 属性的元素，悬停时用自绘浮层显示其文本，
 *   同时【把原生 title 临时摘掉】，避免浏览器再弹一个系统提示、两个框重叠。
 *
 * 挂载位置：
 *   main.tsx（在路由之外，全局唯一一个）。因此任何组件只要补上 title 属性，
 *   就自动获得统一样式的提示，不必各自引入组件——这也是补 title 就能修好
 *   「模型名过长看不全」的原因。
 *
 * 组件状态 / 引用：
 *   tip   —— 当前要显示的提示（文本 + 坐标）
 *   cur   —— 当前悬停元素（移出时用于还原它的 title）
 *   saved —— 被临时摘掉的原始 title 文本
 *
 * 细节：
 *   滚动或窗口失焦时立即隐藏，避免浮层与元素脱节。
 */
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
