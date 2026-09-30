import { describe, expect, it } from 'vitest';

import source from './PlayerDetailVinyl.vue?raw';

describe('vinyl platter rotation', () => {
  it('shares one rotation angle with the cover disc', () => {
    expect(source).toContain('rotationAngle');
    expect(source).toContain(':rotation="rotationAngle"');
    expect(source).toContain('transform: `rotate(${rotationAngle.toFixed(3)}deg)`');
  });

  it('uses the same easing curve for playback and pause', () => {
    expect(source).toContain('rotationSpeed.value += (60 - rotationSpeed.value)');
    expect(source).toContain('rotationSpeed.value *= Math.max(0, 1 - dt * 1.2)');
    expect(source).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')");
  });

  it('switches the outer platter between metal and classic vinyl surfaces', () => {
    expect(source).toContain('platterMaterial === \'vinyl\'');
    expect(source).toContain('turntable-platter--vinyl');
    expect(source).toContain('repeating-radial-gradient');
  });
});
