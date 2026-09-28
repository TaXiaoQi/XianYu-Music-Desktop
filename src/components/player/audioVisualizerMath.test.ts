import { describe, expect, it } from 'vitest';
import { smoothVisualizerLevel } from './audioVisualizerMath';

describe('audioVisualizerMath', () => {
  it.each([
    { previous: 0.2, target: 0.8, expected: 0.38 },
    { previous: 0.8, target: 0.2, expected: 0.71 },
  ])('eases a level of $previous toward $target at the matching attack or release rate', ({ previous, target, expected }) => {
    expect(smoothVisualizerLevel(previous, target)).toBeCloseTo(expected, 5);
  });

  it('confines the smoothed level to the unit interval', () => {
    expect(smoothVisualizerLevel(1.2, 2)).toBe(1); expect(smoothVisualizerLevel(-0.2, -1)).toBe(0);
  });
});
