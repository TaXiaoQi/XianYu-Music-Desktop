import { describe, it } from 'vitest';

import { expectSourceContains } from '../../testing/sourceText';
import source from './PlayerDetailMeshBackground.vue?raw';

describe('player detail polygon background tone', () => {
  it('keeps the mesh bright enough for foreground content', () => {
    expectSourceContains(source, 'const SATURATION = 0.64;');
    expectSourceContains(source, 'const BRIGHTNESS = 0.98;');
    expectSourceContains(source, 'const lift = 26;');
    expectSourceContains(source, 'color = max(color, vec3(0.075));');
  });

  it('uses restrained seam and vignette darkening', () => {
    expectSourceContains(source, 'const SEAM_DEPTH = 0.035;');
    expectSourceContains(source, 'color *= mix(0.92, 1.01, vignette);');
  });
});
