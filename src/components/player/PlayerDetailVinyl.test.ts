import { describe, it } from 'vitest';

import { expectSourceContains } from '../../testing/sourceText';
import source from './PlayerDetailVinyl.vue?raw';

describe('vinyl platter rotation', () => {
  it('shares one rotation angle with the cover disc', () => {
    expectSourceContains(source, 'rotationAngle');
    expectSourceContains(source, ':rotation="rotationAngle"');
    expectSourceContains(source, 'transform: `rotate(${rotationAngle.toFixed(3)}deg)`');
  });

  it('uses the same easing curve for playback and pause', () => {
    expectSourceContains(source, 'rotationSpeed.value += (60 - rotationSpeed.value)');
    expectSourceContains(source, 'rotationSpeed.value *= Math.max(0, 1 - dt * 1.2)');
    expectSourceContains(source, "window.matchMedia('(prefers-reduced-motion: reduce)')");
  });

  it('switches the outer platter between metal and classic vinyl surfaces', () => {
    expectSourceContains(source, "platterMaterial === 'vinyl'");
    expectSourceContains(source, 'turntable-platter--vinyl');
    expectSourceContains(source, 'repeating-radial-gradient');
  });
});
