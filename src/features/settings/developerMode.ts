import { readonly, ref } from 'vue';

const DEVELOPER_MODE_STORAGE_KEY = 'xianyu_music_developer_mode';
/** 旧键名：仅用于读取时迁移，不再写入 */
const LEGACY_DEVELOPER_MODE_STORAGE_KEY = 'xy_music_developer_mode';

function readDeveloperMode(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    if (localStorage.getItem(DEVELOPER_MODE_STORAGE_KEY) === '1') return true;
    // 老版本把开关存在旧键下：读到就迁移到新键，避免已开启的开发者模式被重置
    if (localStorage.getItem(LEGACY_DEVELOPER_MODE_STORAGE_KEY) === '1') {
      localStorage.setItem(DEVELOPER_MODE_STORAGE_KEY, '1');
      localStorage.removeItem(LEGACY_DEVELOPER_MODE_STORAGE_KEY);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

const developerModeEnabled = ref(readDeveloperMode());

function persistDeveloperMode(enabled: boolean) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (enabled) localStorage.setItem(DEVELOPER_MODE_STORAGE_KEY, '1');
    else {
      localStorage.removeItem(DEVELOPER_MODE_STORAGE_KEY);
      localStorage.removeItem(LEGACY_DEVELOPER_MODE_STORAGE_KEY);
    }
  } catch {
    // Keep the in-memory state usable when storage is unavailable.
  }
}

export function enableDeveloperMode() {
  developerModeEnabled.value = true;
  persistDeveloperMode(true);
}

export function disableDeveloperMode() {
  developerModeEnabled.value = false;
  persistDeveloperMode(false);
}

export function useDeveloperMode() {
  return {
    isDeveloperMode: readonly(developerModeEnabled),
    enableDeveloperMode,
    disableDeveloperMode,
  };
}
