// coverGenie 纯数学单测（屏幕空间版）：rect 插值、锚点判定、切片恒等/收敛/对称、
// object-cover 裁切、bezier 缓动、切片行数钳制。
import { describe, expect, it } from 'vitest';

import {
  GENIE_MAX_SLICES,
  GENIE_MIN_SLICES,
  computeGenieRectSlices,
  genieAnchorBottom,
  genieEase,
  genieRectAt,
  genieSliceCount,
  genieSourceCrop,
} from './coverGenie';

const FROM = { x: 100, y: 100, w: 400, h: 400 };
const TO_UP = { x: 20, y: 20, w: 60, h: 60 };
const TO_DOWN = { x: 380, y: 800, w: 60, h: 60 };

describe('genieEase（与容器 CSS cubic-bezier(0.22,1,0.36,1) 同曲线）', () => {
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

describe('genieRectAt', () => {
  it('t=0 恒等 from、t=1 恒等 to，越界钳制', () => {
    expect(genieRectAt(0, FROM, TO_UP)).toEqual(FROM);
    expect(genieRectAt(1, FROM, TO_UP)).toEqual(TO_UP);
    expect(genieRectAt(-1, FROM, TO_UP)).toEqual(FROM);
    expect(genieRectAt(2, FROM, TO_UP)).toEqual(TO_UP);
  });

  it('中点为四边线性插值', () => {
    const mid = genieRectAt(0.5, FROM, TO_UP);
    expect(mid.x).toBeCloseTo(60);
    expect(mid.y).toBeCloseTo(60);
    expect(mid.w).toBeCloseTo(230);
    expect(mid.h).toBeCloseTo(230);
  });
});

describe('genieAnchorBottom', () => {
  it('目标在上方→锚顶边；目标在下方→锚底边', () => {
    expect(genieAnchorBottom(TO_UP, FROM)).toBe(false);
    expect(genieAnchorBottom(TO_DOWN, FROM)).toBe(true);
  });
});

describe('computeGenieRectSlices', () => {
  const N = 16;

  it('t=0 精确铺满 from（恒等交接给原生 img）', () => {
    const rows = computeGenieRectSlices(0, N, FROM, TO_UP);
    expect(rows).toHaveLength(N);
    rows.forEach((row, i) => {
      expect(row.w).toBeCloseTo(FROM.w);
      expect(row.x).toBeCloseTo(FROM.x);
      expect(row.y).toBeCloseTo(FROM.y + (FROM.h * i) / N);
      expect(row.h).toBeCloseTo(FROM.h / N);
    });
  });

  it('t=1 收敛进 dock rect：锚点行保宽、远端行缩为线', () => {
    const rows = computeGenieRectSlices(1, N, FROM, TO_UP);
    expect(rows[0].w).toBeCloseTo(TO_UP.w);
    expect(rows[0].x).toBeCloseTo(TO_UP.x);
    expect(rows[N - 1].w).toBeCloseTo(0);
    for (const row of rows) {
      expect(row.y).toBeGreaterThanOrEqual(TO_UP.y - 1e-9);
      expect(row.y + row.h).toBeLessThanOrEqual(TO_UP.y + TO_UP.h + 1e-9);
    }
  });

  it('底锚时越靠顶（远端）行越窄', () => {
    const rows = computeGenieRectSlices(1, N, FROM, TO_DOWN);
    expect(rows[0].w).toBeCloseTo(0);
    expect(rows[N - 1].w).toBeCloseTo(TO_DOWN.w);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].w).toBeGreaterThanOrEqual(rows[i - 1].w - 1e-9);
    }
  });

  it('任意时刻各行关于插值矩形中线对称', () => {
    const rect = genieRectAt(0.6, FROM, TO_UP);
    const rows = computeGenieRectSlices(0.6, N, FROM, TO_UP);
    for (const row of rows) {
      expect(row.x + row.w / 2).toBeCloseTo(rect.x + rect.w / 2);
    }
  });
});

describe('genieSourceCrop', () => {
  it('方图进方框 = 全幅取景', () => {
    expect(genieSourceCrop(1000, 1000, 500, 500)).toEqual({
      sx: 0,
      sy: 0,
      sw: 1,
      sh: 1,
    });
  });

  it('横图进方框 = 水平居中裁切', () => {
    const crop = genieSourceCrop(2000, 1000, 500, 500);
    expect(crop.sw).toBeCloseTo(0.5);
    expect(crop.sx).toBeCloseTo(0.25);
    expect(crop.sh).toBeCloseTo(1);
    expect(crop.sy).toBeCloseTo(0);
  });

  it('退化尺寸回退全幅', () => {
    expect(genieSourceCrop(0, 100, 500, 500)).toEqual({ sx: 0, sy: 0, sw: 1, sh: 1 });
  });
});

describe('genieSliceCount', () => {
  it('钳制在 [MIN, MAX]', () => {
    expect(genieSliceCount(4)).toBe(GENIE_MIN_SLICES);
    expect(genieSliceCount(100000)).toBe(GENIE_MAX_SLICES);
    expect(genieSliceCount(480)).toBe(240);
  });
});
