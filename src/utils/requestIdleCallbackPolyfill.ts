
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
