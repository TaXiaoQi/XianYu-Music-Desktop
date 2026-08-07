import { describe, expect, it } from 'vitest';

import playerDetailSource from './PlayerDetail.vue?raw';

describe('player detail immersive fullscreen', () => {
  it('uses custom immersive fullscreen command for smooth maximize-to-fullscreen transition', () => {
    // 使用自定义 Rust 命令 set_immersive_fullscreen，在最大化状态下直接清除
    // WS_MAXIMIZE 样式位并铺满整屏，无需先 unmaximize 再 setFullscreen，
    // 避免"先缩小再放大"的视觉跳变。
    expect(playerDetailSource).toContain("tauriInvoke('set_immersive_fullscreen', { enter })");
    expect(playerDetailSource).not.toContain('await appWindow.setFullscreen(enter)');
  });

  it('allows Escape to leave fullscreen', () => {
    expect(playerDetailSource).toContain("if (e.key !== 'Escape') return");
    expect(playerDetailSource).toContain('if (isFullscreen.value)');
    expect(playerDetailSource).toContain('void toggleFullscreen()');
  });
});
