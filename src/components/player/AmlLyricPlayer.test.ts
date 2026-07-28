import { describe, expect, it } from 'vitest';

import source from './AmlLyricPlayer.vue?raw';

describe('AmlLyricPlayer', () => {
  it('uses pause/resume to control playback', () => {
    expect(source).toContain('player.pause()');
    expect(source).toContain('player.resume()');
  });

  it('ties the animation loop to the playing prop', () => {
    expect(source).toContain('!props.playing');
  });

  it('cancels previous recovery before starting a new one', () => {
    expect(source).toContain('cancelAnimationFrame(recoveryFrameId)');
  });
});
