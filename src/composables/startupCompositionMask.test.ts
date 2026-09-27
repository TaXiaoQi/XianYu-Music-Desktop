import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { releaseStartupCompositionMask, waitForStartupRevealReadiness } from './startupCompositionMask';

// 遮罩时长参数（毫秒）：这些数值属于行为规格，保持不变
const MIN_VISIBLE_MS = 160;
const MAX_VISIBLE_MS = 420;

/** 推进假时钟的简写 */
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

/** 组装 releaseStartupCompositionMask 的注入参数 */
const buildReleaseOptions = (overrides: {
  startedAt: number;
  now: () => number;
  hide: ReturnType<typeof vi.fn>;
}) => ({
  startedAt: overrides.startedAt,
  now: overrides.now,
  minVisibleMs: MIN_VISIBLE_MS,
  maxVisibleMs: MAX_VISIBLE_MS,
  waitForStablePaint: async (): Promise<void> => undefined,
  hide: overrides.hide,
});

describe('startup composition mask：启动遮罩释放时机', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('稳定绘制完成后仍需满足最小可见时长才隐藏遮罩', async () => {
    const hideMask = vi.fn();
    const releaseMask = releaseStartupCompositionMask(buildReleaseOptions({ startedAt: 100, now: () => 180, hide: hideMask }));

    await tick(79);
    expect(hideMask).not.toHaveBeenCalled();

    await tick(1);
    await releaseMask;

    expect(hideMask).toHaveBeenCalledOnce();
  });

  it('遮罩显示已超过最大时长时立即隐藏，不再等待', async () => {
    const hideMask = vi.fn();
    const releaseMask = releaseStartupCompositionMask(buildReleaseOptions({ startedAt: 100, now: () => 600, hide: hideMask }));

    await tick(0);
    await releaseMask;

    expect(hideMask).toHaveBeenCalledOnce();
  });

  it('启动揭示需同时等待稳定绘制与最小延迟完成', async () => {
    const stablePaintProbe = vi.fn(async (): Promise<void> => undefined);
    const revealReadiness = waitForStartupRevealReadiness({ minDelayMs: 120, waitForStablePaint: stablePaintProbe });

    await tick(119);
    let hasSettled = false;
    void revealReadiness.then(() => { hasSettled = true; });
    await tick(0);
    expect(hasSettled).toBe(false);

    await tick(1);
    await revealReadiness;

    expect(stablePaintProbe).toHaveBeenCalledOnce();
  });
});
