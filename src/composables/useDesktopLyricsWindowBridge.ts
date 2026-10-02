import { emitTo, listen } from '@tauri-apps/api/event'; // 实现
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'; // 实现
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'; // 实现
import { availableMonitors, getCurrentWindow } from '@tauri-apps/api/window'; // 实现
import { toRaw, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { storeToRefs } from 'pinia'; // 实现
import { useRouter } from 'vue-router';

import { useLyrics } from './lyrics'; // 实现
import { usePlayer } from '../features/playback';
import { usePlaybackStore } from '../features/playback/store'; // 实现
import { useSettingsStore } from '../features/settings/store'; // 实现
import { useUiStore } from '../shared/stores/ui'; // 实现
import { useRenderingPower } from './renderingPower';
import {
  applyDesktopLyricsVisibilityPreference, // 实现
  persistDesktopLyricsVisibilityPreference, // 实现
} from '../features/desktopLyrics/visibilityPreference'; // 实现
import {
  DESKTOP_LYRICS_ACTION_EVENT, DESKTOP_LYRICS_BOUNDS_EVENT, DESKTOP_LYRICS_BOUNDS_KEY,
  DESKTOP_LYRICS_PLAYBACK_EVENT, DESKTOP_LYRICS_READY_EVENT, DESKTOP_LYRICS_RESET_BOUNDS_EVENT,
  DESKTOP_LYRICS_REVEAL_SURFACE_EVENT, DESKTOP_LYRICS_REQUEST_STATE_EVENT, DESKTOP_LYRICS_STATE_EVENT,
  DESKTOP_LYRICS_VISIBILITY_EVENT, DESKTOP_LYRICS_WINDOW_DEFAULT_HEIGHT, DESKTOP_LYRICS_WINDOW_DEFAULT_WIDTH,
  DESKTOP_LYRICS_WINDOW_LABEL, DESKTOP_LYRICS_WINDOW_MIN_HEIGHT, DESKTOP_LYRICS_WINDOW_MIN_WIDTH,
  createDesktopLyricsSongSnapshot, resolveDesktopLyricsWorkArea, restoreDesktopLyricsBounds,
  type DesktopLyricsAction, type DesktopLyricsPlaybackPayload, type DesktopLyricsStatePayload,
  type DesktopLyricsWorkArea, type DesktopLyricsWindowBounds,
} from '../features/desktopLyrics/shared'; // 实现
import { normalizeLyricsSyncOffsetSeconds } from '../features/settings/lyricsSyncOffset'; // 实现

// 主窗口侧的桌面歌词桥：负责歌词窗口的创建/销毁、边界持久化与状态推送。

let pendingWindowCreation: Promise<WebviewWindow> | null = null;

const PLAYBACK_TICK_INTERVAL_MS = 400;
const READY_WAIT_TIMEOUT_MS = 1200;
const STATE_EMIT_COOLDOWN_MS = 30;

function reportBridgeFailure(what: string, cause: unknown) {
  console.warn(`Failed to ${what} desktop lyrics window:`, cause);
}

// 以“最近一次 currentTime 采样”的时间戳标记播放载荷，避免歌词窗口用发送时刻补偿进度。
export function createDesktopLyricsPlaybackClockTracker(now = () => Date.now()) {
  let lastSampledTime: number | null = null;
  let lastSampledStamp = now();

  function captureSample(time: number) {
    if (!Number.isFinite(time)) return;
    lastSampledTime = Math.max(0, time);
    lastSampledStamp = now();
  }

  return {
    markPlaybackTimeSample: captureSample,
    resolveSyncedAt(time: number) {
      const drifted = lastSampledTime === null
        || !Number.isFinite(time)
        || Math.abs(time - lastSampledTime) > 0.000_001;
      if (drifted) {
        captureSample(time);
      }
      return lastSampledStamp;
    },
  };
}

// 就绪闸门：歌词窗口上报就绪后放行；超时兜底放行，避免界面永久挂起。
export function createDesktopLyricsReadyGate(timeoutMs = READY_WAIT_TIMEOUT_MS) {
  let ready = false;
  let pendingWait: Promise<void> | null = null;
  let notifyWaiter: (() => void) | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  function releaseWaiters() {
    notifyWaiter?.();
  }

  function discardWaiter() {
    notifyWaiter = null;
    pendingWait = null;
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  }

  return {
    markReady() { // 实现
      ready = true;
      releaseWaiters();
      discardWaiter();
    },
    reset() {
      ready = false;
      discardWaiter();
    },
    wait() {
      if (ready) {
        return Promise.resolve(); // 实现
      }

      if (!pendingWait) {
        pendingWait = new Promise<void>((wake) => {
          notifyWaiter = wake;
          timeoutHandle = setTimeout(() => {
            releaseWaiters();
            discardWaiter();
          }, timeoutMs);
        });
      }

      return pendingWait;
    },
  };
}

const readyGate = createDesktopLyricsReadyGate();

// —— 歌词窗口边界（位置/尺寸）在 localStorage 中的读写 ——

function readPersistedBounds(): DesktopLyricsWindowBounds | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(DESKTOP_LYRICS_BOUNDS_KEY);
  if (!raw) return null;

  let parsed: Partial<DesktopLyricsWindowBounds>;
  try {
    parsed = JSON.parse(raw) as Partial<DesktopLyricsWindowBounds>;
  } catch {
    return null; // 实现
  }

  if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) {
    return null; // 实现
  }

  // 宽高缺省时回退到默认值，且不允许低于窗口最小尺寸。
  const clampSide = (value: unknown, fallback: number, minimum: number) =>
    Math.max(minimum, Math.round(Number.isFinite(value as number) ? (value as number) : fallback));

  return {
    x: Math.round(parsed.x as number),
    y: Math.round(parsed.y as number),
    width: clampSide(parsed.width, DESKTOP_LYRICS_WINDOW_DEFAULT_WIDTH, DESKTOP_LYRICS_WINDOW_MIN_WIDTH),
    height: clampSide(parsed.height, DESKTOP_LYRICS_WINDOW_DEFAULT_HEIGHT, DESKTOP_LYRICS_WINDOW_MIN_HEIGHT),
  };
}

function persistBounds(bounds: DesktopLyricsWindowBounds) {
  if (typeof localStorage === 'undefined') return; // 实现
  const rounded = {
    x: Math.round(bounds.x), // 实现
    y: Math.round(bounds.y), // 实现
    width: Math.round(bounds.width), // 实现
    height: Math.round(bounds.height), // 实现
  };
  localStorage.setItem(DESKTOP_LYRICS_BOUNDS_KEY, JSON.stringify(rounded));
}

export function clearDesktopLyricsStoredBounds() { // 实现
  if (typeof localStorage === 'undefined') return; // 实现
  localStorage.removeItem(DESKTOP_LYRICS_BOUNDS_KEY); // 实现
}

// 结合显示器工作区还原边界；可选择在所在工作区内水平居中。
async function computeRestoredBounds(shouldCenter: boolean) {
  const stored = readPersistedBounds();
  if (!stored) return null;

  try {
    const monitors = await availableMonitors();
    const workAreas: DesktopLyricsWorkArea[] = monitors.map((item) => ({
      x: item.workArea.position.x,
      y: item.workArea.position.y,
      width: item.workArea.size.width,
      height: item.workArea.size.height,
    }));

    if (workAreas.length === 0) return stored;

    const restored = restoreDesktopLyricsBounds(stored, workAreas);
    if (restored && shouldCenter) {
      const area = resolveDesktopLyricsWorkArea(workAreas, restored);
      if (area) {
        restored.x = area.x + Math.round((area.width - restored.width) / 2);
      }
    }
    return restored; // 实现
  } catch {
    return stored;
  }
}

function findLyricsWindow() {
  return WebviewWindow.getByLabel(DESKTOP_LYRICS_WINDOW_LABEL); // 实现
}

export function createDesktopLyricsWindowOptions({ // 实现
  hasStoredBounds, // 实现
}: {
  alwaysOnTop: boolean; // 实现
  hasStoredBounds: boolean; // 实现
}) {
  // 窗口初始不可见且透明，等状态就绪后再展示，避免白屏闪烁。
  return {
    url: '/',
    title: 'XianYu Music Desktop Lyrics',
    visible: false, // 实现
    decorations: false, // 实现
    transparent: true, // 实现
    shadow: false, // 实现
    skipTaskbar: true, // 实现
    focusable: true, // 实现
    focus: false,
    minimizable: false,
    maximizable: false, // 实现
    alwaysOnTop: true,
    center: !hasStoredBounds, // 实现
    width: DESKTOP_LYRICS_WINDOW_DEFAULT_WIDTH,
    height: DESKTOP_LYRICS_WINDOW_DEFAULT_HEIGHT,
    minWidth: DESKTOP_LYRICS_WINDOW_MIN_WIDTH,
    minHeight: DESKTOP_LYRICS_WINDOW_MIN_HEIGHT,
  };
}

async function acquireLyricsWindow(alwaysOnTop: boolean, centerHorizontally: boolean) {
  const existing = await findLyricsWindow();
  if (existing) return existing; // 实现

  if (pendingWindowCreation) {
    return pendingWindowCreation;
  }

  readyGate.reset();
  const bounds = await computeRestoredBounds(centerHorizontally);
  const created = new WebviewWindow(DESKTOP_LYRICS_WINDOW_LABEL, createDesktopLyricsWindowOptions({
    alwaysOnTop,
    hasStoredBounds: bounds !== null,
  }));

  pendingWindowCreation = new Promise<WebviewWindow>((resolve, reject) => {
    let finalized = false;

    const settleCreation = () => {
      finalized = true;
      pendingWindowCreation = null;
    };

    void created.once('tauri://created', async () => {
      if (finalized) return;
      try {
        if (bounds) {
          await created.setSize(new PhysicalSize(bounds.width, bounds.height));
          await created.setPosition(new PhysicalPosition(bounds.x, bounds.y));
        }
        settleCreation();
        resolve(created);
      } catch (error) {
        settleCreation();
        reject(error);
      }
    });

    void created.once('tauri://error', (event) => {
      if (finalized) return;
      settleCreation();
      reject(event.payload);
    });
  });

  return pendingWindowCreation;
}

export function useDesktopLyricsWindowBridge() { // 实现
  const mainWindow = getCurrentWindow(); // 实现
  const router = useRouter();
  const {
    showDesktopLyrics, // 实现
    parsedLyrics, // 实现
    lyricsStatus, // 实现
    currentLyricLine, // 实现
    lyricsSettings, // 实现
    desktopLyricsSettings, // 实现
  } = useLyrics(); // 实现
  const { togglePlay, prevSong, nextSong, isFavorite, toggleFavorite } = usePlayer();
  const playbackStore = usePlaybackStore(); // 实现
  const uiStore = useUiStore(); // 实现
  const settingsStore = useSettingsStore(); // 实现
  const { currentSong, currentTime, isPlaying } = storeToRefs(playbackStore); // 实现
  const { audioDelay } = storeToRefs(settingsStore); // 实现
  const { dominantColors } = storeToRefs(uiStore); // 实现
  const { isMainWindowLowPower } = useRenderingPower();
  const clock = createDesktopLyricsPlaybackClockTracker();

  let mainWindowClosing = false;
  let tickLoopHandle: ReturnType<typeof setInterval> | null = null;
  const disposers: Array<() => void> = [];
  const trackDisposer = (dispose: () => void) => {
    disposers.push(dispose);
  };

  // —— 发往歌词窗口的载荷构造 ——

  const buildStatePayload = (): DesktopLyricsStatePayload => {
    const song = currentSong.value;
    const desktop = desktopLyricsSettings;
    const lyricPrefs = lyricsSettings;

    return {
      song: createDesktopLyricsSongSnapshot(song),
      parsedLyrics: toRaw(parsedLyrics.value) as DesktopLyricsStatePayload['parsedLyrics'],
      lyricsStatus: lyricsStatus.value,
      fallbackText: currentLyricLine.value.text,
      playbackTime: currentTime.value,
      syncedAt: clock.resolveSyncedAt(currentTime.value),
      isPlaying: isPlaying.value,
      isFavorite: song ? isFavorite(song) : false,
      audioDelay: audioDelay.value,
      settings: {
        showTranslation: lyricPrefs.showTranslation,
        showRomaji: lyricPrefs.showRomaji,
        isAlwaysOnTop: desktop.isAlwaysOnTop,
        alwaysShowShadowBackground: desktop.alwaysShowShadowBackground,
        autoHideWhenFullscreen: desktop.autoHideWhenFullscreen,
        autoHideWhenPaused: desktop.autoHideWhenPaused,
        showDoubleLine: desktop.showDoubleLine,
        enableWordEffect: desktop.enableWordEffect,
        enableTextOutline: desktop.enableTextOutline,
        textOutlineWidth: desktop.textOutlineWidth,
        textOutlineColor: desktop.textOutlineColor,
        isLocked: desktop.isLocked,
        persistLock: desktop.persistLock,
        colorScheme: desktop.colorScheme,
        customPlayedColor: desktop.customPlayedColor,
        customUnplayedColor: desktop.customUnplayedColor,
        customRomajiPlayedColor: desktop.customRomajiPlayedColor,
        customRomajiUnplayedColor: desktop.customRomajiUnplayedColor,
        customRomajiColor: desktop.customRomajiColor,
        customTranslationColor: desktop.customTranslationColor,
        textOpacity: desktop.textOpacity,
        textShadowColor: desktop.textShadowColor,
        firstLineTextShadowStrength: desktop.firstLineTextShadowStrength,
        secondLineTextShadowStrength: desktop.secondLineTextShadowStrength,
        playerFontScale: desktop.playerFontScale,
        subFontScale: desktop.subFontScale,
        playerLineGap: desktop.playerLineGap,
        playerOffsetX: desktop.playerOffsetX,
        playerOffsetY: desktop.playerOffsetY,
        playerAlignment: desktop.playerAlignment,
        playerFontPreset: desktop.playerFontPreset,
        centerHorizontally: desktop.centerHorizontally,
      },
      customLyricsFonts: [...settingsStore.settings.customLyricsFonts],
      themeColors: [...dominantColors.value],
    };
  };

  const buildPlaybackPayload = (): DesktopLyricsPlaybackPayload => ({
    playbackTime: currentTime.value, // 实现
    syncedAt: clock.resolveSyncedAt(currentTime.value),
    isPlaying: isPlaying.value, // 实现
    audioDelay: audioDelay.value, // 实现
  });

  // —— 全量状态推送（带 30ms 冷却；immediate 表示跳过冷却立即发送） ——

  let stateEmitCoolingDown = false;
  let stateEmitQueued = false;
  let cooldownTimer: ReturnType<typeof setTimeout> | null = null;

  function clearStateEmitCooldown() {
    if (cooldownTimer) {
      clearTimeout(cooldownTimer);
      cooldownTimer = null;
    }
    stateEmitCoolingDown = false;
    stateEmitQueued = false;
  }

  async function pushFullState(immediate = false) {
    const target = await findLyricsWindow();
    if (!target) return;

    if (immediate) {
      clearStateEmitCooldown();
    } else if (stateEmitCoolingDown) {
      stateEmitQueued = true;
      return;
    } else {
      stateEmitCoolingDown = true;
    }

    try {
      await emitTo<DesktopLyricsStatePayload>( // 实现
        DESKTOP_LYRICS_WINDOW_LABEL, // 实现
        DESKTOP_LYRICS_STATE_EVENT, // 实现
        buildStatePayload(),
      );
    } finally {
      if (!immediate) { // 实现
        cooldownTimer = setTimeout(() => {
          cooldownTimer = null;
          stateEmitCoolingDown = false;
          if (stateEmitQueued) {
            stateEmitQueued = false;
            void pushFullState(false);
          }
        }, STATE_EMIT_COOLDOWN_MS);
      }
    }
  }

  async function pushPlaybackTick() {
    const target = await findLyricsWindow();
    if (!target) return;

    await emitTo<DesktopLyricsPlaybackPayload>( // 实现
      DESKTOP_LYRICS_WINDOW_LABEL, // 实现
      DESKTOP_LYRICS_PLAYBACK_EVENT, // 实现
      buildPlaybackPayload(),
    );
  }

  async function revealSurface() {
    const target = await findLyricsWindow();
    if (!target) return;

    await emitTo(DESKTOP_LYRICS_WINDOW_LABEL, DESKTOP_LYRICS_REVEAL_SURFACE_EVENT); // 实现
  }

  async function applyWindowFlags() {
    const target = await findLyricsWindow();
    if (!target) return;

    await target.setAlwaysOnTop(desktopLyricsSettings.isAlwaysOnTop);
  }

  async function openLyricsWindow() {
    const target = await acquireLyricsWindow(
      desktopLyricsSettings.isAlwaysOnTop, // 实现
      desktopLyricsSettings.centerHorizontally, // 实现
    );
    await readyGate.wait();
    await applyWindowFlags();
    await pushFullState(true);
    await pushPlaybackTick();
    await target.show();
    await revealSurface();
    launchTickLoop();
  }

  // —— 播放进度定时推送循环 ——

  function haltTickLoop() {
    if (tickLoopHandle === null) return;
    clearInterval(tickLoopHandle);
    tickLoopHandle = null;
  }

  function launchTickLoop() {
    haltTickLoop();
    tickLoopHandle = setInterval(() => {
      if (!showDesktopLyrics.value) return; // 实现
      void pushPlaybackTick().catch((error) => {
        reportBridgeFailure('sync playback to', error);
      });
    }, PLAYBACK_TICK_INTERVAL_MS);
  }

  // —— 处理来自歌词窗口的动作指令 ——

  async function applyLyricsAction(action: DesktopLyricsAction) {
    switch (action.type) { // 实现
      case 'toggle-play': // 实现
        await togglePlay(); // 实现
        break;
      case 'prev-song': // 实现
        prevSong();
        break;
      case 'next-song': // 实现
        nextSong();
        break;
      case 'toggle-favorite':
        if (currentSong.value) toggleFavorite(currentSong.value);
        await nextTick();
        await pushFullState(true);
        break;
      case 'open-settings': {
        uiStore.mainWindowUiSleepRequested = false;
        await router.push('/settings?tab=desktopLyrics');
        await mainWindow.show();
        await mainWindow.setFocus();
        break;
      }
      case 'adjust-offset': { // 实现
        const base = settingsStore.settings.lyricsSyncOffset;
        settingsStore.settings.lyricsSyncOffset = normalizeLyricsSyncOffsetSeconds( // 实现
          base + action.delta,
        );
        break;
      }
      case 'close': // 实现
        showDesktopLyrics.value = false; // 实现
        break;
      case 'update-settings': { // 实现
        const {
          showTranslation, // 实现
          showRomaji,
          ...desktopPatch // 实现
        } = action.patch; // 实现

        if (typeof showTranslation === 'boolean') { // 实现
          lyricsSettings.showTranslation = showTranslation; // 实现
        }

        if (typeof showRomaji === 'boolean') { // 实现
          lyricsSettings.showRomaji = showRomaji; // 实现
        }

        Object.assign(desktopLyricsSettings, desktopPatch); // 实现
        break;
      }
      default:
        break;
    }
  }

  async function closeLyricsWindow() {
    const target = await findLyricsWindow();
    if (!target) return;

    try {
      await target.destroy();
    } catch (error) { // 实现
      console.warn('Failed to destroy desktop lyrics window during shutdown:', error); // 实现
    } finally {
      pendingWindowCreation = null;
      readyGate.reset();
    }
  }

  onMounted(async () => { // 实现
    // 未开启“记住锁定状态”时，每次启动都解除锁定。
    if (!desktopLyricsSettings.persistLock && desktopLyricsSettings.isLocked) { // 实现
      desktopLyricsSettings.isLocked = false; // 实现
    }

    trackDisposer(await mainWindow.onCloseRequested(async (event) => {
      if (settingsStore.settings.closeToTray) return; // 实现
      if (mainWindowClosing) return;

      mainWindowClosing = true;
      event.preventDefault(); // 实现
      haltTickLoop();
      await closeLyricsWindow();
      await mainWindow.close(); // 实现
    }));

    trackDisposer(await listen(DESKTOP_LYRICS_REQUEST_STATE_EVENT, () => {
      void pushFullState(true).catch((error) => {
        reportBridgeFailure('sync state to', error);
      });
      void pushPlaybackTick().catch((error) => {
        reportBridgeFailure('sync playback to', error);
      });
    }));

    trackDisposer(await listen(DESKTOP_LYRICS_READY_EVENT, () => {
      readyGate.markReady();
    }));

    trackDisposer(await listen<DesktopLyricsAction>(DESKTOP_LYRICS_ACTION_EVENT, (event) => {
      void applyLyricsAction(event.payload).catch((error) => {
        reportBridgeFailure('handle action from', error);
      });
    }));

    trackDisposer(await listen<{ visible: boolean }>(DESKTOP_LYRICS_VISIBILITY_EVENT, (event) => {
      if (mainWindowClosing) return;
      showDesktopLyrics.value = event.payload.visible; // 实现
    }));

    trackDisposer(await listen<DesktopLyricsWindowBounds>(DESKTOP_LYRICS_BOUNDS_EVENT, (event) => {
      persistBounds(event.payload);
    }));

    trackDisposer(await listen(DESKTOP_LYRICS_RESET_BOUNDS_EVENT, async () => {
      clearDesktopLyricsStoredBounds(); // 实现
      if (!showDesktopLyrics.value) return; // 实现

      // 重建窗口以应用重置后的边界。
      haltTickLoop();
      await closeLyricsWindow();
      await openLyricsWindow().catch((error) => {
        reportBridgeFailure('reopen', error);
        showDesktopLyrics.value = false; // 实现
      });
    }));
  });

  onUnmounted(() => { // 实现
    haltTickLoop();
    disposers.splice(0).forEach((dispose) => dispose());
  });

  watch(showDesktopLyrics, async (visible) => { // 实现
    persistDesktopLyricsVisibilityPreference( // 实现
      settingsStore.settings, // 实现
      settingsStore.patchSettings, // 实现
      visible,
    );

    if (!visible) {
      haltTickLoop();
      await closeLyricsWindow();
      return;
    }

    try {
      await openLyricsWindow();
    } catch (error) { // 实现
      reportBridgeFailure('open', error);
      haltTickLoop();
      pendingWindowCreation = null;
      readyGate.reset();
      showDesktopLyrics.value = false;
    }
  });

  watch(isMainWindowLowPower, (lowPower) => {
    if (lowPower) {
      haltTickLoop();
    } else if (showDesktopLyrics.value) {
      launchTickLoop();
    }
  });

  watch(
    currentTime, // 实现
    (time) => {
      if (!showDesktopLyrics.value) return; // 实现
      clock.markPlaybackTimeSample(time);
    },
    { immediate: true }, // 实现
  );

  watch(
    () => settingsStore.settings.showDesktopLyrics, // 实现
    (preferred) => {
      applyDesktopLyricsVisibilityPreference(showDesktopLyrics, preferred);
    },
    { immediate: true }, // 实现
  );

  // 歌词内容 / 歌曲信息 / 歌词偏好等任一变化时，向歌词窗口同步最新状态。
  // 数组前 9 个为核心数据源：其中任一变化都绕过冷却立即推送。
  const ds = desktopLyricsSettings;
  const ls = lyricsSettings;

  watch(
    [
      parsedLyrics, // 实现
      lyricsStatus, // 实现
      () => currentSong.value?.path, // 实现
      () => currentSong.value?.title, // 实现
      () => currentSong.value?.name, // 实现
      () => currentSong.value?.artist, // 实现
      () => currentSong.value?.duration, // 实现
      isPlaying,
      audioDelay,
      () => ls.showTranslation,
      () => ls.showRomaji,
      () => ds.isAlwaysOnTop,
      () => ds.alwaysShowShadowBackground,
      () => ds.autoHideWhenFullscreen,
      () => ds.autoHideWhenPaused,
      () => ds.showDoubleLine,
      () => ds.enableWordEffect,
      () => ds.isLocked,
      () => ds.persistLock,
      () => ds.centerHorizontally,
      () => ds.colorScheme,
      () => ds.customPlayedColor,
      () => ds.customUnplayedColor,
      () => ds.customRomajiPlayedColor,
      () => ds.customRomajiUnplayedColor,
      () => ds.customRomajiColor,
      () => ds.customTranslationColor,
      () => ds.textOpacity,
      () => ds.textShadowColor,
      () => ds.firstLineTextShadowStrength,
      () => ds.secondLineTextShadowStrength,
      () => ds.playerFontScale,
      () => ds.subFontScale,
      () => ds.playerLineGap,
      () => ds.playerOffsetX,
      () => ds.playerOffsetY,
      () => ds.playerAlignment,
      () => ds.playerFontPreset,
      () => settingsStore.settings.customLyricsFonts, // 实现
      dominantColors, // 实现
    ],
    (next, prev) => {
      if (!showDesktopLyrics.value) return; // 实现

      const coreIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8];
      const immediate = !prev || coreIndices.some((index) => next[index] !== prev[index]);

      void pushFullState(immediate).catch((error) => {
        reportBridgeFailure('sync state to', error);
      });
      void pushPlaybackTick().catch((error) => {
        reportBridgeFailure('sync playback to', error);
      });
      void applyWindowFlags().catch((error) => {
        reportBridgeFailure('sync flags for', error);
      });
    },
  );
}
