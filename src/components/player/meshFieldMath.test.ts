import { describe, expect, it } from 'vitest';

import {
  applyCoverFieldTone,
  boxBlurField,
  buildCoverFieldFromPixels,
  FLUID_FIELD_PRESET,
  POLYGON_FIELD_PRESET,
} from './meshFieldMath';

const pixel = (r: number, g: number, b: number) =>
  new Uint8ClampedArray([r, g, b, 255]);

const clamp255 = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

describe('applyCoverFieldTone', () => {
  it('polygon 预设与历史公式逐位一致：luma + (c - luma) * 0.64 + 26', () => {
    const out = applyCoverFieldTone(pixel(200, 100, 50), POLYGON_FIELD_PRESET);
    const luma = 0.2126 * 200 + 0.7152 * 100 + 0.0722 * 50;
    expect(out[0]).toBe(clamp255(luma + (200 - luma) * 0.64 + 26));
    expect(out[1]).toBe(clamp255(luma + (100 - luma) * 0.64 + 26));
    expect(out[2]).toBe(clamp255(luma + (50 - luma) * 0.64 + 26));
    expect(out[3]).toBe(255);
  });

  it('fluid 预设按 对比度→饱和度→亮度→缩放+抬升 顺序处理', () => {
    const out = applyCoverFieldTone(pixel(200, 100, 50), FLUID_FIELD_PRESET);
    let r = (200 - 128) * 0.52 + 128;
    let g = (100 - 128) * 0.52 + 128;
    let b = (50 - 128) * 0.52 + 128;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = (luma + (r - luma) * 1.7) * 1.12;
    g = (luma + (g - luma) * 1.7) * 1.12;
    b = (luma + (b - luma) * 1.7) * 1.12;
    expect(out[0]).toBe(clamp255(r * 0.8 + 12));
    expect(out[1]).toBe(clamp255(g * 0.8 + 12));
    expect(out[2]).toBe(clamp255(b * 0.8 + 12));
  });

  it('输出夹取在 0-255', () => {
    const bright = applyCoverFieldTone(pixel(255, 255, 255), FLUID_FIELD_PRESET);
    const dark = applyCoverFieldTone(pixel(0, 0, 0), POLYGON_FIELD_PRESET);
    for (const value of [bright[0], bright[1], bright[2], dark[0], dark[1], dark[2]]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(255);
    }
  });
});

describe('boxBlurField', () => {
  const size = 4;

  const impulse = () => {
    const src = new Uint8Array(size * size * 4);
    for (let i = 3; i < src.length; i += 4) src[i] = 255;
    const center = (1 * size + 1) * 4;
    src[center] = 240;
    src[center + 1] = 240;
    src[center + 2] = 240;
    return src;
  };

  it('半径或遍数为 0 时原样返回副本', () => {
    const src = impulse();
    expect(boxBlurField(src, size, 0, 2)).toEqual(src);
    expect(boxBlurField(src, size, 2, 0)).toEqual(src);
  });

  it('脉冲向邻域扩散且 alpha 恒为 255', () => {
    const out = boxBlurField(impulse(), size, 1, 1);
    const neighbor = (1 * size + 2) * 4;
    expect(out[neighbor]).toBeGreaterThan(0);
    expect(out[neighbor]).toBeLessThan(240);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
  });

  it('长度保持不变', () => {
    const src = impulse();
    expect(boxBlurField(src, size, 2, 2).length).toBe(src.length);
  });
});

describe('buildCoverFieldFromPixels', () => {
  it('fluid 预设产出 64×64 RGBA 色场', () => {
    const src = new Uint8ClampedArray(64 * 64 * 4).fill(128);
    const out = buildCoverFieldFromPixels(src, FLUID_FIELD_PRESET);
    expect(out.length).toBe(64 * 64 * 4);
  });

  it('polygon 预设产出 14×14 RGBA 色场', () => {
    const src = new Uint8ClampedArray(14 * 14 * 4).fill(128);
    const out = buildCoverFieldFromPixels(src, POLYGON_FIELD_PRESET);
    expect(out.length).toBe(14 * 14 * 4);
  });
});
