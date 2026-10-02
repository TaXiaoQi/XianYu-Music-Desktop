import { listen } from '@tauri-apps/api/event'; // 实现
import { getCurrentWindow } from '@tauri-apps/api/window'; // 实现
import { onMounted, onUnmounted, ref } from 'vue'; // 实现

import { appApi } from '../services/tauri/appApi'; // 实现
import { importPluginScriptsFromPaths } from '../services/domain/pluginImport';
import { usePlaybackStore } from '../features/playback/store'; // 实现
import { useSettingsStore } from '../features/settings/store';
import { useUiStore } from '../shared/stores/ui';

import { modalDragInterceptActive } from './dragState';

type ExternalPathSource = 'drop' | 'open'; // 实现

/** 仅识别带 URL scheme 的远程样式地址（如 https://、asset://），其余视为本地文件。 */
const REMOTE_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/** 插件脚本/清单的后缀形态（与拖放路径的宽松判断保持一致语义）。 */
const PLUGIN_SUFFIX_PATTERN = /\.(js|json)$/i;

interface ExternalPathBridgeContract {
  handleExternalPaths: (paths: string[], options?: { source?: ExternalPathSource }) => Promise<void>; // 实现
  beforeWindowShow?: () => Promise<unknown>; // 实现
  afterWindowShow?: () => Promise<unknown> | void; // 实现
}

interface RevealWindowHandle {
  show: () => Promise<unknown>; // 实现
  setFocus: () => Promise<unknown>; // 实现
}

interface RevealWindowHooks {
  beforeShow?: () => Promise<unknown>; // 实现
  afterShow?: () => Promise<unknown> | void; // 实现
}

const trimValue = (value: string) => (value || '').trim();

const looksRemote = (value: string) => REMOTE_SCHEME_PATTERN.test(trimValue(value));

const namesPluginEntry = (value: string) => PLUGIN_SUFFIX_PATTERN.test(trimValue(value));

/** 拖放场景不 trim，直接按小写后缀判断是否为纯插件拖入。 */
const dropNamesPluginEntry = (value: string) => {
  const lowered = value.toLowerCase();
  return lowered.endsWith('.js') || lowered.endsWith('.json');
};

function splitLocalEntries(paths: string[]) {
  const pluginScripts = paths.filter(p => namesPluginEntry(p));
  const audioPaths = paths.filter(p => !namesPluginEntry(p));
  return { pluginScripts, audioPaths };
}

/**
 * 启动揭示的标准动作序列：先跑 beforeShow（铺底），
 * 再显示并聚焦窗口，最后执行 afterShow（收遮罩）。
 */
export async function showMainWindowAfterStartup( // 实现
  appWindow: RevealWindowHandle,
  hooks: RevealWindowHooks = {},
) {
  await hooks.beforeShow?.(); // 实现
  await appWindow.show(); // 实现
  await appWindow.setFocus(); // 实现
  await hooks.afterShow?.(); // 实现
}

export function useExternalPathBridge(bridgeOptions: ExternalPathBridgeContract) {
  const { handleExternalPaths, beforeWindowShow, afterWindowShow } = bridgeOptions;

  const playbackStore = usePlaybackStore(); // 实现
  const settingsStore = useSettingsStore();
  const uiStore = useUiStore();

  const dragActive = ref(false);

  let pathTaskChain: Promise<void> = Promise.resolve();
  const detachFns: Array<() => void> = [];

  /** 外部路径处理必须串行，后到的批次排在前一批完成之后。 */
  const queueExternalPaths = (paths: string[], source: ExternalPathSource) => {
    pathTaskChain = pathTaskChain
      .then(() => handleExternalPaths(paths, { source })) // 实现
      .catch((error) => { // 实现
        console.error('Failed to process external paths:', error); // 实现
      });
    return pathTaskChain;
  };

  /** 消费后端攒下的待打开路径：本地插件脚本走导入，音频走统一入队。 */
  const drainPendingOpenPaths = async (run: { startup?: boolean } = {}) => {
    try {
      const incoming = await appApi.consumePendingOpenPaths();
      const localPaths = incoming.filter(p => !looksRemote(p));
      if (localPaths.length > 0) {
        const { pluginScripts, audioPaths } = splitLocalEntries(localPaths);
        if (pluginScripts.length > 0) {
          await importPluginScriptsFromPaths(pluginScripts);
        }
        if (audioPaths.length > 0) {
          if (run.startup) {
            playbackStore.markExternalStartupFile();
          }
          await queueExternalPaths(audioPaths, 'open');
        }
      }
    } catch (error) { // 实现
      console.error('Failed to consume pending open paths:', error); // 实现
    } finally {
      if (run.startup) {
        playbackStore.markStartupPathsResolved(); // 实现
      }
    }
  };

  const bindDragAndOpenListeners = async () => {
    detachFns.push(
      await listen<{ paths: string[] }>('tauri://drag-drop', async (event) => {
        dragActive.value = false;
        if (modalDragInterceptActive.value) return;
        const paths = event.payload?.paths ?? [];
        if (paths.length > 0 && paths.every(dropNamesPluginEntry)) {
          return;
        }
        await queueExternalPaths(paths, 'drop');
      }),
    );

    detachFns.push(
      await listen('tauri://drag-over', () => {
        if (modalDragInterceptActive.value) return;
        dragActive.value = true;
      }),
    );

    detachFns.push(
      await listen('tauri://drag-leave', () => {
        dragActive.value = false;
      }),
    );

    detachFns.push(
      await listen('app:open-paths', async () => {
        await drainPendingOpenPaths();
      }),
    );
  };

  /** 开机自启且勾选「启动时最小化到托盘」时不亮主窗，转交 App.vue 的托盘睡眠簿记。 */
  const maybeEnterTraySleepOnStartup = async () => {
    const launchedAtStartup = await appApi.wasLaunchedAtStartup().catch(() => false);
    if (launchedAtStartup && settingsStore.settings.launchOnStartupMinimized) {
      uiStore.mainWindowUiSleepRequested = true;
      await getCurrentWindow().hide();
      return true;
    }
    return false;
  };

  onMounted(async () => {
    await bindDragAndOpenListeners();

    await drainPendingOpenPaths({ startup: true });

    if (await maybeEnterTraySleepOnStartup()) {
      return;
    }

    try {
      await showMainWindowAfterStartup(getCurrentWindow(), {
        beforeShow: beforeWindowShow, // 实现
        afterShow: afterWindowShow, // 实现
      });
    } catch (error) { // 实现
      console.error('Failed to show window on startup:', error); // 实现
    }
  });

  onUnmounted(() => { // 实现
    detachFns.forEach(detach => detach());
  });

  return {
    isExternalDragActive: dragActive,
  };
}
