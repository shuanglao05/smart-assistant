import { useEffect, useRef, useState } from 'react'
import { notificationApi } from '../api'
import { Timer } from 'lucide-react'
import PageShell from '../components/PageShell'
import { CHIME_TONES, previewChime, playChime, unlockAudio, type ChimeTone } from '../chime'

type Tab = 'countdown' | 'stopwatch'

const PRESETS = [
  { label: '1 分钟', sec: 60 },
  { label: '5 分钟', sec: 300 },
  { label: '10 分钟', sec: 600 },
  { label: '25 分钟', sec: 1500 }, // 番茄钟
]

const TONE_KEY = 'timer_tone'
const VOLUME_KEY = 'timer_volume'

function loadTone(): ChimeTone {
  const t = localStorage.getItem(TONE_KEY) as ChimeTone | null
  return CHIME_TONES.some((x) => x.id === t) ? (t as ChimeTone) : 'classic'
}

function loadVolume(): number {
  const v = Number(localStorage.getItem(VOLUME_KEY))
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.6
}

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

  // ---- 提示音设置（音色 + 音量，保存在本机）----
  const [tone, setTone] = useState<ChimeTone>(loadTone)
  const [volume, setVolume] = useState<number>(loadVolume)
  const toneRef = useRef(tone)
  const volRef = useRef(volume)
  toneRef.current = tone
  volRef.current = volume

  const changeTone = (t: ChimeTone) => {
    setTone(t)
    localStorage.setItem(TONE_KEY, t)
    previewChime(t, volRef.current) // 换音色即试听（内部会先解锁音频上下文）
  }
  const changeVolume = (v: number) => {
    setVolume(v)
    localStorage.setItem(VOLUME_KEY, String(v))
  }

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
        // 播放所选提示音（音色/音量实时读取，避免被闭包固化）。
        // ⚠️ 这里【不要】用 alert：它是阻塞式弹窗，会卡住主线程，把铃声推迟到
        //    用户点掉弹窗之后才响（甚至听不见）。视觉提示交给按钮变「已结束」+ 站内通知。
        playChime(toneRef.current, volRef.current)
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
      icon={<Timer size={18} />}
      title="计时器"
      model={null}
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
            <button
              className="btn primary"
              // 关键：在【用户点击】这一刻解锁音频（浏览器自动播放策略要求）。
              // 否则倒计时结束时是定时器回调、并非用户手势，浏览器会拒绝发声。
              onClick={() => {
                unlockAudio()
                setRunning((v) => !v)
              }}
              disabled={left <= 0}
            >
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

          <div className="timer-sound">
            <label className="ts-item">
              <span>提示音</span>
              <select
                className="input ts-select"
                value={tone}
                onChange={(e) => changeTone(e.target.value as ChimeTone)}
              >
                {CHIME_TONES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ts-item">
              <span>音量</span>
              <input
                type="range"
                className="ts-range"
                min={0}
                max={100}
                value={Math.round(volume * 100)}
                onChange={(e) => changeVolume(Number(e.target.value) / 100)}
              />
              <em className="ts-val">{Math.round(volume * 100)}%</em>
            </label>
            <button className="btn ts-test" onClick={() => previewChime(tone, volume)}>
              试听
            </button>
          </div>

          <p className="settings-hint">倒计时结束会推送一条站内通知（右上角铃铛）并播放提示音；音色与音量可在此调节，设置会保存在本机。</p>
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
