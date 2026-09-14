/** 计时器提示音：用 Web Audio 合成，无需音频文件；支持多种音色与音量。 */

export type ChimeTone = 'classic' | 'crisp' | 'soft' | 'triple' | 'low' | 'digital'

export const CHIME_TONES: { id: ChimeTone; label: string }[] = [
  { id: 'classic', label: '经典（单响）' },
  { id: 'crisp', label: '清脆（双响）' },
  { id: 'soft', label: '柔和（和弦）' },
  { id: 'triple', label: '三连音（上行）' },
  { id: 'low', label: '低鸣（舒缓）' },
  { id: 'digital', label: '电子（滴滴）' },
]

type Beep = {
  freq: number
  start: number
  dur: number
  type?: OscillatorType
  peak?: number
}

/** 每个音色的音符序列与总时长（秒） */
const SCORES: Record<ChimeTone, { notes: Beep[]; total: number }> = {
  classic: { notes: [{ freq: 880, start: 0, dur: 0.5, peak: 1 }], total: 0.6 },
  crisp: {
    notes: [
      { freq: 1318, start: 0, dur: 0.12, type: 'triangle', peak: 0.9 },
      { freq: 1568, start: 0.16, dur: 0.18, type: 'triangle', peak: 0.9 },
    ],
    total: 0.4,
  },
  soft: {
    notes: [
      { freq: 523, start: 0, dur: 0.8, type: 'sine', peak: 0.7 },
      { freq: 659, start: 0.06, dur: 0.8, type: 'sine', peak: 0.6 },
    ],
    total: 1.0,
  },
  triple: {
    notes: [
      { freq: 784, start: 0, dur: 0.16, peak: 0.9 },
      { freq: 988, start: 0.2, dur: 0.16, peak: 0.9 },
      { freq: 1175, start: 0.4, dur: 0.26, peak: 0.9 },
    ],
    total: 0.75,
  },
  low: { notes: [{ freq: 440, start: 0, dur: 0.9, type: 'sine', peak: 1 }], total: 1.0 },
  digital: {
    notes: [
      { freq: 1200, start: 0, dur: 0.09, type: 'square', peak: 0.7 },
      { freq: 1200, start: 0.14, dur: 0.09, type: 'square', peak: 0.7 },
      { freq: 1600, start: 0.28, dur: 0.14, type: 'square', peak: 0.7 },
    ],
    total: 0.5,
  },
}

/*
 * ─────────────────────────────────────────────────────────────────────────
 * 【为什么要有单例 AudioContext + unlockAudio】
 * 浏览器的「自动播放策略」规定：AudioContext 必须在【用户手势】（点击 / 按键）
 * 中创建或 resume 才能出声。而倒计时结束是【定时器回调】，并非用户手势——
 * 此时若才 new AudioContext()，它会一直处于 suspended 且 resume() 被浏览器拒绝，
 * 表现就是「倒计时结束了但**不响铃**」。
 *
 * 正确做法（本文件采用）：
 *   1) 全局只建一个 AudioContext（懒创建、复用，不再每次新建/关闭）；
 *   2) 在用户点「开始 / 试听」时调用 unlockAudio() 把它 resume 解锁；
 *   3) 之后即使从定时器里调 playChime()，用的也是这个已解锁的 ctx，能正常发声。
 * ─────────────────────────────────────────────────────────────────────────
 */
let _ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (_ctx) return _ctx
  const w = window as unknown as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  const Ctx = w.AudioContext || w.webkitAudioContext
  if (!Ctx) return null
  try {
    _ctx = new Ctx()
  } catch {
    _ctx = null
  }
  return _ctx
}

/** 在【用户手势】里调用一次来解锁音频；已解锁则无副作用。 */
export function unlockAudio() {
  const ctx = getCtx()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
}

/**
 * 播放提示音。
 * @param tone 音色
 * @param volume 音量 0~1（0 表示静音）
 */
export function playChime(tone: ChimeTone = 'classic', volume = 0.6) {
  const vol = Math.max(0, Math.min(1, volume))
  if (vol <= 0) return
  const score = SCORES[tone] || SCORES.classic
  const ctx = getCtx()
  if (!ctx) return

  const play = () => {
    for (const n of score.notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = n.type || 'sine'
      osc.frequency.value = n.freq
      osc.connect(gain)
      gain.connect(ctx.destination)
      const t0 = ctx.currentTime + n.start
      const amp = Math.max(0.0001, vol * (n.peak ?? 1))
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(amp, t0 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur)
      osc.start(t0)
      osc.stop(t0 + n.dur + 0.04)
    }
  }

  try {
    if (ctx.state === 'suspended') {
      // 兜底：万一还没解锁（如页面刚打开就触发），尝试 resume 后再播
      ctx.resume().then(play).catch(() => {})
    } else {
      play()
    }
  } catch {
    /* 声音不可用时忽略 */
  }
}

/** 试听：确保先解锁再播放（用于「试听」按钮）。 */
export function previewChime(tone: ChimeTone, volume = 0.6) {
  unlockAudio()
  playChime(tone, volume)
}
