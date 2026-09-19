import { describe, expect, it } from 'vitest';

import {
  computeEnvelope,
  estimateEnvelopeLag,
  isTrustworthyEstimate,
  zNormalize,
} from './mvAutoSync';

const HOP_SEC = 512 / 8000;

function makePulseEnvelope(pulsePositions: number[], length: number, seed = 1): Float32Array {
  const envelope = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    let value = 0.03 * Math.sin(i * 0.37 * seed);
    for (const position of pulsePositions) {
      const d = i - position;
      value += Math.exp(-(d * d) / (2 * 2.2 * 2.2));
    }
    envelope[i] = value;
  }
  return envelope;
}

function shiftEnvelope(source: Float32Array, lagFrames: number): Float32Array {
  const result = new Float32Array(source.length + Math.abs(lagFrames));
  if (lagFrames >= 0) {
    result.set(source, lagFrames);
  } else {
    result.set(source.subarray(-lagFrames), 0);
  }
  return result;
}

describe('mvAutoSync computeEnvelope', () => {
  it('静音输入产出全 0 包络', () => {
    const envelope = computeEnvelope(new Float32Array(4096));
    expect(envelope.length).toBeGreaterThan(0);
    expect(Array.from(envelope).every(value => value === 0)).toBe(true);
  });

  it('恒定幅度输入产出恒定 RMS', () => {
    const samples = new Float32Array(8192).fill(0.5);
    const envelope = computeEnvelope(samples);
    expect(envelope.length).toBeGreaterThan(1);
    for (const value of envelope) {
      expect(value).toBeCloseTo(0.5, 5);
    }
  });
});

describe('mvAutoSync zNormalize', () => {
  it('归一化后均值 0、标准差 1', () => {
    const input = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const normalized = zNormalize(input);
    const mean = normalized.reduce((sum, v) => sum + v, 0) / normalized.length;
    const variance = normalized.reduce((sum, v) => sum + v * v, 0) / normalized.length;
    expect(mean).toBeCloseTo(0, 6);
    expect(Math.sqrt(variance)).toBeCloseTo(1, 6);
  });

  it('全 0 输入（静音）保持全 0，不产生 NaN', () => {
    const normalized = zNormalize(new Float32Array(16));
    expect(Array.from(normalized).every(value => Number.isFinite(value) && value === 0)).toBe(true);
  });
});

describe('mvAutoSync estimateEnvelopeLag', () => {
  const pulses = [30, 90, 150, 210, 270, 330, 390, 450];
  const song = makePulseEnvelope(pulses, 600);

  it('恢复 MV 片头导致的正向偏移（画面滞后需提前）', () => {
    const lagSec = 2.0;
    const mv = shiftEnvelope(song, Math.round(lagSec / HOP_SEC));
    const estimate = estimateEnvelopeLag(mv, song);
    expect(estimate).not.toBeNull();
    expect(estimate!.offsetSec).toBeGreaterThan(lagSec - 0.15);
    expect(estimate!.offsetSec).toBeLessThan(lagSec + 0.15);
    expect(estimate!.confidence).toBeGreaterThan(0.8);
  });

  it('恢复负向偏移（MV 内容先于歌曲）', () => {
    const lagSec = -1.5;
    const mv = shiftEnvelope(song, Math.round(lagSec / HOP_SEC));
    const estimate = estimateEnvelopeLag(mv, song);
    expect(estimate).not.toBeNull();
    expect(estimate!.offsetSec).toBeGreaterThan(lagSec - 0.15);
    expect(estimate!.offsetSec).toBeLessThan(lagSec + 0.15);
  });

  it('零偏移时给出接近 0 的估计', () => {
    const estimate = estimateEnvelopeLag(song, song);
    expect(estimate).not.toBeNull();
    expect(Math.abs(estimate!.offsetSec)).toBeLessThan(0.15);
  });

  it('不相关内容置信度不足，被可信度门槛拒绝', () => {
    const unrelated = new Float32Array(600);
    let state = 42;
    for (let i = 0; i < unrelated.length; i += 1) {
      state = (state + 0x6d2b79f5) | 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      unrelated[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    const estimate = estimateEnvelopeLag(unrelated, song);
    expect(estimate).not.toBeNull();
    expect(estimate!.confidence).toBeLessThan(0.2);
    expect(isTrustworthyEstimate(estimate)).toBe(false);
  });

  it('偏移触及搜索边界时拒绝（真实错位可能超出范围）', () => {
    const mv = shiftEnvelope(song, Math.round(15 / HOP_SEC));
    const estimate = estimateEnvelopeLag(mv, song);
    expect(isTrustworthyEstimate(estimate)).toBe(false);
  });

  it('过短输入返回 null', () => {
    expect(estimateEnvelopeLag(new Float32Array(2), new Float32Array(2))).toBeNull();
  });
});
