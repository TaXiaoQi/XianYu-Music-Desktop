// 窗口缩放共享调度：把 DOM resize 与 Tauri onResized 等高频事件源合并为
// 「每帧最多一次的跟随派发」+「拖拽静止后一次的 settled 派发」，
// 并在缩放期间切换 document 根类 is-window-resizing 供样式层临时降级毛玻璃。
import { onMounted, onUnmounted, ref, type Ref } from "vue";

/** 事件静默该时长后判定缩放结束（单点调参，建议 120-250ms） */
export const RESIZE_IDLE_MS = 180;

/** 缩放期间挂在 documentElement 上的根类，与 theme-transitioning 同一约定 */
export const WINDOW_RESIZING_CLASS = "is-window-resizing";

export type WindowResizeCoordinatorEnv = {
    /** 注册 window resize 监听，返回取消注册 */
    addWindowResize: (listener: () => void) => () => void;
    /** 挂根类的元素（生产环境为 documentElement），可为空 */
    root: { classList: { toggle: (name: string, on: boolean) => unknown } } | undefined;
    raf: (callback: () => void) => number;
    caf: (handle: number) => void;
    timeout: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clear: (handle: ReturnType<typeof setTimeout>) => void;
};

export type WindowResizeCoordinator = {
    isWindowResizing: Ref<boolean>;
    /** 每帧最多派发一次：供「必须跟随尺寸变化」的视觉量测使用 */
    subscribeWindowResize: (handler: () => void) => () => void;
    /** 拖拽结束后恰好派发一次：供纯最终量测使用，整个拖拽期间完全不执行 */
    subscribeWindowResizeSettled: (handler: () => void) => () => void;
    /** 外部事件源入口（Tauri onResized、单测），汇入同一合并队列 */
    notifyWindowResize: () => void;
    /** 注册全局监听；返回幂等 stop，最后一个持有者停止时清理全部状态 */
    start: () => () => void;
};

const safely = (handler: () => void) => {
    try {
        handler();
    } catch (error) {
        // 单个订阅者抛错不能中断其余订阅者，否则一个组件 bug 会静默拖垮整个布局层
        console.error("[windowResizeCoordinator] handler failed:", error);
    }
};

/**
 * 核心调度工厂：环境依赖全部注入，单测直接实例化并喂 fake，
 * 不需要重置全局状态（沿用 themeTransition.ts 导出纯构造器的做法）。
 */
export function createWindowResizeCoordinator(
    env: WindowResizeCoordinatorEnv,
): WindowResizeCoordinator {
    const isWindowResizing = ref(false);
    const frameHandlers = new Set<() => void>();
    const settledHandlers = new Set<() => void>();

    let queuedFrame: number | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let removeWindowResize: (() => void) | null = null;
    let startRefCount = 0;

    const applyRootClass = (on: boolean) => {
        env.root?.classList.toggle(WINDOW_RESIZING_CLASS, on);
    };

    const flushFrame = () => {
        queuedFrame = null;
        for (const handler of [...frameHandlers]) {
            safely(handler);
        }
    };

    const settle = () => {
        idleTimer = null;
        isWindowResizing.value = false;
        applyRootClass(false);
        // 拖拽结束后仍可能有一帧在途（事件密集时帧派发排在静止之后），
        // 保留它作为最终量测的机会；settled 订阅者负责精确收尾。
        for (const handler of [...settledHandlers]) {
            safely(handler);
        }
    };

    const notifyWindowResize = () => {
        if (!isWindowResizing.value) {
            isWindowResizing.value = true;
            applyRootClass(true);
        }
        if (idleTimer !== null) {
            env.clear(idleTimer);
        }
        idleTimer = env.timeout(settle, RESIZE_IDLE_MS);
        if (queuedFrame === null) {
            queuedFrame = env.raf(flushFrame);
        }
    };

    const makeSubscribe =
        (handlers: Set<() => void>) => (handler: () => void): (() => void) => {
            handlers.add(handler);
            let disposed = false;
            return () => {
                if (disposed) return;
                disposed = true;
                handlers.delete(handler);
            };
        };

    const stopAll = () => {
        removeWindowResize?.();
        removeWindowResize = null;
        if (queuedFrame !== null) {
            env.caf(queuedFrame);
            queuedFrame = null;
        }
        if (idleTimer !== null) {
            env.clear(idleTimer);
            idleTimer = null;
        }
        isWindowResizing.value = false;
        applyRootClass(false);
    };

    const start = (): (() => void) => {
        startRefCount += 1;
        if (!removeWindowResize) {
            removeWindowResize = env.addWindowResize(notifyWindowResize);
        }
        let stopped = false;
        return () => {
            if (stopped) return;
            stopped = true;
            startRefCount -= 1;
            if (startRefCount <= 0) {
                startRefCount = 0;
                stopAll();
            }
        };
    };

    return {
        isWindowResizing,
        subscribeWindowResize: makeSubscribe(frameHandlers),
        subscribeWindowResizeSettled: makeSubscribe(settledHandlers),
        notifyWindowResize,
        start,
    };
}

const browserEnv = (): WindowResizeCoordinatorEnv => ({
    addWindowResize: (listener) => {
        if (typeof window === "undefined") {
            return () => {};
        }
        window.addEventListener("resize", listener);
        return () => window.removeEventListener("resize", listener);
    },
    root:
        typeof document === "undefined"
            ? undefined
            : (document.documentElement as unknown as WindowResizeCoordinatorEnv["root"]),
    raf: (callback) =>
        typeof requestAnimationFrame === "function"
            ? requestAnimationFrame(callback)
            : (setTimeout(callback, 16) as unknown as number),
    caf: (handle) => {
        if (typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(handle);
        } else {
            clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
        }
    },
    timeout: (callback, ms) => setTimeout(callback, ms),
    clear: (handle) => clearTimeout(handle),
});

const defaultEnv = browserEnv();
const sharedCoordinator = createWindowResizeCoordinator(defaultEnv);

export const isWindowResizing = sharedCoordinator.isWindowResizing;
export const subscribeWindowResize = sharedCoordinator.subscribeWindowResize;
export const subscribeWindowResizeSettled =
    sharedCoordinator.subscribeWindowResizeSettled;
export const notifyWindowResize = sharedCoordinator.notifyWindowResize;

/**
 * 把高频回调（ResizeObserver 等）包成「每帧最多执行一次」。
 * 保留观察本身的触发条件，只合并帧内的重复执行；组件内卸载后在途帧
 * 回调依赖原处理器自身的元素存在性检查，行为与逐次触发一致。
 */
export function coalesceWindowResize(handler: () => void): () => void {
    let frame: number | null = null;
    return () => {
        if (frame !== null) return;
        frame = defaultEnv.raf(() => {
            frame = null;
            safely(handler);
        });
    };
}

/** 主 shell 生命周期入口：挂载时注册全局监听，卸载时清理 */
export function useWindowResizeCoordinator() {
    onMounted(() => {
        const stop = sharedCoordinator.start();
        onUnmounted(stop);
    });
    return { isWindowResizing };
}
