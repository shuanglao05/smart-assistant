/** 主题 / 字号 / 强调色 统一管理。
 *
 * · 主题 4 种：亮色 / 暗色 / 护眼 / 高对比（data-theme 属性 + CSS 变量）
 * · 字号 6 档：12 / 14 / 16 / 18 / 20 / 22 px（data-fs 属性，改根字号等比缩放）
 * · 强调色：预设 + 自定义，落到 --brand 等 CSS 变量
 * 主题与字号同时存后端 users 表（跨设备同步）；强调色存 localStorage。
 */

export type ThemeName = 'light' | 'dark' | 'sepia' | 'contrast'
export type FontSizeName = 'fs12' | 'fs14' | 'fs16' | 'fs18' | 'fs20' | 'fs22'

export const THEMES: Array<{ value: ThemeName; label: string }> = [
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '暗色' },
  { value: 'sepia', label: '护眼' },
  { value: 'contrast', label: '高对比' },
]

export const FONT_SIZES: Array<{ value: FontSizeName; label: string }> = [
  { value: 'fs12', label: '12' },
  { value: 'fs14', label: '14' },
  { value: 'fs16', label: '16' },
  { value: 'fs18', label: '18' },
  { value: 'fs20', label: '20' },
  { value: 'fs22', label: '22' },
]

/** 强调色预设（首个为默认品牌蓝） */
export const ACCENTS: Array<{ value: string; label: string }> = [
  { value: '#4d6bfe', label: '蓝' },
  { value: '#7c5cff', label: '紫' },
  { value: '#12a594', label: '绿' },
  { value: '#e08a1e', label: '橙' },
  { value: '#e5484d', label: '玫红' },
]

const THEME_KEY = 'theme'
const FS_KEY = 'fontSize'
const ACCENT_KEY = 'accent'
const LEGACY_FS: Record<string, FontSizeName> = {
  small: 'fs12',
  medium: 'fs14',
  large: 'fs18',
}

export function applyTheme(t: string) {
  const theme = (THEMES.find((x) => x.value === t)?.value ?? 'dark') as ThemeName
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem(THEME_KEY, theme)
}

export function applyFontSize(s: string) {
  const fs = (FONT_SIZES.find((x) => x.value === s)?.value ??
    LEGACY_FS[s] ??
    'fs14') as FontSizeName
  document.documentElement.setAttribute('data-fs', fs)
  localStorage.setItem(FS_KEY, fs)
}

/** 强调色：设置 --brand 及其派生变量（tint / hover / accent / 用户气泡） */
export function applyAccent(color: string) {
  const c = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#4d6bfe'
  const root = document.documentElement
  root.style.setProperty('--brand', c)
  root.style.setProperty('--accent', c)
  root.style.setProperty('--brand-tint', `color-mix(in srgb, ${c} 14%, var(--panel-2))`)
  root.style.setProperty('--user-bubble', `color-mix(in srgb, ${c} 16%, var(--panel-2))`)
  root.style.setProperty('--brand-hover', `color-mix(in srgb, ${c} 82%, #000)`)
  localStorage.setItem(ACCENT_KEY, c)
}

export function getAccent(): string {
  return localStorage.getItem(ACCENT_KEY) || '#4d6bfe'
}

export function getSavedTheme(): string {
  return localStorage.getItem(THEME_KEY) || 'dark'
}

export function getSavedFontSize(): string {
  return localStorage.getItem(FS_KEY) || 'fs14'
}
