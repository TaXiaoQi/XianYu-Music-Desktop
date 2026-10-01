import { ref, watch } from 'vue';
import { localStore } from '../services/storage/localStore';
import type { PluginSyncResult } from '../services/domain/pluginSync';
import type { SettingsSyncResult } from '../services/domain/settingsSync';
import type { SyncResult } from '../services/domain/playlistSync';

const LOGIN_SYNC_COMPLETED_KEY = 'player_login_sync_completed';

function loadLoginSyncCompleted(): boolean {
  return localStore.getJson<boolean>(LOGIN_SYNC_COMPLETED_KEY) ?? false;
}

export function persistLoginSyncCompleted() {
  localStore.setJson(LOGIN_SYNC_COMPLETED_KEY, true);
}

const SYNC_STATUS_STORAGE_KEY = 'player_sync_status';

interface PersistedSyncSlot<T> {
  time: number | null;
  result: T | null;
}

type PersistedSyncState = {
  playlists: PersistedSyncSlot<SyncResult>;
  plugins: PersistedSyncSlot<PluginSyncResult>;
  settings: PersistedSyncSlot<SettingsSyncResult>;
  favorites: PersistedSyncSlot<SyncResult>;
};

function loadPersistedSyncState(): PersistedSyncState {
  const saved = localStore.getJson<Partial<PersistedSyncState>>(SYNC_STATUS_STORAGE_KEY) ?? {};
  const slot = <T>(val: unknown): PersistedSyncSlot<T> =>
    val && typeof val === 'object' && typeof (val as PersistedSyncSlot<T>).time === 'number'
      ? { time: (val as PersistedSyncSlot<T>).time, result: (val as PersistedSyncSlot<T>).result ?? null }
      : { time: null, result: null };
  return {
    playlists: slot<SyncResult>(saved.playlists),
    plugins: slot<PluginSyncResult>(saved.plugins),
    settings: slot<SettingsSyncResult>(saved.settings),
    favorites: slot<SyncResult>(saved.favorites),
  };
}

const persistedSyncState = loadPersistedSyncState();

export const syncing = ref(false);
export const syncProgress = ref('');

export const lastSyncTime = ref<number | null>(persistedSyncState.playlists.time);
export const lastSyncResult = ref<SyncResult | null>(persistedSyncState.playlists.result);

export const pluginSyncing = ref(false);
export const pluginSyncProgress = ref('');
export const lastPluginSyncTime = ref<number | null>(persistedSyncState.plugins.time);
export const lastPluginSyncResult = ref<PluginSyncResult | null>(persistedSyncState.plugins.result);

export const settingsSyncing = ref(false);
export const settingsSyncProgress = ref('');
export const lastSettingsSyncTime = ref<number | null>(persistedSyncState.settings.time);
export const lastSettingsSyncResult = ref<SettingsSyncResult | null>(persistedSyncState.settings.result);

export const favoritesSyncing = ref(false);
export const favoritesSyncProgress = ref('');
export const lastFavoritesSyncTime = ref<number | null>(persistedSyncState.favorites.time);
export const lastFavoritesSyncResult = ref<SyncResult | null>(persistedSyncState.favorites.result);

export const autoSyncStatus = ref('');
export const autoSyncDelayed = ref(false);

export const loginSyncCompleted = ref(loadLoginSyncCompleted());

function persistSyncStatus(category: keyof PersistedSyncState) {
  const snapshot = loadPersistedSyncState();
  if (category === 'playlists') {
    snapshot.playlists = { time: lastSyncTime.value, result: lastSyncResult.value };
  } else if (category === 'plugins') {
    snapshot.plugins = { time: lastPluginSyncTime.value, result: lastPluginSyncResult.value };
  } else if (category === 'settings') {
    snapshot.settings = { time: lastSettingsSyncTime.value, result: lastSettingsSyncResult.value };
  } else {
    snapshot.favorites = { time: lastFavoritesSyncTime.value, result: lastFavoritesSyncResult.value };
  }
  localStore.setJson(SYNC_STATUS_STORAGE_KEY, snapshot);
}

watch([lastSyncTime, lastSyncResult], () => persistSyncStatus('playlists'), { deep: true });
watch([lastPluginSyncTime, lastPluginSyncResult], () => persistSyncStatus('plugins'), { deep: true });
watch([lastSettingsSyncTime, lastSettingsSyncResult], () => persistSyncStatus('settings'), { deep: true });
watch([lastFavoritesSyncTime, lastFavoritesSyncResult], () => persistSyncStatus('favorites'), { deep: true });
