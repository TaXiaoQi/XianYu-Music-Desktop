const DEFAULT_MIN_VISIBLE_MS = 160;
const DEFAULT_MAX_VISIBLE_MS = 420;
const DEFAULT_REVEAL_DELAY_MS = 120;
const FALLBACK_FRAME_MS = 16;

/** 依次等待两帧渲染提交，保证合成器已呈现稳定画面 */
function waitForStablePaint(): Promise<void> {
    return new Promise((resolve) => {
        const scheduleFrame =
            typeof requestAnimationFrame === "function"
                ? requestAnimationFrame
                : null;
        if (!scheduleFrame) {
            setTimeout(resolve, FALLBACK_FRAME_MS);
            return;
        }

        scheduleFrame(() => scheduleFrame(() => resolve()));
    });
}

/** 以不小于 0 的间隔异步等待指定毫秒 */
const sleepMs = (durationMs: number) =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, Math.max(0, durationMs));
    });

export interface ReleaseStartupCompositionMaskOptions { // 实现
    startedAt: number;
    hide: () => void;
    now?: () => number;
    minVisibleMs?: number;
    maxVisibleMs?: number;
    waitForStablePaint?: () => Promise<unknown>;
}

export interface StartupRevealReadinessOptions { // 实现
    minDelayMs?: number;
    waitForStablePaint?: () => Promise<unknown>;
}

export async function waitForStartupRevealReadiness(
    options: StartupRevealReadinessOptions = {},
) {
    const {
        minDelayMs = DEFAULT_REVEAL_DELAY_MS,
        waitForStablePaint: paintGate = waitForStablePaint,
    } = options;

    await paintGate();
    await sleepMs(minDelayMs);
}

export async function releaseStartupCompositionMask(
    options: ReleaseStartupCompositionMaskOptions,
) {
    const {
        startedAt,
        hide: dismissMask,
        now: readClock = () => performance.now(),
        minVisibleMs = DEFAULT_MIN_VISIBLE_MS,
        maxVisibleMs = DEFAULT_MAX_VISIBLE_MS,
        waitForStablePaint: paintGate = waitForStablePaint,
    } = options;

    await paintGate();

    const elapsedMs = Math.max(0, readClock() - startedAt);
    const remainingFloorMs = Math.max(0, minVisibleMs - elapsedMs);
    const remainingCeilingMs = Math.max(0, maxVisibleMs - elapsedMs);
    const waitMs = Math.min(remainingFloorMs, remainingCeilingMs);

    if (waitMs > 0) {
        await sleepMs(waitMs);
    }

    dismissMask();
}
