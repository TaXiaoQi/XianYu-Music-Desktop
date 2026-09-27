import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { effectScope, nextTick } from 'vue';

import {
  createDesktopLyricsPlaybackClockTracker,
  createDesktopLyricsReadyGate,
  createDesktopLyricsWindowOptions,
  useDesktopLyricsWindowBridge,
} from './useDesktopLyricsWindowBridge';

declare const require: <T = unknown>(id: string) => T;

// vi.hoisted 内无法直接用静态 import，因此通过 require 拿到 vue 的 ref。
const mocks = vi.hoisted(() => {
  const vueApi = require('vue') as typeof import('vue');
  const ref = vueApi.ref;

  // —— 供断言读取的响应式状态桩 ——
  const lyricsVisible = ref(false);
  const parsedLines = ref([]);
  const syncStatus = ref('idle');
  const activeLine = ref({ text: 'Instrumental / No lyrics' });
  const activeSong = ref(null);
  const playbackClock = ref(0);
  const playing = ref(false);
  const accentColors = ref([]);

  // —— 设置快照（字段取值即行为规格，勿改动） ——
  const desktopLyricsConfig = {
    isAlwaysOnTop: true,
    alwaysShowShadowBackground: false,
    autoHideWhenFullscreen: true,
    autoHideWhenPaused: false,
    showDoubleLine: false,
    enableWordEffect: true,
    enableTextOutline: false,
    isLocked: false,
    persistLock: false,
    colorScheme: 'pink',
    customPlayedColor: '#ffffff',
    customUnplayedColor: '#ffffff',
    customRomajiPlayedColor: '#ffffff',
    customRomajiUnplayedColor: '#ffffff',
    customRomajiColor: '#ffffff',
    customTranslationColor: '#ffffff',
    textOpacity: 1,
    textShadowColor: '#000000',
    firstLineTextShadowStrength: 0,
    secondLineTextShadowStrength: 0,
    playerFontScale: 1,
    playerLineGap: 1,
    playerOffsetX: 0,
    playerOffsetY: 0,
    playerAlignment: 'center',
    playerFontPreset: 'system',
  };
  const translationPrefs = {
    showTranslation: true,
    showRomaji: true,
  };
  const settingsState = {
    showDesktopLyrics: false,
    customLyricsFonts: [],
    lyricsSyncOffset: 0,
    desktopLyrics: desktopLyricsConfig,
  };

  // —— 歌词窗口 WebviewWindow 桩 ——
  const targetWindow = {
    once: vi.fn(),
    setSize: vi.fn(() => Promise.resolve()),
    setPosition: vi.fn(() => Promise.resolve()),
    setAlwaysOnTop: vi.fn(() => Promise.resolve()),
    show: vi.fn(() => Promise.reject('window not found')),
    destroy: vi.fn(() => Promise.resolve()),
  };
  const WebviewWindowCtor = vi.fn(() => targetWindow) as ReturnType<typeof vi.fn> & {
    getByLabel: ReturnType<typeof vi.fn>;
  };
  WebviewWindowCtor.getByLabel = vi.fn(() => Promise.resolve(null));

  return {
    lyricsVisible,
    parsedLines,
    syncStatus,
    activeLine,
    activeSong,
    playbackClock,
    playing,
    accentColors,
    settingsState,
    translationPrefs,
    desktopLyricsConfig,
    targetWindow,
    WebviewWindow: WebviewWindowCtor,
    applySettingsPatch: vi.fn((patch) => {
      Object.assign(settingsState, patch);
    }),
  };
});

vi.mock('@tauri-apps/api/dpi', () => {
  class PhysicalPositionStub {
    constructor(public x: number, public y: number) {}
  }
  class PhysicalSizeStub {
    constructor(public width: number, public height: number) {}
  }
  return {
    PhysicalPosition: PhysicalPositionStub,
    PhysicalSize: PhysicalSizeStub,
  };
});

vi.mock('@tauri-apps/api/event', () => {
  return {
    emitTo: vi.fn(),
    listen: vi.fn(),
  };
});

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: mocks.WebviewWindow,
}));

vi.mock('@tauri-apps/api/window', () => ({
  availableMonitors: vi.fn(),
  getCurrentWindow: vi.fn(() => ({
    onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
  })),
}));

vi.mock('../features/playback/store', () => ({
  usePlaybackStore: vi.fn(() => ({
    currentSong: mocks.activeSong,
    currentTime: mocks.playbackClock,
    isPlaying: mocks.playing,
  })),
}));

vi.mock('../features/settings/store', () => ({
  useSettingsStore: vi.fn(() => ({
    settings: mocks.settingsState,
    audioDelay: mocks.playbackClock,
    patchSettings: mocks.applySettingsPatch,
  })),
}));

vi.mock('../shared/stores/ui', () => ({
  useUiStore: vi.fn(() => ({
    dominantColors: mocks.accentColors,
  })),
}));

vi.mock('./lyrics', () => ({
  createDefaultDesktopLyricsSettings: vi.fn(() => ({})),
  createDefaultLyricsSettings: vi.fn(() => ({})),
  useLyrics: vi.fn(() => ({
    showDesktopLyrics: mocks.lyricsVisible,
    parsedLyrics: mocks.parsedLines,
    lyricsStatus: mocks.syncStatus,
    currentLyricLine: mocks.activeLine,
    lyricsSettings: mocks.translationPrefs,
    desktopLyricsSettings: mocks.desktopLyricsConfig,
  })),
}));

vi.mock('./player', () => ({
  usePlayer: vi.fn(() => ({ togglePlay: vi.fn(), prevSong: vi.fn(), nextSong: vi.fn() })),
}));

vi.mock('../features/playback/player', () => ({
  usePlayer: vi.fn(() => ({ togglePlay: vi.fn(), prevSong: vi.fn(), nextSong: vi.fn() })),
}));

describe('useDesktopLyricsWindowBridge', () => {
  beforeEach(() => {
    mocks.lyricsVisible.value = false;
    mocks.settingsState.showDesktopLyrics = false;
    mocks.applySettingsPatch.mockClear();
    mocks.targetWindow.once.mockImplementation((event: string, handler: () => void) => {
      // 仅让 tauri://created 立即触发，模拟窗口创建成功。
      if (event === 'tauri://created') {
        queueMicrotask(handler);
      }
      return Promise.resolve(() => {});
    });
    mocks.targetWindow.show.mockImplementation(() => Promise.reject('window not found'));
    mocks.WebviewWindow.mockClear();
    mocks.WebviewWindow.getByLabel.mockResolvedValue(null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('builds window options that never steal focus from the main window', () => {
    const options = createDesktopLyricsWindowOptions({
      alwaysOnTop: true,
      hasStoredBounds: false,
    });

    expect(options).toMatchObject({
      alwaysOnTop: true,
      center: true,
      focus: false,
      focusable: true,
      visible: false,
    });
  });

  it('stamps playback payloads with the last currentTime sample instead of the send moment', () => {
    const clockNow = { value: 1_000 };
    const tracker = createDesktopLyricsPlaybackClockTracker(() => clockNow.value);

    tracker.markPlaybackTimeSample(11.35);
    clockNow.value += 650;

    expect(tracker.resolveSyncedAt(11.35)).toBe(1_000);
    expect(tracker.resolveSyncedAt(12)).toBe(1_650);
  });

  it('holds the ready gate closed until the lyrics window reports readiness', async () => {
    vi.useFakeTimers();
    const gate = createDesktopLyricsReadyGate(1000);
    let released = false;

    const waiting = gate.wait().then(() => {
      released = true;
    });

    await Promise.resolve();
    expect(released).toBe(false);

    gate.markReady();
    await waiting;

    expect(released).toBe(true);
  });

  it('rolls the visibility flag back when the lyrics window cannot be opened', async () => {
    const scope = effectScope();
    scope.run(() => useDesktopLyricsWindowBridge());

    mocks.lyricsVisible.value = true;
    await nextTick();
    await new Promise<void>((done) => {
      setTimeout(done, 0);
    });
    await nextTick();

    expect(mocks.lyricsVisible.value).toBe(false);
    expect(mocks.applySettingsPatch).toHaveBeenCalledWith({ showDesktopLyrics: false });

    scope.stop();
  });
});
