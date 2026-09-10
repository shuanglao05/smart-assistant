/**
 * 轻量 i18n（zh / en）。
 * - 当前为个人助理项目，只翻译主要可见字符串，未覆盖的仍保留中文/原文。
 * - 通过 I18nProvider 在 App 顶层挂载，子组件用 useI18n() 读取。
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type Lang = 'zh' | 'en'

export const SUPPORTED_LANGS: { value: Lang; label: string }[] = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

// 翻译表（key → 翻译）。未命中则原样返回 key（开发期方便补漏）。
const translations: Record<Lang, Record<string, string>> = {
  zh: {
    // 通用
    'app.title': '灵犀 · 智能个人助理',
    'common.confirm': '确认',
    'common.cancel': '取消',
    'common.save': '保存',
    'common.close': '关闭',
    'common.loading': '加载中…',
    'common.edit': '编辑',
    'common.delete': '删除',

    // 登录
    'login.welcome': '欢迎回来',
    'login.subtitle': '登录后开启你的 AI 个人助理',
    'login.username': '账号（登录ID）',
    'login.password': '密码',
    'login.submit': '登录',
    'login.toRegister': '没有账号？',
    'login.register': '注册',
    'login.toLogin': '已有账号？',

    // 侧栏
    'sidebar.assistant': '智能助理',
    'sidebar.newChat': '新建会话',
    'sidebar.searchPlaceholder': '搜索全部历史…',
    'sidebar.logout': '退出登录',
    'sidebar.emptySearch': '没有匹配结果',
    'sidebar.deleteConfirm': '删除该会话及其消息？',
    'sidebar.renameHint': '双击重命名',

    // 顶栏
    'topbar.export': '导出',
    'topbar.exportTitle': '导出当前对话为 Markdown 文件',
    'topbar.collapsePanel': '收起右侧面板',
    'topbar.expandPanel': '展开右侧面板',
    'topbar.settings': '设置',
    'topbar.composer.stop': '停止',
    'topbar.composer.send': '发送',

    // 消息
    'msg.copy': '复制',
    'msg.copied': '已复制',
    'msg.regenerate': '重新生成',
    'msg.placeholder.p': '开聊吧',
    'msg.placeholder.s': '试试：「帮我计算 12*15」或「记一下明天交报告」',
    'msg.generating': '生成中…点「停止」可中断',

    // 右栏
    'right.weather': '天气',
    'right.skills': '技能',
    'right.todo': '待办事项',
    'right.weather.now': '实况',
    'right.weather.forecast': '未来 3 天',
    'right.weather.cityPlaceholder': '城市名，如 北京',
    'right.weather.query': '查询',
    'right.skills.sub': '勾选=当前会话启用；「使用」=填入输入框',
    'right.skills.empty': '还没有技能',
    'right.skills.emptyTip': '点「＋」新建，或点「导入」导入 .md / 文件夹技能',
    'right.skills.import': '导入',
    'right.skills.importMd': '导入 .md 文件',
    'right.skills.importFolder': '导入技能文件夹',
    'right.todo.empty': '还没有待办',
    'right.todo.emptyTip': '也可以直接问助理「帮我记一下…」',
    'right.todo.placeholder': '添加一条待办…',
    'right.todo.add': '添加',

    // 通知
    'notif.title': '通知中心',
    'notif.readAll': '全部已读',
    'notif.clear': '清空',
    'notif.test': '测试',
    'notif.empty': '暂无通知',
    'notif.emptyTip': '试试对 AI 说「提醒我 30 分钟后喝水」',

    // 附件
    'attach.title': '上传附件（txt/md/csv/json/pdf…）让助手阅读后回答',

    // 设置
    'settings.title': '设置',
    'settings.tab.appearance': '外观',
    'settings.tab.language': '语言',
    'settings.tab.api': 'API 管理',
    'settings.tab.account': '账户',
    'settings.theme.label': '主题',
    'settings.theme.dark': '深色',
    'settings.theme.light': '浅色',
    'settings.theme.hint': '仅切换颜色，布局保持不变',
    'settings.fontSize.label': '字体大小',
    'settings.fontSize.small': '小',
    'settings.fontSize.medium': '中',
    'settings.fontSize.large': '大',
    'settings.lang.label': '界面语言',
    'settings.api.provider': '服务商',
    'settings.api.baseUrl': 'Base URL',
    'settings.api.model': '模型',
    'settings.api.key': 'API Key',
    'settings.api.usage': '前往用量监控',
    'settings.api.edit': '修改 API Key',
    'settings.api.unset': '尚未配置',
    'settings.api.shared': '当前为共享配置，所有用户共用同一个 Key',
    'settings.api.savedToast': '已保存到 .env，下次重启后端生效',
    'settings.avatar.label': '头像',
    'settings.avatar.upload': '上传图片',
    'settings.avatar.hint': '选择预设或上传图片（≤3MB，上传后自动压缩）',
    'settings.nickname.label': '昵称',
    'settings.nickname.placeholder': '给自己起个名字',
    'settings.username.label': '登录ID',
    'settings.username.locked': '（不可修改）',
    'settings.pwd.label': '修改密码',
    'settings.pwd.current': '当前密码',
    'settings.pwd.new': '新密码',
    'settings.pwd.save': '保存密码',
    'settings.pwd.saved': '密码已更新',
    'settings.logout': '退出登录',
    'settings.saved': '已保存',
  },
  en: {
    'app.title': 'Lingxi · AI Personal Assistant',
    'common.confirm': 'Confirm',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.close': 'Close',
    'common.loading': 'Loading…',
    'common.edit': 'Edit',
    'common.delete': 'Delete',

    'login.welcome': 'Welcome back',
    'login.subtitle': 'Sign in to start your AI assistant',
    'login.username': 'Account (Login ID)',
    'login.password': 'Password',
    'login.submit': 'Sign in',
    'login.toRegister': "Don't have an account?",
    'login.register': 'Register',
    'login.toLogin': 'Already have an account?',

    'sidebar.assistant': 'AI Assistant',
    'sidebar.newChat': 'New chat',
    'sidebar.searchPlaceholder': 'Search all history…',
    'sidebar.logout': 'Sign out',
    'sidebar.emptySearch': 'No matches',
    'sidebar.deleteConfirm': 'Delete this chat and its messages?',
    'sidebar.renameHint': 'Double-click to rename',

    'topbar.export': 'Export',
    'topbar.exportTitle': 'Export this conversation as Markdown',
    'topbar.collapsePanel': 'Collapse right panel',
    'topbar.expandPanel': 'Expand right panel',
    'topbar.settings': 'Settings',
    'topbar.composer.stop': 'Stop',
    'topbar.composer.send': 'Send',

    'msg.copy': 'Copy',
    'msg.copied': 'Copied',
    'msg.regenerate': 'Regenerate',
    'msg.placeholder.p': 'Start a conversation',
    'msg.placeholder.s': 'Try: "Compute 12*15" or "Remind me about the report tomorrow"',
    'msg.generating': 'Generating… click Stop to interrupt',

    'right.weather': 'Weather',
    'right.skills': 'Skills',
    'right.todo': 'Todos',
    'right.weather.now': 'Now',
    'right.weather.forecast': '3-day',
    'right.weather.cityPlaceholder': 'City, e.g. Beijing',
    'right.weather.query': 'Query',
    'right.skills.sub': 'Check to enable in current chat; "Use" fills the input',
    'right.skills.empty': 'No skills yet',
    'right.skills.emptyTip': 'Click + to create, or ⇪ to import .md / folder skills',
    'right.skills.import': 'Import',
    'right.skills.importMd': 'Import .md files',
    'right.skills.importFolder': 'Import skill folder',
    'right.todo.empty': 'No todos',
    'right.todo.emptyTip': 'Or just ask the assistant "remember this…"',
    'right.todo.placeholder': 'Add a todo…',
    'right.todo.add': 'Add',

    'notif.title': 'Notifications',
    'notif.readAll': 'Read all',
    'notif.clear': 'Clear',
    'notif.test': 'Test',
    'notif.empty': 'No notifications',
    'notif.emptyTip': 'Try: "remind me to drink water in 30 minutes"',

    'attach.title': 'Attach files (txt/md/csv/json/pdf…) for the assistant to read',

    'settings.title': 'Settings',
    'settings.tab.appearance': 'Appearance',
    'settings.tab.language': 'Language',
    'settings.tab.api': 'API',
    'settings.tab.account': 'Account',
    'settings.theme.label': 'Theme',
    'settings.theme.dark': 'Dark',
    'settings.theme.light': 'Light',
    'settings.theme.hint': 'Only colors change, layout stays',
    'settings.fontSize.label': 'Font size',
    'settings.fontSize.small': 'S',
    'settings.fontSize.medium': 'M',
    'settings.fontSize.large': 'L',
    'settings.lang.label': 'Interface language',
    'settings.api.provider': 'Provider',
    'settings.api.baseUrl': 'Base URL',
    'settings.api.model': 'Model',
    'settings.api.key': 'API Key',
    'settings.api.usage': 'Open usage dashboard',
    'settings.api.edit': 'Edit API Key',
    'settings.api.unset': 'Not configured',
    'settings.api.shared': 'Shared config — all users use the same key',
    'settings.api.savedToast': 'Saved to .env. Restart backend to take effect.',
    'settings.avatar.label': 'Avatar',
    'settings.avatar.upload': 'Upload image',
    'settings.avatar.hint': 'Pick a preset or upload an image (≤3MB, auto-compressed)',
    'settings.nickname.label': 'Nickname',
    'settings.nickname.placeholder': 'Your display name',
    'settings.username.label': 'Login ID',
    'settings.username.locked': '(cannot be changed)',
    'settings.pwd.label': 'Change password',
    'settings.pwd.current': 'Current password',
    'settings.pwd.new': 'New password',
    'settings.pwd.save': 'Save password',
    'settings.pwd.saved': 'Password updated',
    'settings.logout': 'Sign out',
    'settings.saved': 'Saved',
  },
}

interface I18nValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string) => string
}

const I18nContext = createContext<I18nValue | null>(null)

const LANG_KEY = 'lang'

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(
    () => (localStorage.getItem(LANG_KEY) as Lang) || 'zh'
  )
  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    localStorage.setItem(LANG_KEY, l)
    document.documentElement.setAttribute('data-lang', l)
  }, [])
  const t = useCallback(
    (key: string) => translations[lang]?.[key] ?? key,
    [lang]
  )
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const v = useContext(I18nContext)
  if (!v) throw new Error('useI18n must be used inside I18nProvider')
  return v
}
