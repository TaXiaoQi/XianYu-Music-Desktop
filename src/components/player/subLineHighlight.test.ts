import { describe, expect, it } from 'vitest';

import { resolveSubLineProgressValue } from './subLineHighlight';

const line = (
  startTime: number,
  endTime: number,
  words?: Array<{ startTime?: number; endTime?: number; word?: string }>,
) => ({ startTime, endTime, words });

describe('sub-line highlight progress', () => {
  it('stays at 0 before the line and reaches 100% at its end', () => {
    expect(resolveSubLineProgressValue(1_000, line(2_000, 4_000))).toBe('0.00%');
    expect(resolveSubLineProgressValue(3_000, line(2_000, 4_000))).toBe('50.00%');
    expect(resolveSubLineProgressValue(5_000, line(2_000, 4_000))).toBe('100.00%');
  });

  it('follows the word span so it tracks the word-by-word highlight', () => {
    const timed = line(2_000, 6_000, [
      { startTime: 2_500, endTime: 3_000 },
      { startTime: 3_500, endTime: 4_000 },
    ]);
    expect(resolveSubLineProgressValue(2_000, timed)).toBe('0.00%');
    expect(resolveSubLineProgressValue(3_250, timed)).toBe('50.00%');
    expect(resolveSubLineProgressValue(4_000, timed)).toBe('100.00%');
  });

  it('weights words by their length so the sweep follows the word rhythm', () => {
    const timed = line(0, 4_000, [
      { startTime: 0, endTime: 1_000, word: 'a' },
      { startTime: 1_000, endTime: 4_000, word: 'abcdefghi' },
    ]);
    // 第一个词唱完时只应扫过 1/10，而不是时间上的 1/4
    expect(resolveSubLineProgressValue(1_000, timed)).toBe('10.00%');
    // 长词唱到一半：1 + 9 × 0.5 = 5.5
    expect(resolveSubLineProgressValue(2_500, timed)).toBe('55.00%');
    expect(resolveSubLineProgressValue(4_000, timed)).toBe('100.00%');
  });

  it('holds the sweep steady while the main line rests between words', () => {
    const timed = line(0, 4_000, [
      { startTime: 0, endTime: 1_000, word: 'ab' },
      { startTime: 3_000, endTime: 4_000, word: 'cd' },
    ]);
    expect(resolveSubLineProgressValue(1_500, timed)).toBe('50.00%');
    expect(resolveSubLineProgressValue(2_900, timed)).toBe('50.00%');
    expect(resolveSubLineProgressValue(4_000, timed)).toBe('100.00%');
  });

  it('ignores words without finite timings and falls back to the line range', () => {
    const partial = line(2_000, 4_000, [{ startTime: Number.NaN, endTime: 3_000 }]);
    expect(resolveSubLineProgressValue(3_000, partial)).toBe('50.00%');
  });

  it('resolves degenerate line timing to 0 or 1', () => {
    expect(resolveSubLineProgressValue(2_000, line(3_000, 3_000))).toBe('0.00%');
    expect(resolveSubLineProgressValue(3_000, line(3_000, 3_000))).toBe('100.00%');
  });
});
