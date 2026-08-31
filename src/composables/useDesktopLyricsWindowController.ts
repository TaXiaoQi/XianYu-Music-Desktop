import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow, availableMonitors, currentMonitor, cursorPosition } from '@tauri-apps/api/window';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { computed, onMounted, onUnmounted, ref, watch, type CSSProperties, type Ref } from 'vue';

import { loadSystemLyricsFonts } from './lyrics';
import {
  DESKTOP_LYRICS_BOUNDS_EVENT,
  DESKTOP_LYRICS_PLAYBACK_EVENT,
  DESKTOP_LYRICS_READY_EVENT,
  DESKTOP_LYRICS_REVEAL_SURFACE_EVENT,
  DESKTOP_LYRICS_REQUEST_STATE_EVENT,
  DESKTOP_LYRICS_STATE_EVENT,
  DESKTOP_LYRICS_VISIBILITY_EVENT,
  type DesktopLyricsPlaybackPayload,
  type DesktopLyricsStatePayload,
  type DesktopLyricsWindowBounds,
  type DesktopLyricsWindowSettings,
} from '../features/desktopLyrics/shared';
import { windowApi } from '../services/tauri/windowApi';
import { sessionApi, type PlaybackSessionChangedPayload } from '../services/tauri/sessionApi';

const FULLSCREEN_POLL_INTERVAL_MS = 300;
const RESIZE_VISIBILITY_HOLD_MS = 1200;

export function shouldAutoHideDesktopLyrics({
  autoHideWhenFullscreen,
  autoHideWhenPaused,
  isForegroundFullscreen,
  isPlaying,
  isResizeInteractionActive,
}: {
  autoHideWhenFullscreen: boolean;
  autoHideWhenPaused: boolean;
  isForegroundFullscreen: boolean;
  isPlaying: boolean;
  isResizeInteractionActive: boolean;
}) {
  if (isResizeInteractionActive) {
    return false;
  }

  return (autoHideWhenFullscreen && isForegroundFullscreen)
    || (autoHideWhenPaused && !isPlaying);
}

export function useDesktopLyricsWindowController(options: {
  showDragShadow: Ref<boolean>;
  settings: Ref<DesktopLyricsWindowSettings>;
  playbackTime: Ref<number>;
  isPlaying: Ref<boolean>;
  handlePayload: (payload: DesktopLyricsStatePayload) => void;
  handlePlaybackPayload: (payload: DesktopLyricsPlaybackPayload) => void;
}) {
  const {
    showDragShadow,
    settings,
    playbackTime,
    isPlaying,
    handlePayload,
    handlePlaybackPayload,
  } = options;

  const appWindow = getCurrentWindow();
  let isApplyingCenterPosition = false;
  let centerPositionFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let centerPositionDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // --- 窗口隐藏时暂停资源 ---
  // 桌面歌词窗口是独立 WebView，关闭时调用 appWindow.hide() 而非销毁。
  // 隐藏后 rAF 和所有定时器仍会持续运行，浪费 CPU 和 IPC 调用。
  // 通过 document.visibilitychange 检测窗口隐藏/显示，暂停/恢复所有循环。
  let isWindowHidden = false;

  function handleVisibilityChange() {
    const hidden = document.hidden;
    if (hidden === isWindowHidden) return;
    isWindowHidden = hidden;

    if (hidden) {
      // 窗口隐藏：暂停所有循环
      stopPlaybackClock();
      stopAutoHideLoop();
      stopLockPolling();
    } else {
      // 窗口恢复：重新启动循环
      startPlaybackClock();
      startAutoHideLoop();
      if (settings.value.isLocked && !isAutoHidden.value) {
        startLockPolling();
      }
    }
  }

  async function forceCenterHorizontally() {
    if (isApplyingCenterPosition) return;
    try {
      let monitor = await currentMonitor();
      if (!monitor) {
        const monitors = await availableMonitors();
        if (monitors.length > 0) {
          monitor = monitors[0];
        }
      }
      if (!monitor) return;

      const workArea = monitor.workArea;
      const size = await appWindow.outerSize();
      const position = await appWindow.outerPosition();
      const targetX = workArea.position.x + Math.round((workArea.size.width - size.width) / 2);

      if (Math.abs(position.x - targetX) > 1) {
        isApplyingCenterPosition = true;
        if (centerPositionFallbackTimer) {
          clearTimeout(centerPositionFallbackTimer);
        }
        centerPositionFallbackTimer = setTimeout(() => {
          isApplyingCenterPosition = false;
          centerPositionFallbackTimer = null;
        }, 300);

        try {
          await appWindow.setPosition(new PhysicalPosition(targetX, position.y));
        } catch (err) {
          console.warn('Failed to call setPosition:', err);
          isApplyingCenterPosition = false;
          if (centerPositionFallbackTimer) {
            clearTimeout(centerPositionFallbackTimer);
            centerPositionFallbackTimer = null;
          }
        }

        await emitWindowBounds({
          x: targetX,
          y: position.y,
          width: size.width,
          height: size.height,
        });
      }
    } catch (error) {
      console.warn('Failed to force center horizontally:', error);
      isApplyingCenterPosition = false;
      if (centerPositionFallbackTimer) {
        clearTimeout(centerPositionFallbackTimer);
        centerPositionFallbackTimer = null;
      }
    }
  }
  const isSystemHidden = ref(false);
  // 面板表面（背景 + 控件）的自动隐藏：鼠标在窗口内时可见，移出后隐藏，
  // 仅剩歌词文字。拖动/调整大小期间与「常驻背景」开启时常显。
  const isPointerInside = ref(false);
  const isResizeInteractionActive = ref(false);
  const isCursorOverLockButton = ref(false);
  let lockPollingTimer: ReturnType<typeof setInterval> | null = null;

  const isAutoHidden = computed(() => shouldAutoHideDesktopLyrics({
    autoHideWhenFullscreen: settings.value.autoHideWhenFullscreen,
    autoHideWhenPaused: settings.value.autoHideWhenPaused,
    isForegroundFullscreen: isSystemHidden.value,
    isPlaying: isPlaying.value,
    isResizeInteractionActive: isResizeInteractionActive.value,
  }));

  const isSurfaceVisible = computed(() => {
    if (settings.value.isLocked) return false;
    return isPointerInside.value
      || showDragShadow.value
      || isResizeInteractionActive.value
      || settings.value.alwaysShowShadowBackground;
  });

  let toolbarHideTimer: ReturnType<typeof setTimeout> | null = null;
  let autoHideTimer: ReturnType<typeof setInterval> | null = null;
  let resizeVisibilityTimer: ReturnType<typeof setTimeout> | null = null;
  let frameId = 0;
  let dragShadowTimer: ReturnType<typeof setTimeout> | null = null;
  let unlistenState: (() => void) | null = null;
  let unlistenPlayback: (() => void) | null = null;
  let unlistenRevealSurface: (() => void) | null = null;
  let unlistenCloseRequested: (() => void) | null = null;
  let unlistenMoved: (() => void) | null = null;
  let unlistenResized: (() => void) | null = null;
  let unlistenSessionChanged: (() => void) | null = null;

  function startPlaybackClock() {
    stopPlaybackClock();

    let lastTime = performance.now();
    const tick = (now: number) => {
      if (isPlaying.value) {
        playbackTime.value += (now - lastTime) / 1000;
      }

      lastTime = now;
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
  }

  function stopPlaybackClock() {
    if (frameId !== 0) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
  }

  function startAutoHideLoop() {
    stopAutoHideLoop();

    const pollForegroundFullscreen = async () => {
      if (isResizeInteractionActive.value) {
        isSystemHidden.value = false;
        return;
      }

      if (!settings.value.autoHideWhenFullscreen) {
        isSystemHidden.value = false;
        return;
      }

      try {
        const state = await windowApi.getForegroundFullscreenState();
        isSystemHidden.value = state.isFullscreen;
      } catch {
        isSystemHidden.value = false;
      }
    };

    autoHideTimer = setInterval(async () => {
      await pollForegroundFullscreen();
    }, FULLSCREEN_POLL_INTERVAL_MS);

    void pollForegroundFullscreen();
  }

  function stopAutoHideLoop() {
    if (autoHideTimer) {
      clearInterval(autoHideTimer);
      autoHideTimer = null;
    }
  }

  async function checkLockCursorProximity() {
    if (!settings.value.isLocked) return;
    try {
      const position = await cursorPosition(); // Global physical coordinates
      const winPos = await appWindow.outerPosition(); // Window physical coordinates
      const size = await appWindow.outerSize(); // Window physical size
      const scaleFactor = await appWindow.scaleFactor();

      const W = size.width;
      const x = position.x - winPos.x;
      const y = position.y - winPos.y;

      const toleranceY = 80 * scaleFactor;
      const toleranceX = 56 * scaleFactor;

      const centerX = W / 2;
      const isOver = y >= 0 && y <= toleranceY && x >= centerX - toleranceX && x <= centerX + toleranceX;

      if (isOver !== isCursorOverLockButton.value) {
        isCursorOverLockButton.value = isOver;
        await applyTransientWindowFlags();
      }
    } catch (err) {
      console.warn('Failed to check cursor proximity:', err);
    }
  }

  function startLockPolling() {
    stopLockPolling();
    lockPollingTimer = setInterval(() => {
      void checkLockCursorProximity();
    }, 80);
  }

  function stopLockPolling() {
    if (lockPollingTimer) {
      clearInterval(lockPollingTimer);
      lockPollingTimer = null;
    }
    isCursorOverLockButton.value = false;
  }

  async function applyTransientWindowFlags() {
    const shouldIgnoreCursor = (settings.value.isLocked && !isCursorOverLockButton.value) || isAutoHidden.value;
    await appWindow.setIgnoreCursorEvents(shouldIgnoreCursor);
    await appWindow.setFocusable(!shouldIgnoreCursor);
  }

  async function applyAlwaysOnTopState(enabled: boolean) {
    await appWindow.setAlwaysOnTop(enabled);
    await windowApi.refreshCurrentWindowTopmost(enabled);

    if (enabled) {
      await windowApi.startTopmostGuard();
      return;
    }

    await windowApi.stopTopmostGuard();
  }

  function clearToolbarHideTimer() {
    if (toolbarHideTimer) {
      clearTimeout(toolbarHideTimer);
      toolbarHideTimer = null;
    }
  }

  function clearResizeVisibilityTimer() {
    if (resizeVisibilityTimer) {
      clearTimeout(resizeVisibilityTimer);
      resizeVisibilityTimer = null;
    }
  }

  function holdVisibleForResize() {
    clearResizeVisibilityTimer();
    clearToolbarHideTimer();

    isResizeInteractionActive.value = true;
    isSystemHidden.value = false;
    revealDragShadow();

    resizeVisibilityTimer = setTimeout(() => {
      isResizeInteractionActive.value = false;
      resizeVisibilityTimer = null;
    }, RESIZE_VISIBILITY_HOLD_MS);
  }

  /** 鼠标移出后延迟把面板表面收起（自动隐藏），短暂滑出不闪烁。 */
  function hideSurfaceAfterLeave(delay = 180) {
    clearToolbarHideTimer();

    toolbarHideTimer = setTimeout(() => {
      isPointerInside.value = false;
      toolbarHideTimer = null;
    }, delay);
  }

  function revealDragShadow() {
    showDragShadow.value = true;

    if (dragShadowTimer) {
      clearTimeout(dragShadowTimer);
    }

    dragShadowTimer = setTimeout(() => {
      showDragShadow.value = false;
      dragShadowTimer = null;
    }, 1500);
  }

  function handlePointerEnter() {
    if (settings.value.isLocked) {
      return;
    }
    clearToolbarHideTimer();
    isPointerInside.value = true;
  }

  function handlePointerMove() {
    if (settings.value.isLocked) {
      return;
    }

    clearToolbarHideTimer();
    isPointerInside.value = true;
  }

  function handlePointerLeave() {
    if (settings.value.isLocked) {
      return;
    }

    if (isResizeInteractionActive.value) {
      return;
    }

    // 自动隐藏：移出后稍作延迟收起面板（背景 + 控件），只留歌词文字。
    hideSurfaceAfterLeave();
  }

  async function startWindowDrag(event: MouseEvent) {
    if (settings.value.isLocked || isAutoHidden.value) return;
    if ((event.target as HTMLElement).closest('button, .settings-menu')) return;

    revealDragShadow();
    await appWindow.startDragging();
  }

  async function emitWindowBounds(bounds: DesktopLyricsWindowBounds) {
    await emitTo<DesktopLyricsWindowBounds>('main', DESKTOP_LYRICS_BOUNDS_EVENT, bounds);
  }

  const widgetShellStyle = computed<CSSProperties>(() => ({
    opacity: isAutoHidden.value ? '0' : '1',
    transform: isAutoHidden.value ? 'scale(0.96)' : 'scale(1)',
    pointerEvents: isAutoHidden.value ? 'none' : 'auto',
  }));

  onMounted(async () => {
    startPlaybackClock();
    startAutoHideLoop();
    void loadSystemLyricsFonts();

    // 监听窗口可见性变化，隐藏时暂停资源
    document.addEventListener('visibilitychange', handleVisibilityChange);

    try {
      await appWindow.setBackgroundColor([0, 0, 0, 0]);
    } catch (error) {
      console.warn('Failed to force transparent background for desktop lyrics window:', error);
    }

    unlistenState = await appWindow.listen<DesktopLyricsStatePayload>(DESKTOP_LYRICS_STATE_EVENT, (event) => {
      handlePayload(event.payload);
    });

    unlistenPlayback = await appWindow.listen<DesktopLyricsPlaybackPayload>(DESKTOP_LYRICS_PLAYBACK_EVENT, (event) => {
      handlePlaybackPayload(event.payload);
    });

    unlistenRevealSurface = await appWindow.listen(DESKTOP_LYRICS_REVEAL_SURFACE_EVENT, () => {
      revealDragShadow();
    });

    revealDragShadow();

    unlistenCloseRequested = await appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await appWindow.hide();
      await emitTo('main', DESKTOP_LYRICS_VISIBILITY_EVENT, { visible: false });
    });

    unlistenMoved = await appWindow.onMoved(async ({ payload }) => {
      revealDragShadow();

      if (isApplyingCenterPosition) {
        isApplyingCenterPosition = false;
        if (centerPositionFallbackTimer) {
          clearTimeout(centerPositionFallbackTimer);
          centerPositionFallbackTimer = null;
        }
        const size = await appWindow.outerSize();
        await emitWindowBounds({
          x: payload.x,
          y: payload.y,
          width: size.width,
          height: size.height,
        });
        return;
      }

      const size = await appWindow.outerSize();
      let x = payload.x;

      if (settings.value.centerHorizontally) {
        if (centerPositionDebounceTimer) {
          clearTimeout(centerPositionDebounceTimer);
        }
        centerPositionDebounceTimer = setTimeout(async () => {
          centerPositionDebounceTimer = null;
          await forceCenterHorizontally();
        }, 300);
      }

      await emitWindowBounds({
        x,
        y: payload.y,
        width: size.width,
        height: size.height,
      });
    });

    unlistenResized = await appWindow.onResized(async ({ payload }) => {
      holdVisibleForResize();

      if (isApplyingCenterPosition) {
        isApplyingCenterPosition = false;
        if (centerPositionFallbackTimer) {
          clearTimeout(centerPositionFallbackTimer);
          centerPositionFallbackTimer = null;
        }
        const position = await appWindow.outerPosition();
        await emitWindowBounds({
          x: position.x,
          y: position.y,
          width: payload.width,
          height: payload.height,
        });
        return;
      }

      const position = await appWindow.outerPosition();
      let x = position.x;

      if (settings.value.centerHorizontally) {
        if (centerPositionDebounceTimer) {
          clearTimeout(centerPositionDebounceTimer);
        }
        centerPositionDebounceTimer = setTimeout(async () => {
          centerPositionDebounceTimer = null;
          await forceCenterHorizontally();
        }, 300);
      }

      await emitWindowBounds({
        x,
        y: position.y,
        width: payload.width,
        height: payload.height,
      });
    });

    // 从 Rust 会话获取初始核心播放状态（主窗口 emitTo 到达前的即时数据）
    try {
      const session = await sessionApi.getPlaybackSession();
      if (session && session.currentSongPath) {
        isPlaying.value = session.isPlaying;
        playbackTime.value = session.currentPositionSecs;
      }
    } catch { /* ignore - emitTo will provide full state */ }

    // 监听 Rust 会话变更（主窗口不可用时的后备同步路径）
    unlistenSessionChanged = await listen<PlaybackSessionChangedPayload>(
      'playback:session-changed',
      (event) => {
        const data = event.payload;
        isPlaying.value = data.isPlaying;
        playbackTime.value = data.currentPositionSecs;
      },
    );

    try {
      await emitTo('main', DESKTOP_LYRICS_READY_EVENT);
      await emitTo('main', DESKTOP_LYRICS_REQUEST_STATE_EVENT);
    } catch (error) {
      console.warn('Failed to notify main window that desktop lyrics is ready:', error);
    }
  });

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    stopLockPolling();
    stopPlaybackClock();
    stopAutoHideLoop();
    clearToolbarHideTimer();
    clearResizeVisibilityTimer();
    unlistenState?.();
    unlistenPlayback?.();
    unlistenRevealSurface?.();
    unlistenCloseRequested?.();
    unlistenMoved?.();
    unlistenResized?.();
    unlistenSessionChanged?.();
    void windowApi.stopTopmostGuard();

    if (centerPositionFallbackTimer) {
      clearTimeout(centerPositionFallbackTimer);
      centerPositionFallbackTimer = null;
    }

    if (centerPositionDebounceTimer) {
      clearTimeout(centerPositionDebounceTimer);
      centerPositionDebounceTimer = null;
    }

    if (dragShadowTimer) {
      clearTimeout(dragShadowTimer);
      dragShadowTimer = null;
    }
  });

  watch(
    () => [settings.value.isLocked, isAutoHidden.value],
    () => {
      if (settings.value.isLocked) {
        clearToolbarHideTimer();
        isPointerInside.value = false;
        if (!isAutoHidden.value) {
          startLockPolling();
        } else {
          stopLockPolling();
        }
      } else {
        stopLockPolling();
      }
      void applyTransientWindowFlags();
    },
    { immediate: true },
  );

  watch(
    () => settings.value.autoHideWhenFullscreen,
    (enabled) => {
      if (!enabled) {
        isSystemHidden.value = false;
      }
    },
  );

  watch(
    () => settings.value.isAlwaysOnTop,
    (enabled) => {
      void applyAlwaysOnTopState(enabled);
    },
    { immediate: true },
  );

  watch(
    () => settings.value.centerHorizontally,
    (enabled) => {
      if (enabled) {
        void forceCenterHorizontally();
      }
    },
  );

  return {
    showDragShadow,
    isSystemHidden,
    isSurfaceVisible,
    isCursorOverLockButton,
    widgetShellStyle,
    handlePointerEnter,
    handlePointerMove,
    handlePointerLeave,
    startWindowDrag,
  };
}
