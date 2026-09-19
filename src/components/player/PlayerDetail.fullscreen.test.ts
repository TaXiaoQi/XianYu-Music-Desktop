import { describe, expect, it } from 'vitest';

import playerDetailSource from './PlayerDetail.vue?raw';

describe('player detail immersive fullscreen', () => {
  it('uses custom immersive fullscreen command for smooth maximize-to-fullscreen transition', () => {
    expect(playerDetailSource).toContain("windowApi.setImmersiveFullscreen(enter)");
    expect(playerDetailSource).not.toContain('await appWindow.setFullscreen(enter)');
  });

  it('uses smart_toggle_maximize for maximize/restore after fullscreen', () => {
    expect(playerDetailSource).toContain("windowApi.smartToggleMaximize()");
    expect(playerDetailSource).not.toContain('appWindow.isMaximized()');
    expect(playerDetailSource).not.toContain('appWindow.unmaximize()');
  });

  it('allows Escape to leave fullscreen', () => {
    expect(playerDetailSource).toContain("if (e.key !== 'Escape') return");
    expect(playerDetailSource).toContain('if (isFullscreen.value)');
    expect(playerDetailSource).toContain('void toggleFullscreen()');
  });
});
