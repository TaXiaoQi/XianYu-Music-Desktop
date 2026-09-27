import { describe, expect, it, vi } from 'vitest';

import { shouldAutoHideDesktopLyrics } from './useDesktopLyricsWindowController';

vi.mock('@tauri-apps/api/event', () => {
  return {
    emitTo: vi.fn(),
  };
});

vi.mock('@tauri-apps/api/window', () => {
  return {
    getCurrentWindow: vi.fn(),
  };
});

vi.mock('./lyrics', () => ({
  createDefaultDesktopLyricsSettings: vi.fn(() => ({})),
  createDefaultLyricsSettings: vi.fn(() => ({})),
  loadSystemLyricsFonts: vi.fn(),
}));

vi.mock('../services/tauri/windowApi', () => ({
  windowApi: {
    getForegroundFullscreenState: vi.fn(),
    refreshCurrentWindowTopmost: vi.fn(),
    startTopmostGuard: vi.fn(),
    stopTopmostGuard: vi.fn(),
  },
}));

// shouldAutoHideDesktopLyrics 的行为规格表：输入组合 → 期望是否自动隐藏。
const autoHideScenarios = [
  {
    title: 'hides when playback is paused and pause auto-hide is on',
    input: {
      autoHideWhenFullscreen: false,
      autoHideWhenPaused: true,
      isForegroundFullscreen: false,
      isPlaying: false,
      isResizeInteractionActive: false,
    },
    expectHidden: true,
  },
  {
    title: 'stays visible while playing when only pause auto-hide is on',
    input: {
      autoHideWhenFullscreen: false,
      autoHideWhenPaused: true,
      isForegroundFullscreen: false,
      isPlaying: true,
      isResizeInteractionActive: false,
    },
    expectHidden: false,
  },
  {
    title: 'stays visible while a resize interaction is in progress',
    input: {
      autoHideWhenFullscreen: true,
      autoHideWhenPaused: true,
      isForegroundFullscreen: true,
      isPlaying: false,
      isResizeInteractionActive: true,
    },
    expectHidden: false,
  },
] as const;

describe('useDesktopLyricsWindowController', () => {
  for (const scenario of autoHideScenarios) {
    it(scenario.title, () => {
      expect(shouldAutoHideDesktopLyrics({ ...scenario.input })).toBe(scenario.expectHidden);
    });
  }
});
