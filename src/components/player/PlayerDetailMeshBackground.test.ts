import { describe, expect, it } from 'vitest';

import source from './PlayerDetailMeshBackground.vue?raw';

describe('player detail polygon background tone', () => {
  it('keeps the mesh bright enough for foreground content', () => {
    expect(source).toContain('const SATURATION = 0.64;');
    expect(source).toContain('const BRIGHTNESS = 0.98;');
    expect(source).toContain('const lift = 26;');
    expect(source).toContain('color = max(color, vec3(0.075));');
  });

  it('uses restrained seam and vignette darkening', () => {
    expect(source).toContain('const SEAM_DEPTH = 0.035;');
    expect(source).toContain('color *= mix(0.92, 1.01, vignette);');
  });
});
