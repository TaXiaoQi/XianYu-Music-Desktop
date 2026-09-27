import { describe, expect, it, vi } from 'vitest';

import { getPlaybackSeekSecondsForLyricLine, syncWordLyricSeekLayout } from './seekLayout';

describe('syncWordLyricSeekLayout', () => {
  it('resets manual scroll and applies the seek layout synchronously', () => {
    const calls: string[] = [];
    const player = {
      resetScroll: vi.fn(() => calls.push('resetScroll')),
      suspendScrollForSeek: vi.fn(() => calls.push('suspendScrollForSeek')),
      setCurrentTime: vi.fn((_time: number, _isSeek?: boolean) => calls.push('setCurrentTime')),
      alignScrollToSeekTarget: vi.fn((_lineIndex?: number) => calls.push('alignScrollToSeekTarget')),
      calcLayout: vi.fn((_sync?: boolean) => {
        calls.push('calcLayout');
        return Promise.resolve();
      }),
      update: vi.fn((_delta?: number) => calls.push('update')),
    };

    syncWordLyricSeekLayout(player, 12345.9, 7);

    expect(player.suspendScrollForSeek).toHaveBeenCalledOnce();
    expect(player.resetScroll).toHaveBeenCalledOnce();
    expect(player.setCurrentTime).toHaveBeenCalledWith(12345, true);
    expect(player.alignScrollToSeekTarget).toHaveBeenCalledWith(7);
    expect(player.calcLayout).toHaveBeenCalledWith(true);
    expect(player.update).toHaveBeenCalledWith(0);
    expect(calls).toEqual([
      'suspendScrollForSeek',
      'resetScroll',
      'setCurrentTime',
      'alignScrollToSeekTarget',
      'calcLayout',
      'update',
    ]);
  });

  it('still works when the renderer has no optional scroll hooks', () => {
    const setCurrentTime = vi.fn();
    syncWordLyricSeekLayout({
      resetScroll: vi.fn(),
      setCurrentTime,
      calcLayout: vi.fn(),
      update: vi.fn(),
    }, -50);

    expect(setCurrentTime).toHaveBeenCalledWith(0, true);
  });
});

describe('getPlaybackSeekSecondsForLyricLine', () => {
  it('adds lyrics audio delay to the clicked line time', () => {
    expect(getPlaybackSeekSecondsForLyricLine(12345, 0.25)).toBe(12.595);
  });

  it('clamps negative seek targets to zero', () => {
    expect(getPlaybackSeekSecondsForLyricLine(100, -1)).toBe(0);
  });
});
