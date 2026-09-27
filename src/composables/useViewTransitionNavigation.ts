import { nextTick } from 'vue';
import type { RouteLocationRaw, Router } from 'vue-router';

/**
 * 视图过渡进行中挂在 <html> 上的类：只用于暂停侧边栏指示块自身的 CSS 过渡。
 *
 * 指示块是共享元素（view-transition-name: nav-indicator），必须先停在旧几何位置让浏览器采到
 * 「旧」快照；否则它的 top/height 过渡会在截图前就向新位置移动，使新旧快照几何重合、morph
 * 距离塌缩为 0。page-fade 是页面内容自身的过渡、不参与 View Transition，不受此类影响。
 */
export const NAV_INDICATOR_TRANSITION_PAUSED_CLASS = 'nav-indicator-transition-paused';

interface ViewTransitionLike {
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
}

type StartViewTransition = (callback: () => void | Promise<void>) => ViewTransitionLike;

// 进行中的视图过渡计数：归零时才摘下抑制类（快速连点时不至于被前一次提前摘掉）
let activeTransitionCount = 0;

const prefersReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

const getStartViewTransition = (): StartViewTransition | undefined => {
  if (typeof document === 'undefined') {
    return undefined;
  }
  const doc = document as unknown as { startViewTransition?: StartViewTransition };
  if (typeof doc.startViewTransition !== 'function') {
    return undefined;
  }
  return doc.startViewTransition.bind(doc) as StartViewTransition;
};

const markTransitionActive = () => {
  activeTransitionCount += 1;
  if (typeof document !== 'undefined') {
    document.documentElement?.classList.add(NAV_INDICATOR_TRANSITION_PAUSED_CLASS);
  }
};

const markTransitionSettled = () => {
  activeTransitionCount = Math.max(0, activeTransitionCount - 1);
  if (activeTransitionCount === 0 && typeof document !== 'undefined') {
    document.documentElement?.classList.remove(NAV_INDICATOR_TRANSITION_PAUSED_CLASS);
  }
};

/**
 * 在 View Transition 中执行一次导航。
 *
 * - 支持 `document.startViewTransition` 且系统未开启「减弱动态效果」时，
 *   导航放进过渡回调执行，并等过渡结束再返回，避免中途重定向采到错位快照；
 * - API 缺失、被调用即抛错、或系统开启减弱动效时，直接执行导航；
 * - 失败安全：无论过渡是否可用/是否抛错，导航都恰好发生一次，绝不阻塞、绝不重复，
 *   过渡 promise 被跳过/中断产生的 rejection 也会被吞掉，不会冒成未处理错误。
 */
export async function runNavigation(run: () => Promise<unknown> | unknown): Promise<void> {
  const start = getStartViewTransition();
  if (!start || prefersReducedMotion()) {
    await run();
    return;
  }

  let invoked = false;
  const runOnce = async () => {
    if (invoked) return;
    invoked = true;
    await run();
    // 等 Vue 把这次路由变更刷新到 DOM（激活项与指示块几何），再让浏览器截取「新」快照
    await nextTick();
  };

  let transition: ViewTransitionLike | undefined;
  try {
    markTransitionActive();
    transition = start(runOnce);
  } catch {
    // startViewTransition 同步抛错：回调可能尚未执行，补一次以保证导航恰好发生一次
    try {
      await runOnce();
    } finally {
      markTransitionSettled();
    }
    return;
  }

  try {
    await transition?.finished;
  } catch {
    // 过渡被跳过/中断等：吞掉 rejection
  } finally {
    markTransitionSettled();
  }
}

/**
 * 把路由跳转包进 View Transition 的小 composable。
 * 只改变「如何执行跳转」，不改变跳转目标，也不改动任何 store 行为。
 */
export function useViewTransitionNavigation(router: Router) {
  const navigate = (location: RouteLocationRaw, options: { replace?: boolean } = {}) =>
    runNavigation(() => (options.replace ? router.replace(location) : router.push(location)));

  return { navigate };
}
