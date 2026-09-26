import { describe, expect, it } from 'vitest';

import { formatRemaining, shouldFireIdle } from './idle';

describe('sleep timer idle decision', () => {
  const base = { lastActivityMs: 0, nowMs: 0, idleMinutes: 30, isPlaying: true };

  it('fires exactly when the idle threshold is reached', () => {
    expect(shouldFireIdle({ ...base, nowMs: 30 * 60_000 })).toBe(true);
    expect(shouldFireIdle({ ...base, nowMs: 30 * 60_000 - 1 })).toBe(false);
  });

  it('does not fire while playback is paused', () => {
    expect(shouldFireIdle({ ...base, nowMs: 60 * 60_000, isPlaying: false })).toBe(false);
  });

  it('ignores a non-positive threshold, a missing threshold and a clock going backwards', () => {
    expect(shouldFireIdle({ ...base, nowMs: 60 * 60_000, idleMinutes: 0 })).toBe(false);
    expect(shouldFireIdle({ ...base, nowMs: 60 * 60_000, idleMinutes: Number.NaN })).toBe(false);
    expect(shouldFireIdle({ ...base, nowMs: -1 })).toBe(false);
  });

  it('counts idle time from the last activity', () => {
    const lastActivityMs = 10 * 60_000;
    expect(shouldFireIdle({ ...base, lastActivityMs, nowMs: lastActivityMs + 29 * 60_000 })).toBe(false);
    expect(shouldFireIdle({ ...base, lastActivityMs, nowMs: lastActivityMs + 30 * 60_000 })).toBe(true);
  });
});

describe('sleep timer remaining formatting', () => {
  it('formats mm:ss and h:mm:ss', () => {
    expect(formatRemaining(0)).toBe('00:00');
    expect(formatRemaining(59)).toBe('00:59');
    expect(formatRemaining(90)).toBe('01:30');
    expect(formatRemaining(3 * 3600 + 5 * 60 + 9)).toBe('3:05:09');
  });

  it('clamps nonsense input to zero', () => {
    expect(formatRemaining(-5)).toBe('00:00');
    expect(formatRemaining(Number.NaN)).toBe('00:00');
    expect(formatRemaining(59.8)).toBe('00:59');
  });
});
