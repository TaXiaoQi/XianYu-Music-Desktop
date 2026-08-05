import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './style.css'
import '@applemusic-like-lyrics/core/style.css'
import './utils/requestIdleCallbackPolyfill'
import App from './App.vue'
import router from './router'
import { applyPersistedStartupTheme, shouldApplyStartupThemePaint } from './composables/startupTheme'
import { createDynamicImportRecovery } from './utils/dynamicImportRecovery'
import { installApplicationLogger } from './services/applicationLogger'
import { reportError } from './services/usageStats'

const currentWindowLabel = (() => {
  try {
    return getCurrentWindow().label
  } catch {
    return 'main'
  }
})()

installApplicationLogger(currentWindowLabel)

if (shouldApplyStartupThemePaint(currentWindowLabel)) {
  applyPersistedStartupTheme()
}

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

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

const DYNAMIC_IMPORT_RELOAD_KEY = 'lycia_dynamic_import_reload'

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
    localStorage.setItem('lycia_last_fatal_error', `${title}\n\n${message}`)
  } catch {
    // Ignore storage failures. The visible fallback is the important part.
  }

  const appRoot = document.getElementById('app')
  if (!appRoot) return

  appRoot.innerHTML = `
    <div style="height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#f5f5f5;color:#111827;font-family:'Segoe UI',system-ui,sans-serif;">
      <div style="width:min(920px,100%);background:#ffffff;border:1px solid rgba(17,24,39,0.08);border-radius:16px;box-shadow:0 20px 50px rgba(15,23,42,0.08);padding:24px;">
        <div style="font-size:20px;font-weight:600;margin-bottom:12px;">${escapeHtml(title)}</div>
        <div style="font-size:14px;line-height:1.6;color:#4b5563;margin-bottom:16px;">应用启动时发生异常。请把下面的错误信息反馈给开发者。</div>
        <pre style="margin:0;white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto;padding:16px;border-radius:12px;background:#111827;color:#f9fafb;font-size:12px;line-height:1.6;">${escapeHtml(message)}</pre>
      </div>
    </div>
  `
}

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.config.errorHandler = (error, _instance, info) => {
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

try {
  app.mount('#app')
} catch (error) {
  showFatalError('应用挂载失败', error)
}
