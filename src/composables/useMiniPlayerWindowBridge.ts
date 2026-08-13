import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { emitTo, listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { availableMonitors, getCurrentWindow } from '@tauri-apps/api/window';
import { nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';

import { useCoverCache } from './useCoverCache';
import { useLyrics } from './lyrics';
import { showDesktopLyrics } from './lyrics';
import { usePlayer } from '../features/playback';
import { useThemeSettings } from './useThemeSettings';
import { useSettings } from '../features/settings/useSettings';
import { useUiStore } from '../shared/stores/ui';
import { stateApi } from '../services/tauri/stateApi';
import { windowApi } from '../services/tauri/windowApi';
import {
  MINI_PLAYER_ACTION_EVENT,
  MINI_PLAYER_BOUNDS_EVENT,
  MINI_PLAYER_BOUNDS_KEY,
  MINI_PLAYER_READY_EVENT,
  MINI_PLAYER_REQUEST_STATE_EVENT,
  MINI_PLAYER_STATE_APPLIED_EVENT,
  MINI_PLAYER_STATE_EVENT,
  MINI_PLAYER_VISIBILITY_EVENT,
  MINI_PLAYER_WINDOW_BASE_HEIGHT,
  MINI_PLAYER_WINDOW_EXPANDED_HEIGHT,
  MINI_PLAYER_WINDOW_LABEL,
  MINI_PLAYER_WINDOW_WIDTH,
  APP_SHOW_MAIN_EVENT,
  type MiniPlayerAction,
  type MiniPlayerStatePayload,
  type MiniPlayerWindowBounds,
} from '../features/miniPlayer/shared';

let miniPlayerWindowPromise: Promise<WebviewWindow> | null = null;
let isMiniPlayerReady = false;
let miniPlayerReadyPromise: Promise<void> | null = null;
let resolveMiniPlayerReady: (() => void) | null = null;
let resolveMiniPlayerStateApplied: (() => void) | null = null;

let miniPlayerPrewarmTimer: number | null = null;

// 迷你窗位置持久化 key（磁盘 state 文件，重启后仍保留）
const MINI_PLAYER_BOUNDS_STATE_KEY = 'mini_player_window_bounds';

function clearMiniPlayerPrewarmTimer() {
  if (miniPlayerPrewarmTimer !== null) {
    window.clearTimeout(miniPlayerPrewarmTimer);
    miniPlayerPrewarmTimer = null;
  }
}

async function readMiniPlayerBounds(): Promise<MiniPlayerWindowBounds | null> {
  // 优先从磁盘 state 文件读取（重启后仍保留），localStorage 仅作兼容回退
  let stored: string | null = null;
  try {
    stored = await stateApi.readStateJson(MINI_PLAYER_BOUNDS_STATE_KEY);
  } catch {
    stored = null;
  }
  if (!stored && typeof localStorage !== 'undefined') {
    stored = localStorage.getItem(MINI_PLAYER_BOUNDS_KEY);
  }
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as Partial<MiniPlayerWindowBounds>;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) {
      return null;
    }

    return {
      x: Math.round(parsed.x as number),
      y: Math.round(parsed.y as number),
    };
  } catch {
    return null;
  }
}

async function writeMiniPlayerBounds(bounds: MiniPlayerWindowBounds) {
  const payload = JSON.stringify({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
  });
  try {
    await stateApi.writeStateJson(MINI_PLAYER_BOUNDS_STATE_KEY, payload);
  } catch {
    /* 磁盘写入失败时忽略，不影响使用 */
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(MINI_PLAYER_BOUNDS_KEY, payload);
  }
}

async function normalizeMiniPlayerBounds(bounds: MiniPlayerWindowBounds | null) {
  if (!bounds) return null;

  try {
    const workAreas = (await availableMonitors()).map((monitor) => {
      const scaleFactor = monitor.scaleFactor || 1;
      const position = monitor.workArea.position.toLogical(scaleFactor);
      const size = monitor.workArea.size.toLogical(scaleFactor);

      return {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
      };
    });

    if (workAreas.length === 0) return bounds;

    const width = MINI_PLAYER_WINDOW_WIDTH;
    const height = MINI_PLAYER_WINDOW_EXPANDED_HEIGHT;
    const boundsCenterX = bounds.x + width / 2;
    const boundsCenterY = bounds.y + MINI_PLAYER_WINDOW_BASE_HEIGHT / 2;
    const workArea = workAreas.reduce((best, candidate) => {
      const bestCenterX = best.x + best.width / 2;
      const bestCenterY = best.y + best.height / 2;
      const candidateCenterX = candidate.x + candidate.width / 2;
      const candidateCenterY = candidate.y + candidate.height / 2;
      const bestDistance = (bestCenterX - boundsCenterX) ** 2 + (bestCenterY - boundsCenterY) ** 2;
      const candidateDistance = (candidateCenterX - boundsCenterX) ** 2 + (candidateCenterY - boundsCenterY) ** 2;
      return candidateDistance < bestDistance ? candidate : best;
    }, workAreas[0]);

    const maxX = workArea.x + Math.max(0, workArea.width - width);
    const maxY = workArea.y + Math.max(0, workArea.height - height);

    return {
      x: Math.round(Math.min(maxX, Math.max(workArea.x, bounds.x))),
      y: Math.round(Math.min(maxY, Math.max(workArea.y, bounds.y))),
    };
  } catch {
    return bounds;
  }
}

async function getMiniPlayerWindow() {
  return WebviewWindow.getByLabel(MINI_PLAYER_WINDOW_LABEL);
}

async function ensureMiniPlayerWindow() {
  const existing = await getMiniPlayerWindow();
  if (existing) {
    const bounds = await normalizeMiniPlayerBounds(await readMiniPlayerBounds());
    if (bounds) {
      await existing.setPosition(new LogicalPosition(bounds.x, bounds.y));
    }
    const baseSize = new LogicalSize(MINI_PLAYER_WINDOW_WIDTH, MINI_PLAYER_WINDOW_BASE_HEIGHT);
    await existing.setMinSize(baseSize);
    await existing.setMaxSize(baseSize);
    await existing.setSize(baseSize);
    return existing;
  }

  if (!miniPlayerWindowPromise) {
    isMiniPlayerReady = false;
    miniPlayerReadyPromise = null;
    resolveMiniPlayerReady = null;

    miniPlayerWindowPromise = (async () => {
      const bounds = await normalizeMiniPlayerBounds(await readMiniPlayerBounds());
      const windowInstance = new WebviewWindow(MINI_PLAYER_WINDOW_LABEL, {
        url: '/',
        title: 'XY-Music Mini Player',
        width: MINI_PLAYER_WINDOW_WIDTH,
        height: MINI_PLAYER_WINDOW_BASE_HEIGHT,
        minWidth: MINI_PLAYER_WINDOW_WIDTH,
        minHeight: MINI_PLAYER_WINDOW_BASE_HEIGHT,
        maxWidth: MINI_PLAYER_WINDOW_WIDTH,
        maxHeight: MINI_PLAYER_WINDOW_BASE_HEIGHT,
        visible: false,
        decorations: false,
        transparent: true,
        shadow: false,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: true,
        center: !bounds,
      });

      return new Promise<WebviewWindow>((resolve, reject) => {
        let settled = false;

        void windowInstance.once('tauri://created', async () => {
          if (settled) return;

          try {
            if (bounds) {
              await windowInstance.setPosition(new LogicalPosition(bounds.x, bounds.y));
            }

            settled = true;
            resolve(windowInstance);
          } catch (error) {
            settled = true;
            reject(error);
          }
        });

        void windowInstance.once('tauri://error', (event) => {
          if (settled) return;
          settled = true;
          reject(event.payload);
        });
      });
    })();

    miniPlayerWindowPromise = miniPlayerWindowPromise.finally(() => {
      miniPlayerWindowPromise = null;
    });
  }

  return miniPlayerWindowPromise;
}

function markMiniPlayerReady() {
  isMiniPlayerReady = true;
  resolveMiniPlayerReady?.();
  resolveMiniPlayerReady = null;
  miniPlayerReadyPromise = null;
}

function waitForMiniPlayerReady(timeoutMs = 1000) {
  if (isMiniPlayerReady) {
    return Promise.resolve();
  }

  if (!miniPlayerReadyPromise) {
    miniPlayerReadyPromise = new Promise<void>((resolve) => {
      resolveMiniPlayerReady = resolve;
      window.setTimeout(resolve, timeoutMs);
    });
  }

  return miniPlayerReadyPromise;
}

function waitForMiniPlayerStateApplied(timeoutMs = 500) {
  return new Promise<void>((resolve) => {
    resolveMiniPlayerStateApplied = resolve;
    window.setTimeout(resolve, timeoutMs);
  });
}

export async function restoreMainWindowFromMiniMode(options: {
  isMiniMode: Ref<boolean>;
  hideMiniPlayerWindow: () => Promise<void>;
  keepMiniPlayerVisible?: boolean;
  mainWindow: {
    unminimize: () => Promise<void>;
    show: () => Promise<void>;
    setFocus: () => Promise<void>;
  };
  isImmersiveFullscreen?: boolean;
}) {
  options.isMiniMode.value = false;
  if (!options.keepMiniPlayerVisible) {
    await options.hideMiniPlayerWindow();
  }
  // 小窗消失后再延迟 0.5s 显示主窗
  await new Promise<void>((resolve) => setTimeout(resolve, 500));

  // 主窗淡入：用不透明遮罩盖住内容，再让遮罩淡出露出主窗。
  // 主窗是 transparent 窗口，窗口级 setOpacity 在 Windows 上不生效；
  // 直接对 #app 做 opacity 过渡会因 WebView2 隐藏时保留旧帧而先闪出完整画面。
  // 遮罩从第一帧就覆盖，无论 WebView2 呈现什么缓存都不会闪。
  let fadeMask: HTMLDivElement | null = null;
  if (typeof document !== 'undefined') {
    const isDark = document.documentElement.classList.contains('dark');
    fadeMask = document.createElement('div');
    fadeMask.style.cssText = `position:fixed;inset:0;z-index:99999;pointer-events:none;background-color:${isDark ? '#262626' : '#fafafa'};opacity:1;`;
    document.body.appendChild(fadeMask);
  }

  await options.mainWindow.unminimize();
  await options.mainWindow.show();
  await options.mainWindow.setFocus();

  if (fadeMask) {
    requestAnimationFrame(() => {
      fadeMask.style.transition = 'opacity 0.3s ease-out';
      fadeMask.style.opacity = '0';
    });
    window.setTimeout(() => fadeMask?.remove(), 400);
  }

  // 主窗口 hide → show 后 shell 会忘记之前的全屏标记，导致任务栏重新显示遮挡窗口底部。
  // 若仍处于沉浸全屏状态，重新告知 shell 让任务栏让位（不改变窗口样式/位置，无动画开销）。
  if (options.isImmersiveFullscreen) {
    try {
      await windowApi.refreshImmersiveFullscreen();
    } catch { /* 忽略 */ }
  }

  if (typeof window !== 'undefined') {
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 0);
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 100);
  }
}

export function useMiniPlayerWindowBridge() {
  const mainWindow = getCurrentWindow();
  const { settings } = useSettings();
  const uiStore = useUiStore();
  const {
    currentSong,
    isPlaying,
    volume,
    playQueue,
    tempQueue,
    songList,
    togglePlay,
    prevSong,
    nextSong,
    handleVolume,
    toggleMute,
    playSong,
    isMiniMode,
    currentTime,
    playMode,
    seekTo,
    toggleMode,
    isFavorite,
    toggleFavorite,
  } = usePlayer();
  const { currentLyricLine } = useLyrics();
  const { loadCover } = useCoverCache();
  const { isDarkTheme, theme } = useThemeSettings();

  let isMainWindowClosing = false;
  let keepMiniPlayerVisibleOnMiniModeExit = false;
  const isMiniPlayerWindowVisible = ref(false);
  const unlisteners: Array<() => void> = [];

  const createStatePayload = async (): Promise<MiniPlayerStatePayload> => {
    const song = currentSong.value;
    const coverUrl = song?.path ? await loadCover(song.path).catch(() => '') : '';

    return {
      currentSong: song,
      coverUrl: coverUrl || '',
      isPlaying: isPlaying.value,
      isDarkTheme: isDarkTheme.value,
      volume: volume.value,
      queue: playQueue.value.length > 0 || tempQueue.value.length > 0
        ? [...tempQueue.value, ...playQueue.value]
        : songList.value,
      lyricText: currentLyricLine.value?.text ?? '',
      windowMaterial: theme.value.windowMaterial,
      windowBlurTint: theme.value.windowBlurTint,
      currentTime: currentTime.value,
      duration: song?.duration ?? 0,
      isFavorite: song ? isFavorite(song) : false,
      playMode: playMode.value,
      desktopLyricsEnabled: showDesktopLyrics.value,
    };
  };

  const emitStateToMiniPlayer = async () => {
    const targetWindow = await getMiniPlayerWindow();
    if (!targetWindow) return;

    const appliedPromise = waitForMiniPlayerStateApplied();
    await emitTo<MiniPlayerStatePayload>(
      MINI_PLAYER_WINDOW_LABEL,
      MINI_PLAYER_STATE_EVENT,
      await createStatePayload(),
    );
    await appliedPromise;
  };

  const emitMiniPlayerVisibility = async (visible: boolean) => {
    const targetWindow = await getMiniPlayerWindow();
    if (!targetWindow) return;

    await emitTo(MINI_PLAYER_WINDOW_LABEL, MINI_PLAYER_VISIBILITY_EVENT, { visible });
  };

  const openMiniPlayerWindow = async () => {
    clearMiniPlayerPrewarmTimer();

    // 立刻隐藏主窗口，避免小窗冷启动期间主窗口残留造成卡顿
    uiStore.mainWindowUiSleepRequested = true;
    await nextTick();
    await mainWindow.hide();

    const targetWindow = await ensureMiniPlayerWindow();
    await waitForMiniPlayerReady();
    await targetWindow.setAlwaysOnTop(true);
    await emitStateToMiniPlayer();
    isMiniPlayerWindowVisible.value = true;
    await emitMiniPlayerVisibility(true);
    await targetWindow.show();
  };

  const hideMiniPlayerWindow = async () => {
    await emitMiniPlayerVisibility(false);
    await destroyMiniPlayerWindow();
  };

  const destroyMiniPlayerWindow = async () => {
    const targetWindow = await getMiniPlayerWindow();
    if (!targetWindow) {
      isMiniPlayerWindowVisible.value = false;
      return;
    }

    try {
      await targetWindow.destroy();
    } catch (error) {
      console.warn('Failed to destroy mini player window:', error);
    } finally {
      miniPlayerWindowPromise = null;
      isMiniPlayerReady = false;
      miniPlayerReadyPromise = null;
      resolveMiniPlayerReady = null;
      resolveMiniPlayerStateApplied = null;
      isMiniPlayerWindowVisible.value = false;
    }
  };

  const revealMainWindowFromTray = async () => {
    // 从托盘恢复主窗口时，始终关闭小窗口（不保持可见）
    keepMiniPlayerVisibleOnMiniModeExit = false;
    uiStore.mainWindowUiSleepRequested = false;

    await restoreMainWindowFromMiniMode({
      isMiniMode,
      hideMiniPlayerWindow,
      keepMiniPlayerVisible: false,
      mainWindow,
      isImmersiveFullscreen: uiStore.isImmersiveFullscreen,
    });
  };

  const handleAction = async (action: MiniPlayerAction) => {
    switch (action.type) {
      case 'toggle-play':
        await togglePlay();
        break;
      case 'prev-song':
        prevSong();
        break;
      case 'next-song':
        nextSong();
        break;
      case 'set-volume':
        await handleVolume({ target: { value: String(action.volume) } } as unknown as Event);
        break;
      case 'toggle-mute':
        await toggleMute();
        break;
      case 'play-song':
        await playSong(action.song);
        break;
      case 'restore-main':
        uiStore.mainWindowUiSleepRequested = false;
        await restoreMainWindowFromMiniMode({
          isMiniMode,
          hideMiniPlayerWindow,
          mainWindow,
          isImmersiveFullscreen: uiStore.isImmersiveFullscreen,
        });
        break;
      case 'close':
        isMiniMode.value = false;
        uiStore.mainWindowUiSleepRequested = false;
        await hideMiniPlayerWindow();
        break;
      case 'seek':
        await seekTo(action.time);
        break;
      case 'toggle-favorite':
        if (currentSong.value) toggleFavorite(currentSong.value);
        break;
      case 'cycle-play-mode':
        toggleMode();
        break;
      case 'toggle-desktop-lyrics':
        showDesktopLyrics.value = !showDesktopLyrics.value;
        break;
      default:
        break;
    }
  };

  onMounted(async () => {
    unlisteners.push(await mainWindow.onCloseRequested(async (event) => {
      if (settings.value.closeToTray) return;
      if (isMainWindowClosing) return;

      isMainWindowClosing = true;
      event.preventDefault();
      await destroyMiniPlayerWindow();
      await mainWindow.close();
    }));

    unlisteners.push(await listen(MINI_PLAYER_REQUEST_STATE_EVENT, () => {
      void emitStateToMiniPlayer();
    }));

    unlisteners.push(await listen(APP_SHOW_MAIN_EVENT, () => {
      void revealMainWindowFromTray();
    }));

    unlisteners.push(await listen(MINI_PLAYER_READY_EVENT, () => {
      markMiniPlayerReady();
    }));

    unlisteners.push(await listen(MINI_PLAYER_STATE_APPLIED_EVENT, () => {
      resolveMiniPlayerStateApplied?.();
      resolveMiniPlayerStateApplied = null;
    }));

    unlisteners.push(await listen<MiniPlayerAction>(MINI_PLAYER_ACTION_EVENT, (event) => {
      void handleAction(event.payload);
    }));

    unlisteners.push(await listen<MiniPlayerWindowBounds>(MINI_PLAYER_BOUNDS_EVENT, (event) => {
      void writeMiniPlayerBounds(event.payload);
    }));

    // mini 窗口不再预热常驻：主窗口与 mini 窗口互切时应释放对方前端资源。
  });

  onUnmounted(() => {
    clearMiniPlayerPrewarmTimer();
    unlisteners.splice(0).forEach((unlisten) => unlisten());
  });

  watch(isMiniMode, async (visible) => {
    if (visible) {
      await openMiniPlayerWindow();
      return;
    }

    uiStore.mainWindowUiSleepRequested = false;

    if (keepMiniPlayerVisibleOnMiniModeExit) {
      keepMiniPlayerVisibleOnMiniModeExit = false;
      return;
    }

    await hideMiniPlayerWindow();
  });

  // [性能优化] 拆分原 deep watcher：
  // 原 watcher 同时监听 currentTime（60fps 变化）和 playQueue/tempQueue/songList（600+ 歌曲数组），
  // 并使用 deep:true，导致每帧 Vue traverse() 深度遍历所有歌曲对象的所有属性（O(n) per frame）。
  // 当播放队列含 600+ 在线歌曲时，仅此 watcher 每帧就产生数万次属性访问，叠加歌词渲染开销后导致卡顿。
  //
  // 拆为两个 watcher：
  // 1. 重量级 watcher：监听歌曲/队列/设置变化（不含 currentTime），去掉 deep:true
  // 2. 轻量级 watcher：仅监听 currentTime，节流发送进度更新
  watch(
    [
      currentSong,
      isPlaying,
      volume,
      playQueue,
      tempQueue,
      songList,
      isDarkTheme,
      () => currentLyricLine.value?.text,
      playMode,
      showDesktopLyrics,
    ],
    () => {
      if (!isMiniPlayerWindowVisible.value) return;
      void emitStateToMiniPlayer();
    },
  );

  // 轻量级进度 watcher：节流到每 250ms 最多发送一次，避免 60fps 全量状态序列化
  let lastProgressEmitMs = 0;
  const PROGRESS_EMIT_THROTTLE_MS = 250;
  watch(currentTime, () => {
    if (!isMiniPlayerWindowVisible.value) return;
    const now = performance.now();
    if (now - lastProgressEmitMs < PROGRESS_EMIT_THROTTLE_MS) return;
    lastProgressEmitMs = now;
    void emitStateToMiniPlayer();
  });
}
