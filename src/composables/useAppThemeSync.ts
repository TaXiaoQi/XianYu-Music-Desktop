import { getCurrentWindow } from '@tauri-apps/api/window';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { computed, nextTick, onBeforeUnmount, onMounted, watch } from 'vue';
import { useWindowMaterial } from './windowMaterial';
import { useThemeSettings } from './useThemeSettings';
import { windowApi } from '../services/tauri/windowApi';
import { applyThemeColorToDocument } from '../utils/themeColor';
import { applyDarkClassWithTransition } from './themeTransition';

export function useAppThemeSync() {
  const {
    activeWindowMaterial,
    applyWindowMaterial,
    rebuildWindowMaterialForCompositor,
    loadWindowMaterialCapabilities,
  } = useWindowMaterial();
  const { theme, isDarkTheme } = useThemeSettings();
  const appWindow = getCurrentWindow();

  const hasWindowMaterial = computed(() => activeWindowMaterial.value !== 'none');
  const isMicaWindowMaterial = computed(() => activeWindowMaterial.value === 'mica');
  let restoreSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let unlistenFocusChanged: UnlistenFn | null = null;
  let syncGeneration = 0;
  let skipNextFocusRestore = false;
  let resolveInitialThemeSync: (() => void) | null = null;
  const initialThemeSync = new Promise<void>((resolve) => {
    resolveInitialThemeSync = resolve;
  });

  const markInitialThemeSynced = () => {
    resolveInitialThemeSync?.();
    resolveInitialThemeSync = null;
  };

  const applyTheme = async () => {
    // 切换深浅色时附带渐变过渡；首帧启动与减少动效场景内部会自动跳过动画
    applyDarkClassWithTransition(isDarkTheme.value);

    try {
      await appWindow.setTheme(isDarkTheme.value ? 'dark' : 'light');
    } catch (error) {
      console.warn('Failed to set window theme:', error);
    }
  };

  const refreshMaterialActiveState = async (hasMaterial = theme.value.windowMaterial !== 'none') => {
    if (!hasMaterial) {
      return;
    }

    try {
      await windowApi.refreshWindowMaterialActiveState(theme.value.keepWindowMaterialOnBlur);
    } catch (error) {
      console.warn('Failed to refresh window material active state:', error);
    }
  };

  const syncWindowMaterial = async () => {
    await nextTick();
    const resolvedMaterial = await applyWindowMaterial(
      theme.value.windowMaterial,
      document.documentElement.classList.contains('dark'),
      theme.value.windowBlurTint,
    );
    await refreshMaterialActiveState(resolvedMaterial !== 'none');
  };

  const syncThemeAndMaterial = async () => {
    const gen = ++syncGeneration;
    try {
      await applyTheme();
      if (gen !== syncGeneration) return;
      await syncWindowMaterial();
    } finally {
      if (gen === syncGeneration) {
        markInitialThemeSynced();
      }
    }
  };

  const scheduleRestoreMaterialSync = () => {
    if (skipNextFocusRestore) {
      skipNextFocusRestore = false;
      return;
    }

    if (restoreSyncTimer) {
      clearTimeout(restoreSyncTimer);
      restoreSyncTimer = null;
    }

    void syncThemeAndMaterial();

    // DWM can finish restoring a blurred transparent window after the focus event.
    restoreSyncTimer = setTimeout(() => {
      restoreSyncTimer = null;
      void syncThemeAndMaterial();
    }, 120);
  };

  const rebuildMaterialComposition = async () => {
    const gen = ++syncGeneration;
    try {
      await applyTheme();
      if (gen !== syncGeneration) return;
      await nextTick();
      const resolvedMaterial = await rebuildWindowMaterialForCompositor(
        theme.value.windowMaterial,
        document.documentElement.classList.contains('dark'),
        theme.value.windowBlurTint,
      );
      await refreshMaterialActiveState(resolvedMaterial !== 'none');
    } finally {
      if (gen === syncGeneration) {
        markInitialThemeSynced();
      }
    }
  };

  const scheduleStartupMaterialRebuild = () => {
    if (theme.value.windowMaterial === 'none') {
      return;
    }

    if (restoreSyncTimer) {
      clearTimeout(restoreSyncTimer);
      restoreSyncTimer = null;
    }

    restoreSyncTimer = setTimeout(() => {
      restoreSyncTimer = null;
      void rebuildMaterialComposition();
    }, 180);
  };

  const rebuildStartupMaterialBeforeShow = async () => {
    if (theme.value.windowMaterial === 'none') {
      return;
    }

    if (restoreSyncTimer) {
      clearTimeout(restoreSyncTimer);
      restoreSyncTimer = null;
    }

    await rebuildMaterialComposition();
    skipNextFocusRestore = true;
  };

  void loadWindowMaterialCapabilities();

  watch(
    [
      () => theme.value.mode,
      () => theme.value.windowMaterial,
      () => theme.value.keepWindowMaterialOnBlur,
      () => theme.value.windowBlurTint,
      () => theme.value.customBackground.foregroundStyle,
      isDarkTheme,
    ],
    () => {
      void syncThemeAndMaterial();
    },
    { immediate: true },
  );

  watch(
    () => theme.value.accentColor,
    accentColor => applyThemeColorToDocument(accentColor),
    { immediate: true },
  );

  onMounted(() => {
    void appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused || theme.value.keepWindowMaterialOnBlur) {
        scheduleRestoreMaterialSync();
      }
    }).then((unlisten) => {
      unlistenFocusChanged = unlisten;
    });
  });

  onBeforeUnmount(() => {
    if (restoreSyncTimer) {
      clearTimeout(restoreSyncTimer);
      restoreSyncTimer = null;
    }

    if (unlistenFocusChanged) {
      unlistenFocusChanged();
      unlistenFocusChanged = null;
    }
  });

  return {
    activeWindowMaterial,
    hasWindowMaterial,
    isMicaWindowMaterial,
    syncWindowMaterial,
    refreshMaterialActiveState,
    whenInitialThemeSynced: () => initialThemeSync,
    restoreMaterialAfterShow: scheduleStartupMaterialRebuild,
    rebuildStartupMaterialBeforeShow,
  };
}
