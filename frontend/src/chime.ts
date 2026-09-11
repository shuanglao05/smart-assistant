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

/**
 * 播放提示音。
 * @param tone 音色
 * @param volume 音量 0~1（0 表示静音）
 */
export function playChime(tone: ChimeTone = 'classic', volume = 0.6) {
  const vol = Math.max(0, Math.min(1, volume))
  if (vol <= 0) return
  const score = SCORES[tone] || SCORES.classic
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const resume = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve()
    void resume.then(() => {
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
    })
    // 播完关闭音频上下文，释放资源
    window.setTimeout(() => ctx.close().catch(() => {}), score.total * 1000 + 250)
  } catch {
    /* 声音不可用时忽略 */
  }
}
