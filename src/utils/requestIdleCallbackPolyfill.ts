/**
 * requestIdleCallback / cancelIdleCallback polyfill
 *
 * 项目中多处使用 requestIdleCallback 在空闲时段执行后台任务（封面预加载、
 * 库刷新等）。WebView2 (Chromium) 原生支持此 API，但为防止非标准环境
 * 或旧版 WebView 静默跳过任务，提供 setTimeout 降级实现。
 *
 * 降级行为：立即在事件循环下一轮执行回调，IdleDeadline.timeRemaining() 固定返回 50ms。
 */

interface IdleDeadline {
  didTimeout: boolean;
  timeRemaining(): number;
}

type IdleCallback = (deadline: IdleDeadline) => void;

const FALLBACK_TIME_REMAINING = 50;
const handleMap = new Map<number, ReturnType<typeof setTimeout>>();
let fallbackIdCounter = 0;

if (typeof window !== 'undefined') {
  if (typeof window.requestIdleCallback !== 'function') {
    window.requestIdleCallback = (callback: IdleCallback, _options?: { timeout?: number }) => {
      const id = ++fallbackIdCounter;
      const handle = setTimeout(() => {
        handleMap.delete(id);
        callback({
          didTimeout: false,
          timeRemaining: () => FALLBACK_TIME_REMAINING,
        });
      }, 1);
      handleMap.set(id, handle);
      return id;
    };
  }

  if (typeof window.cancelIdleCallback !== 'function') {
    window.cancelIdleCallback = (id: number) => {
      const handle = handleMap.get(id);
      if (handle !== undefined) {
        clearTimeout(handle);
        handleMap.delete(id);
      }
    };
  }
}

export {};
