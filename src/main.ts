import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './style.css'
import '@applemusic-like-lyrics/core/style.css'
import './utils/requestIdleCallbackPolyfill'
import App from './App.vue'
import router from './router'
import { applyPersistedStartupTheme, applyPersistedThemeColor, shouldApplyStartupThemePaint } from './composables/startupTheme'
import { createDynamicImportRecovery } from './utils/dynamicImportRecovery'
import { installApplicationLogger } from './services/applicationLogger'
import { reportError } from './services/usageStats'
import { installScrollbarController } from './utils/scrollbarController'

const currentWindowLabel = (() => {
  try {
    return getCurrentWindow().label
  } catch {
    return 'main'
  }
})()

installApplicationLogger(currentWindowLabel)

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

/**
 * 开发服务器热更新或应用升级后，旧分包地址可能瞬时失效。
 * 对这类错误自动刷新一次；冷却时间内再次失败则交给致命错误页，避免刷新循环。
 */
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

  try {
    localStorage.setItem('xianyu_last_fatal_error', `${title}\n\n${message}`)
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
  detail.textContent = message

  card.append(titleEl, hint, detail)
  page.append(card)
  appRoot.append(page)
}

const app = createApp(App)
const pinia = createPinia()

/** 从 Vue 实例回溯父链，拼出崩溃所在的组件链（供诊断致命渲染错误定位）。
 * 沿用 Vue 内部 devtools 读取组件名的方式，避免无谓计算。 */
const formatComponentChain = (instance: unknown): string => {
  const names: string[] = []
  let current: any = instance
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
  // 渲染崩溃时回溯组件链，并写入致命错误页明细，便于直接定位到具体组件。
  const chain = _instance ? formatComponentChain(_instance) : ''
  console.error(`[VueError ${info}] component chain: ${chain || '(no instance)'}`)
  if (chain && error instanceof Error) {
    error = Object.assign(new Error(`${error.message}${chain}`), { name: error.name })
  }
  // 上报到后台报错日志（fire-and-forget，失败静默）
  if (error instanceof Error) {
    reportError(error.name || 'VueError', error.message, error.stack, info)
  } else {
    reportError('VueError', String(error), '', info)
  }
  if (recoverDynamicImportError(error)) return
  showFatalError(`前端运行错误: ${info}`, error)
}

document.addEventListener('contextmenu', (e) => e.preventDefault())

// 统一滚动条浮现：鼠标悬停在滚动条条带上或滚动期间显示，带淡入淡出动画
installScrollbarController()

window.addEventListener('error', (event) => {
  const error = event.error ?? event.message
  // 上报到后台报错日志（fire-and-forget，失败静默）
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
  // 上报到后台报错日志（fire-and-forget，失败静默）
  const reason = event.reason
  if (reason instanceof Error) {
    reportError('unhandledrejection', reason.message, reason.stack)
  } else {
    reportError('unhandledrejection', String(reason))
  }
  if (recoverDynamicImportError(event.reason)) {
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

// 等初始导航完成再挂载：否则首屏先按 '/' 渲染 Home，初始导航落定后立即切到上次会话路由，
// page-fade 的 out-in 离场回调与后续路由更新竞态会导致 insertBefore(null) 崩溃
router.isReady().then(mountApp, (error) => {
  showFatalError('初始路由解析失败', error)
  mountApp()
})
