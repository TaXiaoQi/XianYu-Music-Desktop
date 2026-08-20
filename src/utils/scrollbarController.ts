/**
 * 统一滚动条的"浮现"控制，按容器隔离。
 *
 * Chromium 的 ::-webkit-scrollbar 伪元素不支持 CSS 过渡，淡入淡出在这里用 rAF
 * 对**滚动容器自身**的 --scrollbar-thumb-alpha 变量逐帧动画实现（thumb 背景色
 * 取该变量，未设置时回退 0 即隐藏，见 style.css）。每个滚动容器持有自己的变量，
 * 因此滚动/悬停哪个容器，就只淡入哪个容器的滚动条，不会联动其他页面。
 *
 * 显示时机（二选一即浮现）：
 * - 鼠标悬停在某个可滚动容器的滚动条条带上（进入容器本身不触发）；
 * - 正在滚动该容器（capture 捕获所有子容器，但只作用于滚动事件目标容器）。
 * 时机结束后短暂延后淡出。
 */

const SCROLLBAR_THUMB_PX = 16
// 命中滚动条条带时的额外容忍，避免紧贴边界的抖动
const HOVER_TOLERANCE_PX = 3
const FADE_IN_MS = 180
const FADE_OUT_MS = 360
const HIDE_DELAY_MS = 700
const MS_PER_FRAME = 1000 / 60

const THUMB_VAR = '--scrollbar-thumb-alpha'

const isScrollableEl = (el: Element): boolean => {
  const overflowY = getComputedStyle(el).overflowY
  return (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
    && el.scrollHeight > el.clientHeight + 1
}

/** 返回指针坐标命中的可滚动容器（若指针落在其纵向滚动条条带上），否则 null */
const hitVerticalScrollbar = (x: number, y: number): HTMLElement | null => {
  const at = document.elementFromPoint(x, y)
  if (!at) return null
  let node: Element | null = at
  while (node && node !== document.documentElement) {
    if (isScrollableEl(node)) {
      const rect = node.getBoundingClientRect()
      if (x >= rect.right - SCROLLBAR_THUMB_PX - HOVER_TOLERANCE_PX && x <= rect.right + HOVER_TOLERANCE_PX) {
        return node as HTMLElement
      }
    }
    node = node.parentElement
  }
  return null
}

export function installScrollbarController(): void {
  let activeEl: HTMLElement | null = null // 当前显现滚动条的容器
  let alpha = 0 // activeEl 的当前 alpha
  const fadingOut: Array<{ el: HTMLElement; alpha: number }> = [] // 正在淡出的旧容器
  let hoverEl: HTMLElement | null = null
  let scrollEl: HTMLElement | null = null
  let scrollingUntil = 0
  let pendingX: number | null = null
  let pendingY: number | null = null
  let idleTimer: number | null = null
  let rafId = 0

  const apply = (el: HTMLElement, value: number) => {
    el.style.setProperty(THUMB_VAR, value.toFixed(3))
  }

  const armIdleHide = () => {
    if (idleTimer !== null) window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(() => {
      hoverEl = null
      scrollEl = null
      scrollingUntil = 0
      requestTick()
    }, HIDE_DELAY_MS)
  }

  const requestTick = () => {
    if (rafId === 0) {
      rafId = window.requestAnimationFrame((now) => tick(now))
    }
  }

  const tick = (now: number) => {
    rafId = 0

    if (pendingX !== null && pendingY !== null) {
      hoverEl = hitVerticalScrollbar(pendingX, pendingY)
      pendingX = null
      pendingY = null
      if (hoverEl) armIdleHide()
    }

    // 优先跟随滚动中的容器；否则跟随悬停在滚动条上的容器
    const targetEl = now < scrollingUntil && scrollEl ? scrollEl : hoverEl

    if (targetEl !== activeEl) {
      if (activeEl) {
        fadingOut.push({ el: activeEl, alpha }) // 旧容器渐进淡出
      }
      activeEl = targetEl
      alpha = 0
    }

    let needMore = false

    if (activeEl) {
      // 淡入上限取主题最大透明度（暗/亮各有不同），保持淡灰色的观感
      const maxAlpha = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--scrollbar-thumb-max-alpha'),
      ) || 0.38
      alpha = Math.min(maxAlpha, alpha + MS_PER_FRAME / FADE_IN_MS)
      apply(activeEl, alpha)
      if (alpha < maxAlpha) needMore = true
    }

    // 旧容器淡出到 0 后移除，避免残留变量
    for (let i = fadingOut.length - 1; i >= 0; i--) {
      const item = fadingOut[i]
      item.alpha -= MS_PER_FRAME / FADE_OUT_MS
      if (item.alpha <= 0) {
        apply(item.el, 0)
        fadingOut.splice(i, 1)
      } else {
        apply(item.el, item.alpha)
        needMore = true
      }
    }

    if (needMore) requestTick()
  }

  // 滚动触发：只作用于滚动事件的目标容器，其他容器不受影响
  window.addEventListener('scroll', (event) => {
    const target = (event.target as Node).nodeType === Node.ELEMENT_NODE
      ? event.target as HTMLElement : null
    if (target && isScrollableEl(target)) {
      scrollEl = target
      scrollingUntil = performance.now() + HIDE_DELAY_MS
      armIdleHide()
      requestTick()
    }
  }, { capture: true, passive: true })

  // 悬停触发：仅命中滚动条条带才算数
  document.addEventListener('mousemove', (event) => {
    pendingX = event.clientX
    pendingY = event.clientY
    requestTick()
  }, { passive: true })
}