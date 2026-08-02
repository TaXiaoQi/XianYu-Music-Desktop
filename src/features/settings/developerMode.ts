import { readonly, ref } from 'vue';

const DEVELOPER_MODE_STORAGE_KEY = 'xy_music_developer_mode';

function readDeveloperMode(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(DEVELOPER_MODE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

const developerModeEnabled = ref(readDeveloperMode());

function persistDeveloperMode(enabled: boolean) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (enabled) localStorage.setItem(DEVELOPER_MODE_STORAGE_KEY, '1');
    else localStorage.removeItem(DEVELOPER_MODE_STORAGE_KEY);
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
