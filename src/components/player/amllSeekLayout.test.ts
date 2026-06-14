import { describe, expect, it, vi } from 'vitest';

import { getPlaybackSeekSecondsForAmlLine, syncAmlLyricSeekLayout } from './amllSeekLayout';

describe('syncAmlLyricSeekLayout', () => {
  it('resets manual scroll and seeks AMLL layout synchronously', () => {
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

    syncAmlLyricSeekLayout(player, 12345.9, 7);

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
});

describe('getPlaybackSeekSecondsForAmlLine', () => {
  it('adds lyrics audio delay to the clicked AMLL line time', () => {
    expect(getPlaybackSeekSecondsForAmlLine(12345, 0.25)).toBe(12.595);
  });

  it('clamps negative seek targets to zero', () => {
    expect(getPlaybackSeekSecondsForAmlLine(100, -1)).toBe(0);
  });
});
