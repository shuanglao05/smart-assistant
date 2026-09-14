/**
 * Weather.tsx —— 天气查询组件（实况 / 预报切换）
 *
 * 职责：
 *   输入城市名后查询实况天气或未来几天预报并展示。
 *   数据来自高德地图接口（经后端 /api/weather 代理），【完全不经过大模型】。
 *
 * 组件状态：
 *   city     —— 输入的城市名
 *   mode     —— 'now' 实况 / 其它为预报模式
 *   result / err / loading —— 结果文本、是否出错、加载中
 *   querying —— 正在查询的模式，用于只给对应按钮显示 loading
 *
 * 性能细节：
 *   每个 mode 各留一份最近结果缓存（放在 ref 中），切换 tab 时秒开、不必重复请求。
 *   缓存只影响展示，不改变查询语义；需要最新数据时重新查询即可覆盖。
 */
import { useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { weatherApi } from '../api'

type Mode = 'now' | 'forecast'

interface FCRow {
  label: string
  dayW: string
  dayT: string
  nightW: string
  nightT: string
  wind: string
}

/** 把后端返回的「北京市未来 3 天…/ - 今天：白天 小雨 28°C …」统一解析成逐行数据 */
function parseForecast(text: string): FCRow[] | null {
  const re = /^(.+?)[：:]\s*白天\s+(.+?)\s+(-?\d+)°C\s*\/\s*夜间\s+(.+?)\s+(-?\d+)°C(?:\s*，\s*(.*))?$/
  const rows: FCRow[] = []
  for (const line of text.split('\n')) {
    const m = line.trim().replace(/^-\s*/, '').match(re)
    if (!m) continue
    rows.push({
      label: m[1],
      dayW: m[2],
      dayT: m[3],
      nightW: m[4],
      nightT: m[5],
      wind: (m[6] || '').trim(),
    })
  }
  return rows.length ? rows : null
}

export default function Weather() {
  const [city, setCity] = useState('')
  const [mode, setMode] = useState<Mode>('now')
  const [result, setResult] = useState('')
  const [err, setErr] = useState(false)
  const [loading, setLoading] = useState(false)
  const [querying, setQuerying] = useState<Mode | null>(null)
  // 每个 mode 的最近一次结果缓存：切换 tab 秒开，不必重新请求
  const cache = useRef<Record<Mode, { result: string; err: boolean; ts: number } | null>>({
    now: null,
    forecast: null,
  })

  const query = async (nextMode: Mode) => {
    const c = city.trim()
    if (!c) return
    setMode(nextMode)
    setLoading(true)
    setErr(false)
    setQuerying(nextMode)
    try {
      const { data } = await weatherApi.get(c, nextMode)
      cache.current[nextMode] = { result: data.result, err: false, ts: Date.now() }
      setResult(data.result)
      setErr(data.result.startsWith('未') || data.result.includes('失败'))
    } catch {
      setErr(true)
      setResult('查询失败，请重试')
    } finally {
      setLoading(false)
      setQuerying(null)
    }
  }

  // 切 tab：有缓存立即展示（不重新请求），没缓存才去拉
  const switchMode = (m: Mode) => {
    if (m === mode) return
    setMode(m)
    const hit = cache.current[m]
    if (hit) {
      setResult(hit.result)
      setErr(hit.err)
    } else {
      query(m)
    }
  }

  const rows = mode === 'forecast' && result && !err ? parseForecast(result) : null

  return (
    <div className="weather-tool">
      <div className="weather-row">
        <input
          className="input weather-input"
          placeholder="城市名，如 北京"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && query(mode)}
        />
        <button className="btn-icon" onClick={() => query(mode)} disabled={loading} title="查询">
          <Search size={17} />
        </button>
      </div>

      <div className="weather-tabs">
        <button
          className={`weather-tab ${mode === 'now' ? 'active' : ''}`}
          onClick={() => switchMode('now')}
        >
          实况{querying === 'now' ? '…' : ''}
        </button>
        <button
          className={`weather-tab ${mode === 'forecast' ? 'active' : ''}`}
          onClick={() => switchMode('forecast')}
        >
          未来 3 天{querying === 'forecast' ? '…' : ''}
        </button>
      </div>

      {loading && !result && <div className="weather-result">查询中…</div>}

      {result && !loading && !rows && (
        <div className={`weather-result ${err ? 'err' : ''}`}>{result}</div>
      )}

      {rows && (
        <div className="fc-table">
          <div className="fc-row fc-head">
            <span>日期</span>
            <span>白天</span>
            <span>夜间</span>
            <span>风向</span>
          </div>
          {rows.map((r, i) => (
            <div className="fc-row" key={i}>
              <span className="fc-day">{r.label}</span>
              <span>{r.dayW} {r.dayT}°</span>
              <span>{r.nightW} {r.nightT}°</span>
              <span className="fc-wind">{r.wind}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
