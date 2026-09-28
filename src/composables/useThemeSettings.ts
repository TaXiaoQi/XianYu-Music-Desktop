import type { ThemeSettings } from '../types';
import type { WindowMaterialMode } from './windowMaterial';
import { type ThemeSettingsPatch, normalizeForegroundStyle, useSettingsStore } from '../features/settings/store';
import { ref, computed } from 'vue';
import { storeToRefs } from 'pinia';

/** 系统深浅色的媒体查询；模块加载即完成首次绑定，各窗口共享同一份探测结果 */
const SYSTEM_COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)';

const systemPrefersDarkMode = ref(false);
let colorSchemeWatcher: MediaQueryList | null = null;
let colorSchemeWatcherBound = false;

function onColorSchemeFlip(changeEvent: MediaQueryListEvent) {
  systemPrefersDarkMode.value = changeEvent.matches;
}

function unbindColorSchemeWatcher() {
  colorSchemeWatcher?.removeEventListener('change', onColorSchemeFlip);
  colorSchemeWatcher = null;
  colorSchemeWatcherBound = false;
}

function bindColorSchemeWatcher() {
  if (colorSchemeWatcherBound || typeof window === 'undefined' || !window.matchMedia) return;

  colorSchemeWatcherBound = true;
  colorSchemeWatcher = window.matchMedia(SYSTEM_COLOR_SCHEME_QUERY);
  systemPrefersDarkMode.value = colorSchemeWatcher.matches;
  colorSchemeWatcher.addEventListener('change', onColorSchemeFlip);
}

/** 重新采样系统深浅色；监听尚未建立时顺带完成首次绑定 */
function resampleSystemColorScheme() {
  const watcher = colorSchemeWatcher;
  if (watcher) systemPrefersDarkMode.value = watcher.matches;
  else bindColorSchemeWatcher();
}

bindColorSchemeWatcher();

if (import.meta.hot) import.meta.hot.dispose(unbindColorSchemeWatcher);

/** 由主题模式推导深色态：跟随系统、显式模式，或自定义背景的前景样式（亮前景配暗底） */
const resolvesToDarkSurface = (themeSnapshot: ThemeSettings): boolean => {
  if (themeSnapshot.mode === 'system') return systemPrefersDarkMode.value;
  if (themeSnapshot.mode !== 'custom') return themeSnapshot.mode === 'dark';

  return normalizeForegroundStyle(themeSnapshot.customBackground.foregroundStyle) === 'light';
};

export function useThemeSettings() {
  const store = useSettingsStore();
  const { theme, settings } = storeToRefs(store);

  const isCustomTheme = computed<boolean>(() => theme.value?.mode === 'custom');
  const isDarkTheme = computed(() => (theme.value ? resolvesToDarkSurface(theme.value) : false));

  // 切到「跟随系统」前重新采样一次，避免拿到陈旧的探测结果
  const replaceTheme = (incomingTheme: ThemeSettings) => {
    if (incomingTheme.mode === 'system') resampleSystemColorScheme();
    store.replaceTheme(incomingTheme);
  };

  const patchTheme = (partialTheme: ThemeSettingsPatch) => store.patchTheme(partialTheme);

  const setThemeMode = (nextMode: ThemeSettings['mode']) => {
    if (nextMode === 'system') resampleSystemColorScheme();

    patchTheme(
      nextMode === 'custom'
        ? { mode: nextMode, dynamicBgType: 'none', windowMaterial: 'none' }
        : { mode: nextMode },
    );
  };

  const toggleThemeMode = () => {
    const activeTheme = theme.value;
    if (!activeTheme) return;

    // 自定义壁纸模式下翻转前景明暗而不退出该模式；无壁纸时退回普通明暗切换
    const wallpaperForeground = activeTheme.mode === 'custom' && activeTheme.customBackground.imagePath
      ? normalizeForegroundStyle(activeTheme.customBackground.foregroundStyle)
      : null;

    if (wallpaperForeground === null) {
      const flippedMode: ThemeSettings['mode'] = isDarkTheme.value ? 'light' : 'dark';
      setThemeMode(flippedMode);
    } else {
      patchTheme({ customBackground: { foregroundStyle: wallpaperForeground === 'light' ? 'dark' : 'light' } });
    }
  };

  const setDynamicBackgroundType = (nextDynamicBgType: ThemeSettings['dynamicBgType']) => {
    patchTheme({ dynamicBgType: nextDynamicBgType });
  };

  const setWindowMaterial = (nextWindowMaterial: WindowMaterialMode) => {
    const materialPatch: ThemeSettingsPatch = { windowMaterial: nextWindowMaterial };
    if (nextWindowMaterial !== 'none') materialPatch.dynamicBgType = 'none';
    patchTheme(materialPatch);
  };

  const updateCustomBackground = (customBackgroundPatch: ThemeSettingsPatch['customBackground']) => {
    patchTheme({ customBackground: customBackgroundPatch });
  };

  const themeApi = {
    settings, theme, isCustomTheme, isDarkTheme,
    replaceTheme, patchTheme, setThemeMode, toggleThemeMode,
    setDynamicBackgroundType, setWindowMaterial, updateCustomBackground,
  };
  return themeApi;
}
