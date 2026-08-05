import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { availableMonitors, getCurrentWindow } from '@tauri-apps/api/window';
import { storeToRefs } from 'pinia';
import { nextTick, onMounted, onUnmounted, watch } from 'vue';
import type { Router } from 'vue-router';

import { useLyrics } from './lyrics';
import { useThemeSettings } from './useThemeSettings';
import { useLibraryCollections } from '../features/collections/useLibraryCollections';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { usePlaybackStore } from '../features/playback/store';
import { useUiStore } from '../shared/stores/ui';
import {
  APP_TRAY_MENU_EVENT,
  APP_TRAY_MENU_OPEN_EVENT,
  handleTrayMenuAction,
  TRAY_MENU_READY_EVENT,
  TRAY_MENU_STATE_EVENT,
  TRAY_MENU_WINDOW_HEIGHT,
  TRAY_MENU_WINDOW_LABEL,
  TRAY_MENU_WINDOW_WIDTH,
  type TrayMenuAction,
  type TrayMenuStatePayload,
} from '../features/tray/actions';

interface TrayMenuOpenPayload {
  x: number;
  y: number;
}

let trayMenuWindowPromise: Promise<WebviewWindow> | null = null;
let isTrayMenuReady = false;
let trayMenuReadyPromise: Promise<void> | null = null;
let resolveTrayMenuReady: (() => void) | null = null;
let isTrayMenuSizeApplied = false;
let trayMenuSizePromise: Promise<void> | null = null;

const TRAY_MENU_PREWARM_DELAY_MS = 600;

async function getTrayMenuWindow() {
  return WebviewWindow.getByLabel(TRAY_MENU_WINDOW_LABEL);
}

async function ensureTrayMenuWindow() {
  const existing = await getTrayMenuWindow();
  if (existing) return existing;

  if (!trayMenuWindowPromise) {
    isTrayMenuReady = false;
    isTrayMenuSizeApplied = false;
    trayMenuSizePromise = null;
    trayMenuReadyPromise = null;
    resolveTrayMenuReady = null;
    const windowInstance = new WebviewWindow(TRAY_MENU_WINDOW_LABEL, {
      url: '/',
      title: 'XY-Music Tray Menu',
      width: TRAY_MENU_WINDOW_WIDTH,
      height: TRAY_MENU_WINDOW_HEIGHT,
      minWidth: TRAY_MENU_WINDOW_WIDTH,
      minHeight: TRAY_MENU_WINDOW_HEIGHT,
      maxWidth: TRAY_MENU_WINDOW_WIDTH,
      maxHeight: TRAY_MENU_WINDOW_HEIGHT,
      visible: false,
      decorations: false,
      transparent: true,
      shadow: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focus: false,
      focusable: true,
      center: false,
    });

    trayMenuWindowPromise = new Promise<WebviewWindow>((resolve, reject) => {
      let settled = false;

      void windowInstance.once('tauri://created', () => {
        if (settled) return;
        settled = true;
        trayMenuWindowPromise = null;
        resolve(windowInstance);
      });

      void windowInstance.once('tauri://error', (event) => {
        if (settled) return;
        settled = true;
        trayMenuWindowPromise = null;
        reject(event.payload);
      });
    });
  }

  return trayMenuWindowPromise;
}

function markTrayMenuReady() {
  isTrayMenuReady = true;
  resolveTrayMenuReady?.();
  resolveTrayMenuReady = null;
  trayMenuReadyPromise = null;
}

function resetTrayMenuWindowState() {
  trayMenuWindowPromise = null;
  isTrayMenuReady = false;
  trayMenuReadyPromise = null;
  resolveTrayMenuReady = null;
  isTrayMenuSizeApplied = false;
  trayMenuSizePromise = null;
}

function waitForTrayMenuReady(timeoutMs = 600) {
  if (isTrayMenuReady) {
    return Promise.resolve();
  }

  if (!trayMenuReadyPromise) {
    trayMenuReadyPromise = new Promise<void>((resolve) => {
      resolveTrayMenuReady = resolve;
      window.setTimeout(resolve, timeoutMs);
    });
  }

  return trayMenuReadyPromise;
}

async function ensureTrayMenuSize(targetWindow: WebviewWindow) {
  if (isTrayMenuSizeApplied) {
    return;
  }

  if (trayMenuSizePromise) {
    return trayMenuSizePromise;
  }

  const size = new LogicalSize(TRAY_MENU_WINDOW_WIDTH, TRAY_MENU_WINDOW_HEIGHT);
  trayMenuSizePromise = (async () => {
    await targetWindow.setMinSize(size);
    await targetWindow.setMaxSize(size);
    await targetWindow.setSize(size);
    isTrayMenuSizeApplied = true;
  })().finally(() => {
    trayMenuSizePromise = null;
  });

  return trayMenuSizePromise;
}

async function resolveTrayMenuPosition(payload: TrayMenuOpenPayload): Promise<LogicalPosition> {
  const monitors = await availableMonitors();
  const selectedMonitor = monitors.find((monitor) => {
    const { position, size } = monitor.workArea;
    return payload.x >= position.x
      && payload.x <= position.x + size.width
      && payload.y >= position.y
      && payload.y <= position.y + size.height;
  }) ?? monitors[0];

  if (!selectedMonitor) {
    return new LogicalPosition(
      payload.x - TRAY_MENU_WINDOW_WIDTH + 12,
      payload.y - TRAY_MENU_WINDOW_HEIGHT - 10,
    );
  }

  const scaleFactor = selectedMonitor.scaleFactor || 1;
  const workAreaPosition = selectedMonitor.workArea.position.toLogical(scaleFactor);
  const workAreaSize = selectedMonitor.workArea.size.toLogical(scaleFactor);
  const clickX = payload.x / scaleFactor;
  const clickY = payload.y / scaleFactor;

  const margin = 0;
  const maxX = workAreaPosition.x + workAreaSize.width - TRAY_MENU_WINDOW_WIDTH - margin;
  const minX = workAreaPosition.x + margin;
  const maxY = workAreaPosition.y + workAreaSize.height - TRAY_MENU_WINDOW_HEIGHT - margin;
  const minY = workAreaPosition.y + margin;
  const preferAboveY = clickY - TRAY_MENU_WINDOW_HEIGHT - margin;
  const fallbackBelowY = clickY + margin;
  const preferredX = clickX + 12 - TRAY_MENU_WINDOW_WIDTH;

  return new LogicalPosition(
    Math.round(Math.max(minX, Math.min(maxX, preferredX))),
    Math.round(Math.max(minY, Math.min(maxY, preferAboveY >= minY ? preferAboveY : fallbackBelowY))),
  );
}

const waitForRoutePaint = () => new Promise<void>((resolve) => {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => resolve());
  });
});

export function useTrayMenuEvents(router: Router) {
  const mainWindow = getCurrentWindow();
  const { currentSong, isPlaying, prevSong, togglePlay, nextSong, toggleMode } = usePlaybackController();
  const { showDesktopLyrics } = useLyrics();
  const { isDarkTheme, theme } = useThemeSettings();
  const libraryCollections = useLibraryCollections();
  const playbackStore = usePlaybackStore();
  const uiStore = useUiStore();
  const { playMode } = storeToRefs(playbackStore);
  const { isMiniMode, skipNextPageTransition } = storeToRefs(uiStore);

  let unlistenTrayMenu: UnlistenFn | null = null;
  let unlistenTrayMenuOpen: UnlistenFn | null = null;
  let unlistenTrayMenuReady: UnlistenFn | null = null;
  let stopTrayMenuStateWatch: (() => void) | null = null;
  let trayMenuPrewarmTimer: number | null = null;

  const createTrayMenuState = (): TrayMenuStatePayload => ({
    currentSong: currentSong.value,
    isPlaying: isPlaying.value,
    isDarkTheme: isDarkTheme.value,
    playMode: playMode.value,
    showDesktopLyrics: showDesktopLyrics.value,
    isFavorite: currentSong.value ? libraryCollections.isFavorite(currentSong.value) : false,
    isMiniMode: isMiniMode.value,
    useCustomTrayMenu: theme.value.useCustomTrayMenu,
    windowMaterial: theme.value.windowMaterial,
    windowBlurTint: theme.value.windowBlurTint,
  });

  const updateNativeTrayMenu = async () => {
    try {
      await invoke('update_native_tray_menu', { state: createTrayMenuState() });
    } catch (error) {
      console.warn('Failed to update native tray menu:', error);
    }
  };

  const emitTrayMenuState = async () => {
    if (!theme.value.useCustomTrayMenu) return;
    const targetWindow = await getTrayMenuWindow();
    if (!targetWindow) return;
    await emitTo<TrayMenuStatePayload>(
      TRAY_MENU_WINDOW_LABEL,
      TRAY_MENU_STATE_EVENT,
      createTrayMenuState(),
    );
  };

  const destroyTrayMenuWindow = async () => {
    const targetWindow = await getTrayMenuWindow();
    if (!targetWindow) {
      resetTrayMenuWindowState();
      return;
    }

    try {
      await targetWindow.destroy();
    } catch (error) {
      console.warn('Failed to destroy custom tray menu window:', error);
    } finally {
      resetTrayMenuWindowState();
    }
  };

  const revealMainWindow = async () => {
    await mainWindow.unminimize();
    await mainWindow.show();
    await mainWindow.setFocus();
  };

  const openSettings = async () => {
    skipNextPageTransition.value = true;
    try {
      if (router.currentRoute.value.path !== '/settings') {
        await router.replace('/settings');
      }
      await nextTick();
      await waitForRoutePaint();
    } finally {
      skipNextPageTransition.value = false;
    }
  };

  const prewarmTrayMenu = async () => {
    if (!theme.value.useCustomTrayMenu) return;

    try {
      const targetWindow = await ensureTrayMenuWindow();
      await waitForTrayMenuReady();
      await ensureTrayMenuSize(targetWindow);
      await emitTrayMenuState();
      await targetWindow.setAlwaysOnTop(true);
    } catch (error) {
      console.warn('Failed to prewarm tray menu window:', error);
    }
  };

  const scheduleTrayMenuPrewarm = () => {
    if (trayMenuPrewarmTimer !== null) {
      window.clearTimeout(trayMenuPrewarmTimer);
      trayMenuPrewarmTimer = null;
    }

    if (!theme.value.useCustomTrayMenu) return;

    trayMenuPrewarmTimer = window.setTimeout(() => {
      trayMenuPrewarmTimer = null;
      void prewarmTrayMenu();
    }, TRAY_MENU_PREWARM_DELAY_MS);
  };

  const openTrayMenu = async (payload: TrayMenuOpenPayload) => {
    if (!theme.value.useCustomTrayMenu) return;

    const targetWindow = await ensureTrayMenuWindow();
    await waitForTrayMenuReady();
    await ensureTrayMenuSize(targetWindow);
    const position = await resolveTrayMenuPosition(payload);
    await targetWindow.setAlwaysOnTop(true);
    await targetWindow.setPosition(position);
    await emitTo<TrayMenuStatePayload>(
      TRAY_MENU_WINDOW_LABEL,
      TRAY_MENU_STATE_EVENT,
      createTrayMenuState(),
    );
    await targetWindow.show();
    await targetWindow.setFocus();
  };

  const quitApp = () => invoke('exit_app');

  onMounted(async () => {
    await updateNativeTrayMenu();
    scheduleTrayMenuPrewarm();

    stopTrayMenuStateWatch = watch(
      createTrayMenuState,
      () => {
        void updateNativeTrayMenu();
        void emitTrayMenuState();

        if (theme.value.useCustomTrayMenu) {
          scheduleTrayMenuPrewarm();
        } else {
          if (trayMenuPrewarmTimer !== null) {
            window.clearTimeout(trayMenuPrewarmTimer);
            trayMenuPrewarmTimer = null;
          }
          void destroyTrayMenuWindow();
        }
      },
      { deep: true, flush: 'post' },
    );

    unlistenTrayMenu = await listen<TrayMenuAction>(APP_TRAY_MENU_EVENT, (event) => {
      void (async () => {
        await handleTrayMenuAction(event.payload, {
          prevSong,
          togglePlay,
          nextSong,
          playMode,
          cyclePlayMode: toggleMode,
          isMiniMode,
          showDesktopLyrics,
          revealMainWindow,
          openSettings,
          quitApp,
          toggleFavorite: () => {
            if (currentSong.value) {
              libraryCollections.toggleFavorite(currentSong.value);
            }
          },
        });
        await updateNativeTrayMenu();
        await emitTrayMenuState();
      })();
    });

    unlistenTrayMenuOpen = await listen<TrayMenuOpenPayload>(APP_TRAY_MENU_OPEN_EVENT, (event) => {
      void openTrayMenu(event.payload);
    });

    unlistenTrayMenuReady = await listen(TRAY_MENU_READY_EVENT, () => {
      markTrayMenuReady();
    });
  });

  onUnmounted(() => {
    if (trayMenuPrewarmTimer !== null) {
      window.clearTimeout(trayMenuPrewarmTimer);
      trayMenuPrewarmTimer = null;
    }

    stopTrayMenuStateWatch?.();
    unlistenTrayMenu?.();
    unlistenTrayMenuOpen?.();
    unlistenTrayMenuReady?.();
    stopTrayMenuStateWatch = null;
    unlistenTrayMenu = null;
    unlistenTrayMenuOpen = null;
    unlistenTrayMenuReady = null;
  });
}
