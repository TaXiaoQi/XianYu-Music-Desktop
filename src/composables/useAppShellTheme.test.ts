import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';

import { useSettingsStore } from '../features/settings/store';
import { useAppShellTheme } from './useAppShellTheme';

describe('useAppShellTheme', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('uses the same dynamic background surface for the main area and footer', () => {
    const settingsStore = useSettingsStore();
    settingsStore.patchTheme({ dynamicBgType: 'flow' });

    const {
      mainBlurStyle,
      mainContainerClass,
      footerBlurStyle,
      footerContainerClass,
    } = useAppShellTheme({
      showPlayerDetail: ref(false),
      hasWindowMaterial: ref(false),
      isMicaWindowMaterial: ref(false),
    });

    expect(footerBlurStyle.value).toBe(mainBlurStyle.value);
    expect(footerContainerClass.value).toBe(mainContainerClass.value);
  });

  it('does not add footer blur while player detail is open', () => {
    const settingsStore = useSettingsStore();
    settingsStore.patchTheme({ dynamicBgType: 'flow' });

    const { footerBlurStyle, footerContainerClass } = useAppShellTheme({
      showPlayerDetail: ref(true),
      hasWindowMaterial: ref(false),
      isMicaWindowMaterial: ref(false),
    });

    expect(footerBlurStyle.value).toBe('none');
    expect(footerContainerClass.value).toBe('bg-transparent');
  });
});
