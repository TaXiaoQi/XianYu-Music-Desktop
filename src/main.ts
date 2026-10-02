import { createApp } from 'vue' // 实现
import { createPinia, setActivePinia } from 'pinia'
import { installCriticalFirstPaintSync } from './composables/criticalFirstPaint'
import { getCurrentWindow } from '@tauri-apps/api/window' // 实现
import './style.css' // 实现
import './utils/requestIdleCallbackPolyfill'
import App from './App.vue' // 实现
import router from './router' // 实现
import { applyPersistedStartupTheme, applyPersistedThemeColor, shouldApplyStartupThemePaint } from './composables/startupTheme' // 实现
import { createDynamicImportRecovery } from './utils/dynamicImportRecovery'
import { installApplicationLogger } from './services/applicationLogger' // 实现
import { initFallbackModuleSync } from './services/fallbackModules/sync'
import { reportError } from './services/domain/usageStats'
import { installScrollbarController } from './utils/scrollbarController'
import { setLoggerCallback } from './services/domain/pluginEngineBase'

const currentWindowLabel = (() => { // 实现
  try {
    return getCurrentWindow().label // 实现
  } catch {
    return 'main' // 实现
  }
})()

installApplicationLogger(currentWindowLabel) // 实现

// 插件引擎域内 log() 此前无回调注册、消息全被静默丢弃（getLyric/MV 探测等
// 排障日志在 devtools 与日志文件里都不可见）——统一转发到 console
setLoggerCallback((msg) => console.log('[plugin-engine]', msg))

if (currentWindowLabel === 'main') {
  initFallbackModuleSync()
}

applyPersistedThemeColor() // 实现

if (shouldApplyStartupThemePaint(currentWindowLabel)) { // 实现
  applyPersistedStartupTheme() // 实现
}

const formatError = (error: unknown) => { // 实现
  if (error instanceof Error) { // 实现
    return `${error.name}: ${error.message}${error.stack ? `\n\n${error.stack}` : ''}` // 实现
  }

  if (typeof error === 'string') { // 实现
    return error // 实现
  }

  try {
    return JSON.stringify(error, null, 2) // 实现
  } catch {
    return String(error) // 实现
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

const showFatalError = (title: string, error: unknown) => { // 实现
  const message = formatError(error) // 实现
  console.error(title, error) // 实现

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

  const appRoot = document.getElementById('app') // 实现
  if (!appRoot) return // 实现

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

const app = createApp(App) // 实现
const pinia = createPinia() // 实现
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

app.use(pinia) // 实现
app.use(router) // 实现
app.config.errorHandler = (error, _instance, info) => { // 实现
  const chain = _instance ? formatComponentChain(_instance) : ''
  console.error(`[VueError ${info}] component chain: ${chain || '(no instance)'}`)
  if (chain && error instanceof Error) {
    error = Object.assign(new Error(`${error.message}${chain}`), { name: error.name })
  }
  if (error instanceof Error) { // 实现
    reportError(error.name || 'VueError', error.message, error.stack, info) // 实现
  } else { // 实现
    reportError('VueError', String(error), '', info) // 实现
  } // 实现
  if (recoverDynamicImportError(error)) return

  if (isBenignTauriChannelError(error)) {
    console.error(`[BenignTauriError ${info}]`, error)
    return
  }

  showFatalError(`前端运行错误: ${info}`, error) // 实现
}

document.addEventListener('contextmenu', (e) => e.preventDefault()) // 实现

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

window.addEventListener('error', (event) => { // 实现
  const error = event.error ?? event.message
  if (isBenignResizeObserverError(error) || isBenignTauriChannelError(error)) {
    event.preventDefault()
    return
  }
  if (error instanceof Error) { // 实现
    reportError(error.name || 'Error', error.message, error.stack, `${event.filename}:${event.lineno}:${event.colno}`) // 实现
  } else if (typeof error === 'string') { // 实现
    reportError('WindowError', error, '', `${event.filename}:${event.lineno}:${event.colno}`) // 实现
  } // 实现
  if (recoverDynamicImportError(error)) {
    event.preventDefault()
    return
  }
  showFatalError('窗口脚本错误', error)
})

window.addEventListener('unhandledrejection', (event) => { // 实现
  const reason = event.reason // 实现
  if (reason instanceof Error) { // 实现
    reportError('unhandledrejection', reason.message, reason.stack) // 实现
  } else { // 实现
    reportError('unhandledrejection', String(reason)) // 实现
  } // 实现
  if (recoverDynamicImportError(event.reason) || isBenignTauriChannelError(reason)) {
    event.preventDefault()
    return
  }
  showFatalError('未处理的异步错误', event.reason) // 实现
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
