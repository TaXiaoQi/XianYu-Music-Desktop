import { storeToRefs } from 'pinia';
import { watch } from 'vue';

import { playerStorage, playerStorageKeys } from '../../services/storage/playerStorage';
import { defaultAppSettings, mergeAppSettings, useSettingsStore } from './store';
import type { DeprecatedAppSettingsPatch } from './store';
import { restorePersistedAppSettings } from './restore';

// 旧版把全部设置存在 app_settings 键下，本次启动做一次性迁移。
let legacyMigrationFinished = false;

// restorePersistedAppSettings 只应对每个 store 实例执行一次。
const storesAlreadyRestored = new WeakSet<ReturnType<typeof useSettingsStore>>();

/** 把旧键里的设置并进默认值后套用；若新键尚无内容则顺手落盘一份。 */
function migrateLegacySettings(applyPatch: (partialSettings: Partial<typeof defaultAppSettings>) => void) {
  if (legacyMigrationFinished) {
    return;
  }
  legacyMigrationFinished = true;

  const legacyRaw = playerStorage.getString(
    playerStorageKeys.legacyAppSettings,
  );
  if (legacyRaw === null || legacyRaw === '') {
    return;
  }

  try {
    const legacyPatch = JSON.parse(legacyRaw) as DeprecatedAppSettingsPatch;
    const migrated = mergeAppSettings(defaultAppSettings, legacyPatch);
    applyPatch(migrated);

    const currentRaw = playerStorage.getString(playerStorageKeys.settings);
    if (currentRaw === null || currentRaw === '') {
      playerStorage.writeSettings(migrated, playerStorageKeys.settings);
    }
  } catch (error) {
    console.error(`Failed to parse legacy app settings`, error);
  }
}

export function useSettings() {
  const store = useSettingsStore();
  const { settings, audioDelay, theme, sidebar, footerLayout, topBarLayout } = storeToRefs(store);

  migrateLegacySettings((patch) => store.patchSettings(patch));

  const needsRestore = !storesAlreadyRestored.has(store);
  if (needsRestore) {
    storesAlreadyRestored.add(store);
    restorePersistedAppSettings(
      settings.value,
      store.replaceSettings,
    );
  }

  // 主题变更做 250ms 防抖后整份持久化，避免拖拽色板时高频写盘。
  let themePersistHandle: ReturnType<typeof setTimeout> | undefined;
  watch(
    theme,
    () => {
      if (themePersistHandle !== undefined) {
        clearTimeout(themePersistHandle);
      }
      themePersistHandle = setTimeout(() => {
        themePersistHandle = undefined;
        playerStorage.writeSettings(settings.value);
      }, 250);
    },
    { deep: true },
  );

  const {
    patchSettings,
    replaceSettings,
    patchTheme,
    replaceTheme,
    patchSidebar,
    patchFooterLayout,
    patchTopBarLayout,
  } = store;

  return {
    settings,
    audioDelay,
    theme,
    sidebar,
    footerLayout,
    topBarLayout,
    patchSettings,
    replaceSettings,
    patchTheme,
    replaceTheme,
    patchSidebar,
    patchFooterLayout,
    patchTopBarLayout,
  };
}
