// 主窗口渲染功耗档位：根据窗口焦点 / 可见性 / 最小化 / 迷你模式推导快照，
// 供各渲染组件在低功耗场景下降频或暂停绘制。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { storeToRefs } from 'pinia';

import { useUiStore } from '../shared/stores/ui';

/** 主窗口渲染状态快照，各字段由事件与轮询共同维护 */
export type MainWindowRenderingSnapshot = {
  documentHidden: boolean;
  windowFocused: boolean;
  windowVisible: boolean;
  windowMinimized: boolean;
  miniMode: boolean;
};

const initialSnapshot = (): MainWindowRenderingSnapshot => ({
  // SSR / 非浏览器环境下默认页面未被隐藏
  documentHidden: typeof document !== 'undefined' ? document.hidden : false,
  windowFocused: true, windowVisible: true,
  windowMinimized: false, miniMode: false,
});

const snapshotRef = ref<MainWindowRenderingSnapshot>(initialSnapshot());

/** 处于正常前台播放状态（未隐藏、可见、未最小化、非迷你模式） */
function isActiveRendering(snapshot: MainWindowRenderingSnapshot): boolean {
  return !snapshot.documentHidden
    && snapshot.windowVisible
    && !snapshot.windowMinimized
    && !snapshot.miniMode;
}

/** 判定主窗口当前是否应进入低功耗渲染 */
export function resolveMainWindowLowPower(snapshot: MainWindowRenderingSnapshot) {
  return !isActiveRendering(snapshot);
}

/** 合并式更新模块级渲染快照（仅覆盖传入的字段） */
export function setMainWindowRenderingSnapshot(patch: Partial<MainWindowRenderingSnapshot>) {
  snapshotRef.value = Object.assign({}, snapshotRef.value, patch);
}

const isMainWindowLowPower = computed(() => resolveMainWindowLowPower(snapshotRef.value));

/** 读取渲染快照与低功耗状态的共享入口 */
export function useRenderingPower() {
  return {
    mainWindowRenderingSnapshot: snapshotRef,
    isMainWindowLowPower,
  };
}

/** 在主窗口挂载：监听焦点 / 尺寸 / 页面可见性变化并维护快照 */
export function useMainWindowRenderingPower() {
  const appWindow = getCurrentWindow();
  const { isMiniMode } = storeToRefs(useUiStore());
  const disposers: Array<() => void> = [];
  const trackDisposer = (dispose: () => void) => {
    disposers.push(dispose);
  };

  const applyDocumentVisibility = () => {
    setMainWindowRenderingSnapshot({ documentHidden: document.hidden });
  };

  const pullWindowState = async () => {
    try {
      const [windowFocused, windowVisible, windowMinimized] = await Promise.all([
        appWindow.isFocused(), appWindow.isVisible(), appWindow.isMinimized(),
      ]);
      setMainWindowRenderingSnapshot({ windowFocused, windowVisible, windowMinimized });
    } catch {
      // 窗口状态查询失败时保留现有快照
    }
  };

  onMounted(async () => {
    document.addEventListener('visibilitychange', applyDocumentVisibility);
    window.addEventListener('focus', pullWindowState);
    window.addEventListener('blur', pullWindowState);

    applyDocumentVisibility();
    await pullWindowState();

    trackDisposer(await appWindow.onFocusChanged(({ payload }) => {
      setMainWindowRenderingSnapshot({ windowFocused: payload });
      void pullWindowState();
    }));
    trackDisposer(await appWindow.onResized(() => {
      void pullWindowState();
    }));

    void pullWindowState();

    // 挂载后再延迟校正一次，规避启动初期窗口状态尚未同步完成的情况。
    const lateCorrection = setTimeout(() => {
      void pullWindowState();
    }, 1000);
    trackDisposer(() => clearTimeout(lateCorrection));
  });

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', applyDocumentVisibility);
    window.removeEventListener('focus', pullWindowState);
    window.removeEventListener('blur', pullWindowState);
    disposers.splice(0).forEach((dispose) => dispose());
  });

  watch(isMiniMode, (miniMode) => {
    setMainWindowRenderingSnapshot({ miniMode });
  }, { immediate: true });

  return useRenderingPower();
}
