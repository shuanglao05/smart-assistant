import { useEffect, useRef, useState } from 'react'
import { notificationApi } from '../api'
import PageShell from '../components/PageShell'

type Tab = 'countdown' | 'stopwatch'

const PRESETS = [
  { label: '1 分钟', sec: 60 },
  { label: '5 分钟', sec: 300 },
  { label: '10 分钟', sec: 600 },
  { label: '25 分钟', sec: 1500 }, // 番茄钟
]

function fmt(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  // 始终以 时:分:秒（HH:MM:SS）展示
  return `${pad(h)}:${pad(m)}:${pad(ss)}`
}

export default function TimerPage() {
  const [tab, setTab] = useState<Tab>('countdown')

  // ---- 倒计时 ----
  const [total, setTotal] = useState(300)
  const [left, setLeft] = useState(300)
  const [running, setRunning] = useState(false)
  // 自定义时长：时 / 分 / 秒 三个输入格
  const [inputH, setInputH] = useState('0')
  const [inputM, setInputM] = useState('5')
  const [inputS, setInputS] = useState('0')
  const endRef = useRef<number | null>(null)

  // ---- 秒表 ----
  const [swMs, setSwMs] = useState(0)
  const [swRunning, setSwRunning] = useState(false)
  const swStartRef = useRef<number>(0)
  const swBaseRef = useRef<number>(0)

  // 倒计时：用结束时间戳计时，避免标签页休眠导致偏差
  useEffect(() => {
    if (!running) return
    endRef.current = Date.now() + left * 1000
    const id = window.setInterval(() => {
      const remain = ((endRef.current ?? 0) - Date.now()) / 1000
      if (remain <= 0) {
        setLeft(0)
        setRunning(false)
        window.clearInterval(id)
        // 到点：推送站内通知 + 提示音
        notificationApi
          .create('⏰ 倒计时结束', `你设定的 ${fmt(total)} 倒计时已完成`, 'remind')
          .catch(() => {})
        try {
          const ctx = new AudioContext()
          const o = ctx.createOscillator()
          const g = ctx.createGain()
          o.connect(g)
          g.connect(ctx.destination)
          o.frequency.value = 880
          g.gain.setValueAtTime(0.001, ctx.currentTime)
          g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02)
          o.start()
          setTimeout(() => {
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
            o.stop(ctx.currentTime + 0.55)
          }, 500)
        } catch {
          /* 声音不可用时忽略 */
        }
        alert('⏰ 倒计时结束！')
      } else {
        setLeft(remain)
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [running, total]) // left 不进依赖，避免每帧重建定时器

  // 秒表
  useEffect(() => {
    if (!swRunning) return
    swStartRef.current = Date.now()
    const id = window.setInterval(() => {
      setSwMs(swBaseRef.current + (Date.now() - swStartRef.current))
    }, 50)
    return () => window.clearInterval(id)
  }, [swRunning])

  const applyPreset = (sec: number) => {
    setRunning(false)
    setTotal(sec)
    setLeft(sec)
    setInputH(String(Math.floor(sec / 3600)))
    setInputM(String(Math.floor((sec % 3600) / 60)))
    setInputS(String(sec % 60))
  }

  const applyInput = () => {
    const h = Math.max(0, Number(inputH) || 0)
    const m = Math.max(0, Number(inputM) || 0)
    const s = Math.max(0, Number(inputS) || 0)
    const sec = Math.round(h * 3600 + m * 60 + s)
    if (sec <= 0) return
    setRunning(false)
    setTotal(sec)
    setLeft(sec)
  }

  const swReset = () => {
    setSwRunning(false)
    swBaseRef.current = 0
    setSwMs(0)
  }

  const swSec = swMs / 1000
  const progress = total > 0 ? 1 - left / total : 0

  return (
    <PageShell
      icon="⏱"
      title="计时器"
      actions={
        <div className="seg">
          <button className={`seg-btn ${tab === 'countdown' ? 'active' : ''}`} onClick={() => setTab('countdown')}>
            倒计时
          </button>
          <button className={`seg-btn ${tab === 'stopwatch' ? 'active' : ''}`} onClick={() => setTab('stopwatch')}>
            秒表
          </button>
        </div>
      }
    >
      {tab === 'countdown' ? (
        <div className="timer-body">
          <div className="timer-display">
            <div className="timer-num">{fmt(left)}</div>
            <div className="timer-progress">
              <div className="timer-progress-inner" style={{ width: `${Math.min(100, progress * 100)}%` }} />
            </div>
            <div className="timer-total">总时长 {fmt(total)}</div>
          </div>

          <div className="timer-presets">
            {PRESETS.map((p) => (
              <button
                key={p.sec}
                className={`preset-chip ${total === p.sec ? 'active' : ''}`}
                onClick={() => applyPreset(p.sec)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="timer-custom">
            <input
              className="input timer-field"
              type="number"
              min="0"
              step="1"
              value={inputH}
              onChange={(e) => setInputH(e.target.value)}
              onBlur={applyInput}
              onKeyDown={(e) => e.key === 'Enter' && applyInput()}
            />
            <span className="timer-unit">时</span>
            <input
              className="input timer-field"
              type="number"
              min="0"
              step="1"
              value={inputM}
              onChange={(e) => setInputM(e.target.value)}
              onBlur={applyInput}
              onKeyDown={(e) => e.key === 'Enter' && applyInput()}
            />
            <span className="timer-unit">分</span>
            <input
              className="input timer-field"
              type="number"
              min="0"
              step="1"
              value={inputS}
              onChange={(e) => setInputS(e.target.value)}
              onBlur={applyInput}
              onKeyDown={(e) => e.key === 'Enter' && applyInput()}
            />
            <span className="timer-unit">秒</span>
            <button className="btn" onClick={applyInput}>
              设定
            </button>
          </div>

          <div className="timer-actions">
            <button className="btn primary" onClick={() => setRunning((v) => !v)} disabled={left <= 0}>
              {running ? '暂停' : left <= 0 ? '已结束' : '开始'}
            </button>
            <button
              className="btn"
              onClick={() => {
                setRunning(false)
                setLeft(total)
              }}
            >
              重置
            </button>
          </div>

          <p className="settings-hint">倒计时结束会推送一条站内通知（右上角铃铛）并播放提示音。</p>
        </div>
      ) : (
        <div className="timer-body">
          <div className="timer-display">
            <div className="timer-num">{fmt(swSec)}</div>
            <div className="timer-total">{(swMs % 1000).toFixed(0).padStart(3, '0')} 毫秒</div>
          </div>

          <div className="timer-actions">
            <button className="btn primary" onClick={() => {
              if (swRunning) {
                swBaseRef.current = swMs
                setSwRunning(false)
              } else {
                setSwRunning(true)
              }
            }}>
              {swRunning ? '停止' : swMs > 0 ? '继续' : '开始'}
            </button>
            <button className="btn" onClick={swReset}>
              重置
            </button>
          </div>

          <p className="settings-hint">正计时秒表，适合记录专注时长、运动计时等。</p>
        </div>
      )}
    </PageShell>
  )
}
