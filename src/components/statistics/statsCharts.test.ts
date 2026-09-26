import { describe, expect, it } from 'vitest';

import {
  barHeights,
  computePeakIndex,
  normalizeBars,
  recentDayOfMonth,
  ringSegments,
  sharePercentages,
} from './statsCharts';

describe('normalizeBars', () => {
  it('returns all zeros for an all-zero input', () => {
    expect(normalizeBars([0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
  });

  it('returns an empty array for an empty input', () => {
    expect(normalizeBars([])).toEqual([]);
  });

  it('scales a single non-zero spike to 1 with the rest at 0', () => {
    expect(normalizeBars([0, 0, 12, 0, 0, 0, 0])).toEqual([0, 0, 1, 0, 0, 0, 0]);
  });

  it('normalises relative heights against the maximum', () => {
    expect(normalizeBars([50, 100, 25])).toEqual([0.5, 1, 0.25]);
  });

  it('defensively treats negatives, NaN and Infinity as zero', () => {
    expect(normalizeBars([-4, Number.NaN, Number.POSITIVE_INFINITY, 8])).toEqual([0, 0, 0, 1]);
    expect(normalizeBars([-1, -2, -3])).toEqual([0, 0, 0]);
  });
});

describe('barHeights', () => {
  it('scales heights into the target coordinate system', () => {
    expect(barHeights([10, 5], 100)).toEqual([100, 50]);
  });

  it('lifts tiny non-zero values up to the minimum visible height', () => {
    expect(barHeights([1000, 1], 100, 3)).toEqual([100, 3]);
  });

  it('keeps zero values at zero regardless of the minimum', () => {
    expect(barHeights([10, 0], 100, 3)).toEqual([100, 0]);
  });

  it('returns zeros for an all-zero input', () => {
    expect(barHeights([0, 0], 100, 3)).toEqual([0, 0]);
  });
});

describe('computePeakIndex', () => {
  it('returns the index of the largest value', () => {
    expect(computePeakIndex([1, 9, 4, 2])).toBe(1);
  });

  it('returns the first index on a tie', () => {
    expect(computePeakIndex([5, 5, 1])).toBe(0);
    expect(computePeakIndex([1, 7, 7, 2])).toBe(1);
  });

  it('returns -1 when there is no positive value', () => {
    expect(computePeakIndex([0, 0, 0])).toBe(-1);
    expect(computePeakIndex([])).toBe(-1);
  });

  it('ignores negative and NaN entries', () => {
    expect(computePeakIndex([Number.NaN, -5, 3])).toBe(2);
    expect(computePeakIndex([-1, -2])).toBe(-1);
  });
});

describe('sharePercentages', () => {
  it('produces shares that sum to 100', () => {
    const shares = sharePercentages([1, 1, 2]);
    expect(shares[0]).toBeCloseTo(25);
    expect(shares[1]).toBeCloseTo(25);
    expect(shares[2]).toBeCloseTo(50);
    expect(shares.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100);
  });

  it('uses an explicit total as the denominator', () => {
    // 曲库：10 无损 / 5 高解析 / 85 其它，合计 100 首
    const shares = sharePercentages([10, 5, 85], 100);
    expect(shares).toEqual([10, 5, 85]);
  });

  it('returns all zeros when everything (and the total) is zero', () => {
    expect(sharePercentages([0, 0, 0])).toEqual([0, 0, 0]);
    expect(sharePercentages([0, 0, 0], 0)).toEqual([0, 0, 0]);
  });

  it('defensively ignores negative and NaN values', () => {
    expect(sharePercentages([-1, Number.NaN, 4])).toEqual([0, 0, 100]);
  });
});

describe('ringSegments', () => {
  it('splits the circumference proportionally and chains the offsets', () => {
    const segments = ringSegments([1, 1, 2], 10);
    const circumference = 2 * Math.PI * 10;
    const totalDash = segments.reduce((sum, segment) => sum + segment.dash, 0);

    expect(totalDash).toBeCloseTo(circumference);
    expect(segments[0].dash).toBeCloseTo(circumference * 0.25);
    expect(segments[2].dash).toBeCloseTo(circumference * 0.5);
    expect(segments[0].offset).toBeCloseTo(0);
    expect(segments[1].offset).toBeCloseTo(-circumference * 0.25);
    expect(segments[2].offset).toBeCloseTo(-circumference * 0.5);
  });

  it('returns zero-length segments for an all-zero input', () => {
    expect(ringSegments([0, 0, 0], 10)).toEqual([
      { percent: 0, dash: 0, offset: 0 },
      { percent: 0, dash: 0, offset: 0 },
      { percent: 0, dash: 0, offset: 0 },
    ]);
  });

  it('returns zero-length segments when the radius is invalid', () => {
    expect(ringSegments([1, 1], 0)).toEqual([
      { percent: 0, dash: 0, offset: 0 },
      { percent: 0, dash: 0, offset: 0 },
    ]);
  });
});

describe('recentDayOfMonth', () => {
  it('returns weekday-agnostic day numbers ending on today', () => {
    // 2026-03-01 往前 7 天：2/23..3/1，跨月边界
    const labels = recentDayOfMonth(7, new Date(2026, 2, 1));
    expect(labels).toEqual([23, 24, 25, 26, 27, 28, 1]);
  });

  it('returns an empty array for a non-positive or invalid count', () => {
    expect(recentDayOfMonth(0)).toEqual([]);
    expect(recentDayOfMonth(-3)).toEqual([]);
  });
});
