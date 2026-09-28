import { nextTick } from 'vue';
import type { Ref } from 'vue';
import type { Router } from 'vue-router';

const DEFAULT_REPAINT_ROUTE = '/settings';
const FALLBACK_FRAME_MS = 16;

/** 连续等待两帧渲染，确保中转页面完成一次实际重绘 */
function waitForRoutePaint(): Promise<void> {
  return new Promise((resolve) => {
    const scheduleFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
    if (!scheduleFrame) {
      setTimeout(resolve, FALLBACK_FRAME_MS);
      return;
    }

    scheduleFrame(() => scheduleFrame(() => resolve()));
  });
}

export interface StartupRouteRepaintOptions {
  router: Router,
  hasWindowMaterial: Ref<boolean>,
  skipNextPageTransition: Ref<boolean>,
  repaintRoute?: string,
}

export async function runStartupRouteRepaint(options: StartupRouteRepaintOptions) {
  const {
    router,
    hasWindowMaterial: materialEnabled,
    skipNextPageTransition: pausePageTransition,
    repaintRoute: pulseRoute = DEFAULT_REPAINT_ROUTE,
  } = options;

  const activeRoute = router.currentRoute.value;
  if (!materialEnabled.value || activeRoute.path === pulseRoute) {
    return;
  }

  const restoreRoute = activeRoute.fullPath || '/';
  pausePageTransition.value = true;

  const pulseAndSettle = async (targetRoute: string) => {
    await router.replace(targetRoute);
    await nextTick();
    await waitForRoutePaint();
  };

  try {
    await pulseAndSettle(pulseRoute);
    await pulseAndSettle(restoreRoute);
  } finally {
    pausePageTransition.value = false;
  }
}
