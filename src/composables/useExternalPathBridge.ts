import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { onMounted, onUnmounted, ref } from 'vue';
import { appApi } from '../services/tauri/appApi';
import { importPluginScriptsFromPaths } from '../services/domain/pluginImport';
import { usePlaybackStore } from '../features/playback/store';
import { useSettingsStore } from '../features/settings/store';
import { useUiStore } from '../shared/stores/ui';
import { modalDragInterceptActive } from './dragState';

type ExternalPathSource = 'drop' | 'open';

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

const PLUGIN_SCRIPT_RE = /\.(js|json)$/i;

interface UseExternalPathBridgeOptions {
  handleExternalPaths: (paths: string[], options?: { source?: ExternalPathSource }) => Promise<void>;
  beforeWindowShow?: () => Promise<unknown>;
  afterWindowShow?: () => Promise<unknown> | void;
}

interface StartupWindow {
  show: () => Promise<unknown>;
  setFocus: () => Promise<unknown>;
}

interface StartupWindowHooks {
  beforeShow?: () => Promise<unknown>;
  afterShow?: () => Promise<unknown> | void;
}

export async function showMainWindowAfterStartup(
  appWindow: StartupWindow,
  hooks: StartupWindowHooks = {},
) {
  await hooks.beforeShow?.();
  await appWindow.show();
  await appWindow.setFocus();
  await hooks.afterShow?.();
}

export function useExternalPathBridge({
  handleExternalPaths,
  beforeWindowShow,
  afterWindowShow,
}: UseExternalPathBridgeOptions) {
  const playbackStore = usePlaybackStore();
  const settingsStore = useSettingsStore();
  const uiStore = useUiStore();
  const isExternalDragActive = ref(false);
  let externalPathTask: Promise<void> = Promise.resolve();
  let unlistenDragDrop: (() => void) | null = null;
  let unlistenDragOver: (() => void) | null = null;
  let unlistenDragLeave: (() => void) | null = null;
  let unlistenOpenPaths: (() => void) | null = null;

  const enqueueExternalPaths = (paths: string[], source: ExternalPathSource) => {
    externalPathTask = externalPathTask
      .then(() => handleExternalPaths(paths, { source }))
      .catch((error) => {
        console.error('Failed to process external paths:', error);
      });

    return externalPathTask;
  };

  const consumePendingOpenPaths = async (options: { startup?: boolean } = {}) => {
    try {
      const paths = await appApi.consumePendingOpenPaths();
      const localPaths = paths.filter((p) => !URL_SCHEME_RE.test((p || '').trim()));
      if (localPaths.length > 0) {
        const pluginScripts = localPaths.filter((p) => PLUGIN_SCRIPT_RE.test((p || '').trim()));
        const audioPaths = localPaths.filter((p) => !PLUGIN_SCRIPT_RE.test((p || '').trim()));
        if (pluginScripts.length > 0) {
          await importPluginScriptsFromPaths(pluginScripts);
        }
        if (audioPaths.length > 0) {
          if (options.startup) {
            playbackStore.markExternalStartupFile();
          }
          await enqueueExternalPaths(audioPaths, 'open');
        }
      }
    } catch (error) {
      console.error('Failed to consume pending open paths:', error);
    } finally {
      if (options.startup) {
        playbackStore.markStartupPathsResolved();
      }
    }
  };

  onMounted(async () => {
    unlistenDragDrop = await listen<{ paths: string[] }>('tauri://drag-drop', async (event) => {
      isExternalDragActive.value = false;
      if (modalDragInterceptActive.value) return;
      const paths = event.payload?.paths ?? [];
      if (paths.length > 0 && paths.every(p => {
        const lower = p.toLowerCase();
        return lower.endsWith('.js') || lower.endsWith('.json');
      })) {
        return;
      }
      await enqueueExternalPaths(paths, 'drop');
    });

    unlistenDragOver = await listen('tauri://drag-over', () => {
      if (modalDragInterceptActive.value) return;
      isExternalDragActive.value = true;
    });

    unlistenDragLeave = await listen('tauri://drag-leave', () => {
      isExternalDragActive.value = false;
    });

    unlistenOpenPaths = await listen('app:open-paths', async () => {
      await consumePendingOpenPaths();
    });

    await consumePendingOpenPaths({ startup: true });

    // 开机自启且用户勾选了「启动时最小化到托盘」：不显示主窗口，改走托盘睡眠路径。
    // 直接置 uiStore.mainWindowUiSleepRequested，复用 App.vue 里 enterTraySleep 的同一套簿记
    // （渲染快照 + 缓存释放由 App.vue 的 watch 处理，不会因绕过 show() 而漏掉）。
    const launchedAtStartup = await appApi.wasLaunchedAtStartup().catch(() => false);
    if (launchedAtStartup && settingsStore.settings.launchOnStartupMinimized) {
      uiStore.mainWindowUiSleepRequested = true;
      await getCurrentWindow().hide();
      return;
    }

    try {
      const appWindow = getCurrentWindow();
      await showMainWindowAfterStartup(appWindow, {
        beforeShow: beforeWindowShow,
        afterShow: afterWindowShow,
      });
    } catch (error) {
      console.error('Failed to show window on startup:', error);
    }
  });

  onUnmounted(() => {
    unlistenDragDrop?.();
    unlistenDragOver?.();
    unlistenDragLeave?.();
    unlistenOpenPaths?.();
  });

  return {
    isExternalDragActive,
  };
}
