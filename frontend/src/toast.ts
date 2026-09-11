/** 轻量全局提示：复用 styles.css 的 .app-toast（fixed 顶部居中）。 */
let timer: number | undefined

export function toast(msg: string) {
  let el = document.getElementById('app-toast') as HTMLDivElement | null
  if (!el) {
    el = document.createElement('div')
    el.id = 'app-toast'
    el.className = 'app-toast'
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.style.display = 'block'
  if (timer) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    if (el) el.style.display = 'none'
  }, 2400)
}
