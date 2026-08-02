import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useSettingsStore } from '../features/settings/store';
import { useThemeSettings } from './useThemeSettings';

describe('useThemeSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('toggles between light and dark theme modes', () => {
    const { theme, toggleThemeMode } = useThemeSettings();

    expect(theme.value.mode).toBe('light');

    toggleThemeMode();
    expect(theme.value.mode).toBe('dark');

    toggleThemeMode();
    expect(theme.value.mode).toBe('light');
  });

  it('toggles custom wallpaper foreground color without leaving custom mode', () => {
    const settingsStore = useSettingsStore();
    const { theme, toggleThemeMode } = useThemeSettings();

    settingsStore.patchTheme({
      mode: 'custom',
      customBackground: {
        imagePath: '/covers/demo.jpg',
        foregroundStyle: 'light',
      },
    });

    toggleThemeMode();

    expect(theme.value.mode).toBe('custom');
    expect(theme.value.customBackground.foregroundStyle).toBe('dark');
  });

  it('falls back to switching app theme modes when custom mode has no wallpaper', () => {
    const settingsStore = useSettingsStore();
    const { theme, toggleThemeMode } = useThemeSettings();

    settingsStore.patchTheme({ mode: 'custom' });

    toggleThemeMode();

    expect(theme.value.mode).toBe('light');
  });
});
