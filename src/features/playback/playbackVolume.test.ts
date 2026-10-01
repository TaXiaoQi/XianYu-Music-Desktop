import { describe, expect, it, vi } from 'vitest';
import { createPlaybackVolumeController } from './playbackVolume';

describe('playback volume controller', () => {
  it('fades to the target volume and applies the final value', async () => {
    const setBackendVolume = vi.fn().mockResolvedValue(undefined);
    const frames: Array<(time: number) => void> = [];
    const controller = createPlaybackVolumeController({
      setBackendVolume,
      setManagedTimeout: () => 1 as ReturnType<typeof setTimeout>,
      clearManagedTimeout: vi.fn(),
      requestFrame: callback => {
        frames.push(callback);
        return frames.length;
      },
      cancelFrame: vi.fn(),
    });

    const fade = controller.fadeTo(0, 100, 1);
    const startTime = performance.now();
    frames.shift()?.(startTime);
    frames.shift()?.(startTime + 100);
    await fade;

    expect(controller.getCurrentVolume()).toBe(0);
    expect(setBackendVolume).toHaveBeenLastCalledWith(0);
  });

  it('restores volume only when the scheduled token remains current', () => {
    const setBackendVolume = vi.fn().mockResolvedValue(undefined);
    const timers: Array<() => void> = [];
    const controller = createPlaybackVolumeController({
      setBackendVolume,
      setManagedTimeout: callback => {
        timers.push(callback);
        return timers.length as ReturnType<typeof setTimeout>;
      },
      clearManagedTimeout: vi.fn(),
    });

    controller.scheduleBackendRestore(0.7);
    controller.scheduleBackendRestore(0.4);
    timers[0]?.();
    expect(setBackendVolume).not.toHaveBeenCalled();
    timers[1]?.();
    expect(setBackendVolume).toHaveBeenLastCalledWith(0.4);
  });
});
