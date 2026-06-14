import { describe, expect, it } from 'vitest';
import { smoothVisualizerLevel } from './audioVisualizerMath';

describe('smoothVisualizerLevel', () => {
  it('moves rising values toward the target without overshooting', () => {
    expect(smoothVisualizerLevel(0.2, 0.8)).toBeCloseTo(0.38, 5);
  });

  it('releases falling values more slowly than rising values', () => {
    expect(smoothVisualizerLevel(0.8, 0.2)).toBeCloseTo(0.71, 5);
  });

  it('clamps the smoothed output between 0 and 1', () => {
    expect(smoothVisualizerLevel(1.2, 2)).toBe(1);
    expect(smoothVisualizerLevel(-0.2, -1)).toBe(0);
  });
});
