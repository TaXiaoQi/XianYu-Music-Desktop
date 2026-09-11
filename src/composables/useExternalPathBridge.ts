import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { onMounted, onUnmounted, ref } from 'vue';
import { appApi } from '../services/tauri/appApi';
import { importPluginScriptsFromPaths } from '../services/domain/pluginImport';
import { usePlaybackStore } from '../features/playback/store';
import { modalDragInterceptActive } from './dragState';

type ExternalPathSource = 'drop' | 'open';

/** 带 scheme 的 URL（如 xianyu:// 深链）绝不可能是本地文件路径：
    过滤掉，避免深链被误当「外部打开的文件」，触发导入失败提示。 */
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** 插件脚本（.js/.json）：系统「打开方式」（文件关联）进来的路径走插件导入
    管线，不进音乐库（音乐库解析 .js 会报「没有找到可导入的音乐文件」）。 */
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
      // 过滤带 scheme 的 URL：深链等协议参数不是本地文件，直接放行到深链通道消费
      const localPaths = paths.filter((p) => !URL_SCHEME_RE.test((p || '').trim()));
      if (localPaths.length > 0) {
        // 插件脚本与音频分流：脚本走插件导入（对齐移动端「用客户端打开导入」），
        // 其余交给音乐库外部路径处理。
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
      // 弹窗拦截拖放时，跳过全局处理
      if (modalDragInterceptActive.value) return;
      const paths = event.payload?.paths ?? [];
      // 跳过纯插件文件（.js/.json），避免音乐库处理报错
      if (paths.length > 0 && paths.every(p => {
        const lower = p.toLowerCase();
        return lower.endsWith('.js') || lower.endsWith('.json');
      })) {
        return;
      }
      await enqueueExternalPaths(paths, 'drop');
    });

    unlistenDragOver = await listen('tauri://drag-over', () => {
      // 弹窗拦截时也跳过全局 drag-over 状态
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
