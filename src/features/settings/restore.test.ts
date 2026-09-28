import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { AppSettings } from '../../types';
import { restorePersistedAppSettings } from './restore';
import { createDefaultAppSettings, useSettingsStore } from './store';

const bootPinia = () => setActivePinia(createPinia());

// 存量快照：用户上次退出前选了深色 + 亚克力材质 + 流光背景
const legacySnapshot: Partial<AppSettings> = { theme: { ...createDefaultAppSettings().theme, mode: 'dark', windowMaterial: 'acrylic', dynamicBgType: 'flow' } };

describe('restorePersistedAppSettings', () => {
  beforeEach(bootPinia);

  it('applies the persisted theme ahead of the startup theme sync reading settings', () => {
    const store = useSettingsStore();
    const replaceSettingsSpy = vi.fn(store.replaceSettings);

    restorePersistedAppSettings(store.settings, replaceSettingsSpy, () => legacySnapshot as AppSettings);

    expect(replaceSettingsSpy).toHaveBeenCalledOnce();
    expect(store.settings.theme.mode).toBe('dark');
    expect(store.settings.theme.windowMaterial).toBe('acrylic');
    // 非 none 的窗口材质会把流光动态背景压制回 none
    expect(store.settings.theme.dynamicBgType).toBe('none');
  });
});
