import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';

import {
  normalizeForegroundStyle,
  useSettingsStore,
  type ThemeSettingsPatch,
} from '../features/settings/store';
import type { ThemeSettings } from '../types';
import type { WindowMaterialMode } from './windowMaterial';

const systemPrefersDark = ref(false);
let systemThemeListenerInitialized = false;
let systemThemeMediaQuery: MediaQueryList | null = null;

function handleSystemThemeChange(event: MediaQueryListEvent) {
  systemPrefersDark.value = event.matches;
}

function cleanupSystemThemeListener() {
  systemThemeMediaQuery?.removeEventListener('change', handleSystemThemeChange);
  systemThemeMediaQuery = null;
  systemThemeListenerInitialized = false;
}

function ensureSystemThemeListener() {
  if (systemThemeListenerInitialized || typeof window === 'undefined' || !window.matchMedia) {
    return;
  }
  systemThemeListenerInitialized = true;

  systemThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  systemPrefersDark.value = systemThemeMediaQuery.matches;
  systemThemeMediaQuery.addEventListener('change', handleSystemThemeChange);
}

function refreshSystemThemeDetection() {
  if (!systemThemeMediaQuery) {
    ensureSystemThemeListener();
    return;
  }
  systemPrefersDark.value = systemThemeMediaQuery.matches;
}

ensureSystemThemeListener();

if (import.meta.hot) {
  import.meta.hot.dispose(cleanupSystemThemeListener);
}

const resolveThemeDarkMode = (theme: ThemeSettings) => {
  if (theme.mode === 'system') {
    return systemPrefersDark.value;
  }

  if (theme.mode !== 'custom') {
    return theme.mode === 'dark';
  }

  const foregroundStyle = normalizeForegroundStyle(theme.customBackground.foregroundStyle);
  if (foregroundStyle === 'light') {
    return true;
  }
  return false;
};

export function useThemeSettings() {
  const settingsStore = useSettingsStore();
  const { settings, theme } = storeToRefs(settingsStore);

  const isCustomTheme = computed(() => theme.value.mode === 'custom');
  const isDarkTheme = computed(() => resolveThemeDarkMode(theme.value));

  const replaceTheme = (nextTheme: ThemeSettings) => {
    if (nextTheme.mode === 'system') {
      refreshSystemThemeDetection();
    }
    settingsStore.replaceTheme(nextTheme);
  };

  const patchTheme = (partialTheme: ThemeSettingsPatch) => {
    settingsStore.patchTheme(partialTheme);
  };

  const setThemeMode = (mode: ThemeSettings['mode']) => {
    if (mode === 'system') {
      refreshSystemThemeDetection();
    }

    if (mode === 'custom') {
      patchTheme({
        mode,
        dynamicBgType: 'none',
        windowMaterial: 'none',
      });
      return;
    }

    patchTheme({ mode });
  };

  const toggleThemeMode = () => {
    const currentTheme = theme.value;
    if (currentTheme.mode === 'custom' && currentTheme.customBackground.imagePath) {
      const foregroundStyle = normalizeForegroundStyle(currentTheme.customBackground.foregroundStyle);
      patchTheme({
        customBackground: {
          foregroundStyle: foregroundStyle === 'light' ? 'dark' : 'light',
        },
      });
      return;
    }

    setThemeMode(isDarkTheme.value ? 'light' : 'dark');
  };

  const setDynamicBackgroundType = (dynamicBgType: ThemeSettings['dynamicBgType']) => {
    patchTheme({ dynamicBgType });
  };

  const setWindowMaterial = (windowMaterial: WindowMaterialMode) => {
    patchTheme({
      windowMaterial,
      ...(windowMaterial !== 'none' ? { dynamicBgType: 'none' as const } : {}),
    });
  };

  const updateCustomBackground = (customBackground: ThemeSettingsPatch['customBackground']) => {
    patchTheme({ customBackground });
  };

  return {
    settings,
    theme,
    isCustomTheme,
    isDarkTheme,
    replaceTheme,
    patchTheme,
    setThemeMode,
    toggleThemeMode,
    setDynamicBackgroundType,
    setWindowMaterial,
    updateCustomBackground,
  };
}
