import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { installCriticalFirstPaintSync } from './composables/criticalFirstPaint'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './style.css'
import '@applemusic-like-lyrics/core/style.css'
import './utils/requestIdleCallbackPolyfill'
import App from './App.vue'
import router from './router'
import { applyPersistedStartupTheme, applyPersistedThemeColor, shouldApplyStartupThemePaint } from './composables/startupTheme'
import { createDynamicImportRecovery } from './utils/dynamicImportRecovery'
import { installApplicationLogger } from './services/applicationLogger'
import { initFallbackModuleSync } from './services/fallbackModules/sync'
import { reportError } from './services/domain/usageStats'
import { installScrollbarController } from './utils/scrollbarController'
import { setLoggerCallback } from './services/domain/pluginEngineBase'

const currentWindowLabel = (() => {
  try {
    return getCurrentWindow().label
  } catch {
    return 'main'
  }
})()

installApplicationLogger(currentWindowLabel)

// 插件引擎域内 log() 此前无回调注册、消息全被静默丢弃（getLyric/MV 探测等
// 排障日志在 devtools 与日志文件里都不可见）——统一转发到 console
setLoggerCallback((msg) => console.log('[plugin-engine]', msg))

if (currentWindowLabel === 'main') {
  initFallbackModuleSync()
}

applyPersistedThemeColor()

if (shouldApplyStartupThemePaint(currentWindowLabel)) {
  applyPersistedStartupTheme()
}

const formatError = (error: unknown) => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n\n${error.stack}` : ''}`
  }

  if (typeof error === 'string') {
    return error
  }

  try {
    return JSON.stringify(error, null, 2)
  } catch {
    return String(error)
  }
}

const DYNAMIC_IMPORT_RELOAD_KEY = 'xianyu_dynamic_import_reload'

const recoverDynamicImportError = createDynamicImportRecovery({
  getLastReloadAt: () => {
    try {
      return Number(sessionStorage.getItem(DYNAMIC_IMPORT_RELOAD_KEY) ?? 0)
    } catch {
      return 0
    }
  },
  setLastReloadAt: (value) => {
    try {
      sessionStorage.setItem(DYNAMIC_IMPORT_RELOAD_KEY, String(value))
    } catch {
      // 当前运行周期状态仍可阻止同一错误从多个通道重复处理。
    }
  },
  reload: () => window.location.reload(),
  schedule: (callback, delay) => {
    console.warn('动态模块加载失败，正在刷新应用以恢复。')
    window.setTimeout(callback, delay)
  },
})

const showFatalError = (title: string, error: unknown) => {
  const message = formatError(error)
  console.error(title, error)

  let diagnosticDump = ''
  try {
    const lbTrace = (window as any).__lbTrace
    if (Array.isArray(lbTrace) && lbTrace.length > 0) {
      diagnosticDump = `\n\nleaderboard trace:\n${lbTrace.join('\n')}`
    }
  } catch {
    // 诊断信息获取失败不影响错误展示
  }

  try {
    localStorage.setItem('xianyu_last_fatal_error', `${title}\n\n${message}${diagnosticDump}`)
  } catch {
    // Ignore storage failures. The visible fallback is the important part.
  }

  const appRoot = document.getElementById('app')
  if (!appRoot) return

  appRoot.replaceChildren()

  const page = document.createElement('div')
  page.className = 'fatal-error-page'

  const card = document.createElement('div')
  card.className = 'fatal-error-card'

  const titleEl = document.createElement('div')
  titleEl.className = 'fatal-error-title'
  titleEl.textContent = title

  const hint = document.createElement('div')
  hint.className = 'fatal-error-hint'
  hint.textContent = '应用启动时发生异常。请把下面的错误信息反馈给开发者。'

  const detail = document.createElement('pre')
  detail.className = 'fatal-error-detail'
  detail.textContent = `${message}${diagnosticDump}`

  card.append(titleEl, hint, detail)
  page.append(card)
  appRoot.append(page)
}

const app = createApp(App)
const pinia = createPinia()
setActivePinia(pinia)

installCriticalFirstPaintSync(router)

const formatComponentChain = (instance: unknown): string => {
  const names: string[] = []
  let current: any = instance
  if (current && current.$) current = current.$
  while (current) {
    const type = current.type
    const name = type ? (type.__name || type.name) : undefined
    if (name) names.push(`<${name}>`)
    current = current.parent
  }
  return names.length > 0 ? `\n\ncomponent chain:\n${names.join(' at ')}` : ''
}

app.use(pinia)
app.use(router)
app.config.errorHandler = (error, _instance, info) => {
  const chain = _instance ? formatComponentChain(_instance) : ''
  console.error(`[VueError ${info}] component chain: ${chain || '(no instance)'}`)
  if (chain && error instanceof Error) {
    error = Object.assign(new Error(`${error.message}${chain}`), { name: error.name })
  }
  if (error instanceof Error) {
    reportError(error.name || 'VueError', error.message, error.stack, info)
  } else {
    reportError('VueError', String(error), '', info)
  }
  if (recoverDynamicImportError(error)) return

  if (isBenignTauriChannelError(error)) {
    console.error(`[BenignTauriError ${info}]`, error)
    return
  }

  showFatalError(`前端运行错误: ${info}`, error)
}

document.addEventListener('contextmenu', (e) => e.preventDefault())

installScrollbarController()

const isBenignResizeObserverError = (error: unknown): boolean => {
  const msg = typeof error === 'string'
    ? error
    : (error instanceof Error ? error.message : String(error ?? ''))
  return msg.includes('ResizeObserver loop completed with undelivered notifications')
    || msg.includes('ResizeObserver loop limit exceeded')
}

const isBenignTauriChannelError = (error: unknown): boolean => {
  const msg = typeof error === 'string'
    ? error
    : (error instanceof Error ? error.message : String(error ?? ''))
  return msg.includes('sending on a closed channel')
    || msg.includes('channel closed')
    || msg.includes('Failed to send message to channel')
}

window.addEventListener('error', (event) => {
  const error = event.error ?? event.message
  if (isBenignResizeObserverError(error) || isBenignTauriChannelError(error)) {
    event.preventDefault()
    return
  }
  if (error instanceof Error) {
    reportError(error.name || 'Error', error.message, error.stack, `${event.filename}:${event.lineno}:${event.colno}`)
  } else if (typeof error === 'string') {
    reportError('WindowError', error, '', `${event.filename}:${event.lineno}:${event.colno}`)
  }
  if (recoverDynamicImportError(error)) {
    event.preventDefault()
    return
  }
  showFatalError('窗口脚本错误', error)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  if (reason instanceof Error) {
    reportError('unhandledrejection', reason.message, reason.stack)
  } else {
    reportError('unhandledrejection', String(reason))
  }
  if (recoverDynamicImportError(event.reason) || isBenignTauriChannelError(reason)) {
    event.preventDefault()
    return
  }
  showFatalError('未处理的异步错误', event.reason)
})

const mountApp = () => {
  try {
    app.mount('#app')
  } catch (error) {
    showFatalError('应用挂载失败', error)
  }
}

router.isReady().then(mountApp, (error) => {
  showFatalError('初始路由解析失败', error)
  mountApp()
})
