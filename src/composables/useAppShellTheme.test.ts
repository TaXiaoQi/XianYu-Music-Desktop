import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';

import { useAppShellTheme } from './useAppShellTheme';
import { useSettingsStore } from '../features/settings/store';

/** 开启流动动态背景并返回主题 store */
const enableFlowBackground = () => {
  const themeStore = useSettingsStore();
  themeStore.patchTheme({ dynamicBgType: 'flow' });
  return themeStore;
};

describe('useAppShellTheme 外壳主题', () => {
  beforeEach(() => { setActivePinia(createPinia()); });

  it('mirrors the dynamic background surface between the main area and the footer', () => {
    enableFlowBackground();

    const { mainBlurStyle, mainContainerClass, footerBlurStyle, footerContainerClass } = useAppShellTheme({
      showPlayerDetail: ref(false), hasWindowMaterial: ref(false), isMicaWindowMaterial: ref(false),
    });

    expect(footerBlurStyle.value).toBe(mainBlurStyle.value);
    expect(footerContainerClass.value).toBe(mainContainerClass.value);
  });

  it('skips footer blur while the player detail overlay is open', () => {
    enableFlowBackground();

    const { footerBlurStyle, footerContainerClass } = useAppShellTheme({
      showPlayerDetail: ref(true), hasWindowMaterial: ref(false), isMicaWindowMaterial: ref(false),
    });

    expect(footerBlurStyle.value).toBe('none');
    expect(footerContainerClass.value).toBe('bg-transparent');
  });
});
