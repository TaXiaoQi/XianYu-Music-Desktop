import { describe, expect, it } from 'vitest';

import playerDetailSource from './PlayerDetail.vue?raw';

describe('player detail immersive fullscreen', () => {
  it('uses custom immersive fullscreen command for smooth maximize-to-fullscreen transition', () => {
    // 使用自定义 Rust 命令 set_immersive_fullscreen，在最大化状态下直接清除
    // WS_MAXIMIZE 样式位并铺满整屏，无需先 unmaximize 再 setFullscreen，
    // 避免"先缩小再放大"的视觉跳变。
    expect(playerDetailSource).toContain("windowApi.setImmersiveFullscreen(enter)");
    expect(playerDetailSource).not.toContain('await appWindow.setFullscreen(enter)');
  });

  it('uses smart_toggle_maximize for maximize/restore after fullscreen', () => {
    // 退出全屏后 tao 内部还原尺寸缓存被全屏矩形污染，appWindow.isMaximized() 和
    // appWindow.unmaximize() 不可靠。改用 smart_toggle_maximize 命令：
    // - 用 Win32 IsZoomed 判断窗口状态（不依赖 tao 内部缓存）
    // - 用 SAVED_NORMAL_RECT + SetWindowPlacement 一步恢复正确小窗尺寸
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
