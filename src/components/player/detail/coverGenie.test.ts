// coverGenie 纯数学单测：恒等/端点、曲线单调与对称、纵向门控、切片行数钳制、bezier 求解。
import { describe, expect, it } from 'vitest';

import {
  GENIE_MAX_SLICES,
  GENIE_MIN_SLICES,
  computeGenieSlices,
  genieEase,
  genieSliceCount,
} from './coverGenie';

describe('genieEase（与 CSS cubic-bezier(0.22,1,0.36,1) 同曲线）', () => {
  it('端点 0→0、1→1', () => {
    expect(genieEase(0)).toBe(0);
    expect(genieEase(1)).toBe(1);
  });

  it('单调不减', () => {
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const value = genieEase(t);
      expect(value).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = value;
    }
  });

  it('ease-out 特征：中点值高于线性', () => {
    expect(genieEase(0.5)).toBeGreaterThan(0.5);
  });
});

describe('computeGenieSlices', () => {
  const N = 16;

  it('t=0 恒等映射', () => {
    const rows = computeGenieSlices(0, N);
    expect(rows).toHaveLength(N);
    rows.forEach((row, i) => {
      expect(row.dstW).toBeCloseTo(1);
      expect(row.dstX).toBeCloseTo(0);
      expect(row.dstH).toBeCloseTo(1 / N);
      expect(row.dstY).toBeCloseTo(i / N);
    });
  });

  it('t=1：顶行收缩为线、底行保持全宽，全部压向底边', () => {
    const rows = computeGenieSlices(1, N);
    expect(rows[0].dstW).toBeCloseTo(0);
    expect(rows[N - 1].dstW).toBeCloseTo(1);
    expect(rows[0].dstY).toBeCloseTo(1);
    expect(rows[N - 1].dstY).toBeCloseTo(1);
    expect(rows[0].dstH).toBeCloseTo(0);
  });

  it('越靠顶收缩越强（单调）且各行关于中心线对称', () => {
    const rows = computeGenieSlices(0.6, N);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].dstW).toBeGreaterThanOrEqual(rows[i - 1].dstW - 1e-9);
    }
    for (const row of rows) {
      expect(row.dstX + row.dstW / 2).toBeCloseTo(0.5);
    }
  });

  it('纵向压缩仅在 t>0.5 后介入', () => {
    const early = computeGenieSlices(0.4, N);
    expect(early[0].dstY).toBeCloseTo(0);
    expect(early[0].dstH).toBeCloseTo(1 / N);
    const late = computeGenieSlices(0.8, N);
    expect(late[0].dstY).toBeGreaterThan(1 / N);
    expect(late[0].dstH).toBeLessThan(1 / N);
  });
});

describe('genieSliceCount', () => {
  it('钳制在 [MIN, MAX]', () => {
    expect(genieSliceCount(4)).toBe(GENIE_MIN_SLICES);
    expect(genieSliceCount(100000)).toBe(GENIE_MAX_SLICES);
    expect(genieSliceCount(480)).toBe(240);
  });
});
