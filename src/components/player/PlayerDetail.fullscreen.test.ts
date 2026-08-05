import { describe, expect, it } from 'vitest';

import playerDetailSource from './PlayerDetail.vue?raw';

describe('player detail immersive fullscreen', () => {
  it('uses native window fullscreen and keeps the Windows taskbar compatibility flag', () => {
    expect(playerDetailSource).toContain('await appWindow.setFullscreen(enter)');
    expect(playerDetailSource).toContain("tauriInvoke('set_taskbar_fullscreen_flag', { enter })");
    expect(playerDetailSource).not.toContain("tauriInvoke('set_immersive_fullscreen', { enter })");
  });

  it('allows Escape to leave fullscreen', () => {
    expect(playerDetailSource).toContain("if (e.key !== 'Escape') return");
    expect(playerDetailSource).toContain('if (isFullscreen.value)');
    expect(playerDetailSource).toContain('void toggleFullscreen()');
  });
});
