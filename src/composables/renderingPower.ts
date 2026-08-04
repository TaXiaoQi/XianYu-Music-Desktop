import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { storeToRefs } from 'pinia';

import { useUiStore } from '../shared/stores/ui';

export interface MainWindowRenderingSnapshot {
  documentHidden: boolean;
  windowFocused: boolean;
  windowVisible: boolean;
  windowMinimized: boolean;
  miniMode: boolean;
}

const defaultSnapshot = (): MainWindowRenderingSnapshot => ({
  documentHidden: typeof document !== 'undefined' ? document.hidden : false,
  windowFocused: true,
  windowVisible: true,
  windowMinimized: false,
  miniMode: false,
});

const mainWindowRenderingSnapshot = ref<MainWindowRenderingSnapshot>(defaultSnapshot());

export function resolveMainWindowLowPower(snapshot: MainWindowRenderingSnapshot) {
  return !snapshot.windowVisible
    || snapshot.windowMinimized
    || snapshot.documentHidden
    || snapshot.miniMode;
}

export function setMainWindowRenderingSnapshot(patch: Partial<MainWindowRenderingSnapshot>) {
  mainWindowRenderingSnapshot.value = {
    ...mainWindowRenderingSnapshot.value,
    ...patch,
  };
}

const isMainWindowLowPower = computed(() => resolveMainWindowLowPower(mainWindowRenderingSnapshot.value));

export function useRenderingPower() {
  return {
    mainWindowRenderingSnapshot,
    isMainWindowLowPower,
  };
}

export function useMainWindowRenderingPower() {
  const appWindow = getCurrentWindow();
  const { isMiniMode } = storeToRefs(useUiStore());
  const unlisteners: Array<() => void> = [];

  const syncDocumentVisibility = () => {
    setMainWindowRenderingSnapshot({ documentHidden: document.hidden });
  };

  const syncWindowState = async () => {
    try {
      const [windowFocused, windowVisible, windowMinimized] = await Promise.all([
        appWindow.isFocused(),
        appWindow.isVisible(),
        appWindow.isMinimized(),
      ]);

      setMainWindowRenderingSnapshot({
        windowFocused,
        windowVisible,
        windowMinimized,
      });
    } catch {}
  };

  onMounted(async () => {
    // Register sync listeners FIRST, before any async operations.
    // During startup, useExternalPathBridge calls appWindow.show() + setFocus()
    // which may fire before async listeners (onFocusChanged) are set up.
    // The synchronous window.addEventListener('focus') catches this case.
    document.addEventListener('visibilitychange', syncDocumentVisibility);
    window.addEventListener('focus', syncWindowState);
    window.addEventListener('blur', syncWindowState);

    syncDocumentVisibility();
    await syncWindowState();

    unlisteners.push(await appWindow.onFocusChanged(({ payload }) => {
      setMainWindowRenderingSnapshot({ windowFocused: payload });
      void syncWindowState();
    }));
    unlisteners.push(await appWindow.onResized(() => {
      void syncWindowState();
    }));

    // Re-sync after all listeners are set up. The window may have been
    // shown/focused during the async setup above, and the initial
    // syncWindowState() may have captured a stale (not-yet-visible) state.
    void syncWindowState();

    // Safety net: re-sync after a short delay to catch any remaining
    // startup timing issues (e.g., window shown just after listeners setup)
    const delayedSync = setTimeout(() => {
      void syncWindowState();
    }, 1000);
    unlisteners.push(() => clearTimeout(delayedSync));
  });

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', syncDocumentVisibility);
    window.removeEventListener('focus', syncWindowState);
    window.removeEventListener('blur', syncWindowState);
    unlisteners.splice(0).forEach((unlisten) => unlisten());
  });

  watch(
    isMiniMode,
    (miniMode) => {
      setMainWindowRenderingSnapshot({ miniMode });
    },
    { immediate: true },
  );

  return useRenderingPower();
}
