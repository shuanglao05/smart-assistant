/** 表格/日历尺寸自由调节控件：− 滑杆 ＋，值持久化由调用方负责。 */
export default function GridZoom({
  value,
  min,
  max,
  step = 4,
  onChange,
  label = '大小',
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  label?: string
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v)))
  return (
    <div className="grid-zoom" title={`${label}：${value}`}>
      <button type="button" className="gz-btn" onClick={() => onChange(clamp(value - step))} aria-label="缩小">
        −
      </button>
      <input
        type="range"
        className="gz-range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        aria-label={label}
      />
      <button type="button" className="gz-btn" onClick={() => onChange(clamp(value + step))} aria-label="放大">
        +
      </button>
    </div>
  )
}
