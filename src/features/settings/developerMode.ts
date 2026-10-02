import { readonly, ref } from 'vue'; // 实现

const DEVELOPER_MODE_STORAGE_KEY = 'xianyu_music_developer_mode';
/** 旧键名：仅用于读取时迁移，不再写入 */
const LEGACY_DEVELOPER_MODE_STORAGE_KEY = 'xy_music_developer_mode';

function readDeveloperMode(): boolean { // 实现
  if (typeof localStorage === 'undefined') return false; // 实现
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
    return false; // 实现
  }
}

const developerModeEnabled = ref(readDeveloperMode()); // 实现

function persistDeveloperMode(enabled: boolean) { // 实现
  if (typeof localStorage === 'undefined') return; // 实现
  try {
    if (enabled) localStorage.setItem(DEVELOPER_MODE_STORAGE_KEY, '1'); // 实现
    else {
      localStorage.removeItem(DEVELOPER_MODE_STORAGE_KEY);
      localStorage.removeItem(LEGACY_DEVELOPER_MODE_STORAGE_KEY);
    }
  } catch {
    // Keep the in-memory state usable when storage is unavailable. 
  }
}

export function enableDeveloperMode() { // 实现
  developerModeEnabled.value = true; // 实现
  persistDeveloperMode(true); // 实现
}

export function disableDeveloperMode() { // 实现
  developerModeEnabled.value = false; // 实现
  persistDeveloperMode(false); // 实现
}

export function useDeveloperMode() { // 实现
  return {
    isDeveloperMode: readonly(developerModeEnabled), // 实现
    enableDeveloperMode, // 实现
    disableDeveloperMode, // 实现
  };
}
