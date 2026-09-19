
const SCROLLBAR_THUMB_PX = 16
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
  let activeEl: HTMLElement | null = null
  let alpha = 0
  const fadingOut: Array<{ el: HTMLElement; alpha: number }> = []
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

    const targetEl = now < scrollingUntil && scrollEl ? scrollEl : hoverEl

    if (targetEl !== activeEl) {
      if (activeEl) {
        fadingOut.push({ el: activeEl, alpha })
      }
      activeEl = targetEl
      alpha = 0
    }

    let needMore = false

    if (activeEl) {
      const maxAlpha = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--scrollbar-thumb-max-alpha'),
      ) || 0.38
      alpha = Math.min(maxAlpha, alpha + MS_PER_FRAME / FADE_IN_MS)
      apply(activeEl, alpha)
      if (alpha < maxAlpha) needMore = true
    }

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

  document.addEventListener('mousemove', (event) => {
    pendingX = event.clientX
    pendingY = event.clientY
    requestTick()
  }, { passive: true })
}