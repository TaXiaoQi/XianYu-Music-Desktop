
import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import { useAuthStore } from '../features/auth/store';
import { useSettingsStore } from '../features/settings/store';
import { useStatisticsStore } from '../features/statistics/store';
import { useToast } from './toast';
import {
  deleteCloudPlaylist,
  getCiyuanxiId,
} from '../services/domain/playlistSync';
import {
  clearPlaylistSongTombstones,
} from '../services/domain/playlistSongSyncState';
import {
  autoSyncStatus,
  autoSyncDelayed,
  lastFavoritesSyncResult,
  lastFavoritesSyncTime,
  lastPluginSyncResult,
  lastPluginSyncTime,
  lastSettingsSyncResult,
  lastSettingsSyncTime,
  lastSyncResult,
  lastSyncTime,
  settingsSyncProgress,
  settingsSyncing,
  syncProgress,
  syncing,
  pluginSyncProgress,
  pluginSyncing,
  favoritesSyncProgress,
  favoritesSyncing,
} from './playlistSyncState';
import { createPlaylistSyncCoordinator } from './playlistSyncPlaylists';
import { createPluginSyncCoordinator } from './playlistSyncPlugins';
import { createFavoriteSyncCoordinator } from './playlistSyncFavorites';
import { createSettingsSyncCoordinator } from './playlistSyncSettings';
import { createSyncLifecycleCoordinator } from './playlistSyncLifecycle';

export type SyncDirection = 'upload' | 'download' | 'sync';

const LOG = '[usePlaylistSync]';

function logSync(_msg: string, ..._args: unknown[]) {
}

function logSyncError(msg: string, ...args: unknown[]) {
  console.error(`${LOG} ${msg}`, ...args);
}


export function usePlaylistSync() {
  const collectionsStore = useCollectionsStore();
  const libraryStore = useLibraryStore();
  const authStore = useAuthStore();
  const settingsStore = useSettingsStore();
  const statisticsStore = useStatisticsStore();
  const { showToast } = useToast();

  function canSync(): boolean {
    return authStore.isLoggedIn && !!authStore.user?.ciyuanxi_id;
  }

  function isUploadEnabled(): boolean {
    return settingsStore.settings.upload.playlists;
  }

  function isPluginUploadEnabled(): boolean {
    return settingsStore.settings.upload.plugins;
  }

  function isSettingsUploadEnabled(): boolean {
    return settingsStore.settings.upload.settings;
  }

  function isFavoritesUploadEnabled(): boolean {
    return settingsStore.settings.upload.favorites;
  }

  const playlistSync = createPlaylistSyncCoordinator({
    collectionsStore,
    libraryStore,
    canSync,
    isUploadEnabled,
    showToast,
    logSync,
    logSyncError,
  });

  const {
    uploadPlaylists,
    downloadPlaylists,
    syncPlaylists,
  } = playlistSync;

  const pluginSync = createPluginSyncCoordinator({
    canSync,
    isPluginUploadEnabled,
    showToast,
    logSync,
    logSyncError,
  });

  const {
    syncPlugins,
    uploadPluginsOnly,
    downloadPluginsOnly,
  } = pluginSync;

  const favoriteSync = createFavoriteSyncCoordinator({
    collectionsStore,
    libraryStore,
    canSync,
    isFavoritesUploadEnabled,
    showToast,
    logSync,
    logSyncError,
  });

  const {
    uploadFavoritesOnly,
    downloadFavoritesOnly,
    syncFavorites,
  } = favoriteSync;

  const settingsSync = createSettingsSyncCoordinator({
    settingsStore,
    canSync,
    isUploadEnabled,
    isPluginUploadEnabled,
    isSettingsUploadEnabled,
    uploadPlaylists,
    downloadPlaylists,
    showToast,
    logSync,
    logSyncError,
  });

  const {
    uploadSettingsOnly,
    downloadSettingsOnly,
    syncSettings,
  } = settingsSync;

  const syncLifecycle = createSyncLifecycleCoordinator({
    settingsStore,
    statisticsStore,
    canSync,
    uploadPlaylists,
    uploadPluginsOnly,
    uploadFavoritesOnly,
    uploadSettingsOnly,
    syncPlaylists,
    syncPlugins,
    syncFavorites,
    syncSettings,
    showToast,
    logSync,
    logSyncError,
  });

  const {
    initAutoSync,
    checkAutoSync,
    patchAutoSyncConfig,
    performAutoSync,
    syncOnLoginSuccess,
  } = syncLifecycle;

  async function uploadOnly(): Promise<void> {
    logSync('========== uploadOnly 开始 ==========');
    if (!canSync()) {
      logSyncError('uploadOnly: 未登录或无弦予号');
      showToast('请先登录后再同步', 'error');
      return;
    }

    if (!isUploadEnabled()) {
      logSync('uploadOnly: 上传未开启');
      showToast('歌单同步已关闭，请在设置中开启', 'info');
      return;
    }

    syncing.value = true;
    syncProgress.value = '正在上传歌单到云端...';

    try {
      const result = await uploadPlaylists();
      lastSyncTime.value = Date.now();
      lastSyncResult.value = result;
      logSync(`uploadOnly 完成: uploadedPlaylists=${result.uploadedPlaylists}, uploadedSongs=${result.uploadedSongs}, errors=${result.errors.length}`);

      if (result.errors.length > 0) {
        showToast(`上传完成（${result.errors.length} 个错误）`, 'error');
      } else if (result.uploadedPlaylists > 0) {
        showToast(`已上传 ${result.uploadedPlaylists} 个歌单（${result.uploadedSongs} 首歌曲）`, 'success');
      } else {
        showToast('歌单已同步，无需上传', 'info');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logSyncError(`uploadOnly 异常: ${msg}`, error);
      showToast(`上传失败：${msg}`, 'error');
    } finally {
      logSync('uploadOnly: finally 块执行, 重置 syncing/syncProgress');
      syncing.value = false;
      syncProgress.value = '';
    }
  }

  async function downloadOnly(): Promise<void> {
    logSync('========== downloadOnly 开始 ==========');
    if (!canSync()) {
      logSyncError('downloadOnly: 未登录或无弦予号');
      showToast('请先登录后再同步', 'error');
      return;
    }

    syncing.value = true;
    syncProgress.value = '正在从云端下载歌单...';

    try {
      const result = await downloadPlaylists();
      lastSyncTime.value = Date.now();
      lastSyncResult.value = result;
      logSync(`downloadOnly 完成: downloadedPlaylists=${result.downloadedPlaylists}, downloadedSongs=${result.downloadedSongs}, errors=${result.errors.length}`);

      if (result.errors.length > 0) {
        showToast(`下载完成（${result.errors.length} 个错误）`, 'error');
      } else if (result.downloadedPlaylists > 0) {
        showToast(`已下载 ${result.downloadedPlaylists} 个歌单（${result.downloadedSongs} 首歌曲）`, 'success');
      } else {
        showToast('云端暂无歌单', 'info');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logSyncError(`downloadOnly 异常: ${msg}`, error);
      showToast(`下载失败：${msg}`, 'error');
    } finally {
      logSync('downloadOnly: finally 块执行, 重置 syncing/syncProgress');
      syncing.value = false;
      syncProgress.value = '';
    }
  }

  async function deleteCloudPlaylistLocal(playlistId: string): Promise<boolean> {
    const ciyuanxiId = getCiyuanxiId();
    if (!ciyuanxiId) {
      showToast('请先登录', 'error');
      return false;
    }

    const playlist = collectionsStore.getPlaylistById(playlistId);
    if (!playlist?.cloudId) {
      showToast('该歌单未同步到云端', 'info');
      return false;
    }

    try {
      await deleteCloudPlaylist(ciyuanxiId, [playlist.cloudId]);
      clearPlaylistSongTombstones(playlist.cloudId);
      collectionsStore.setPlaylistCloudId(playlistId, '');
      showToast('已从云端删除歌单', 'success');
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      showToast(`删除云端歌单失败：${msg}`, 'error');
      return false;
    }
  }

  return {
    syncing,
    syncProgress,
    lastSyncTime,
    lastSyncResult,
    pluginSyncing,
    pluginSyncProgress,
    lastPluginSyncTime,
    lastPluginSyncResult,
    settingsSyncing,
    settingsSyncProgress,
    lastSettingsSyncTime,
    lastSettingsSyncResult,
    favoritesSyncing,
    favoritesSyncProgress,
    lastFavoritesSyncTime,
    lastFavoritesSyncResult,
    autoSyncStatus,
    autoSyncDelayed,
    canSync,
    isUploadEnabled,
    isPluginUploadEnabled,
    isSettingsUploadEnabled,
    isFavoritesUploadEnabled,
    syncPlaylists,
    syncPlugins,
    syncSettings,
    uploadOnly,
    downloadOnly,
    uploadPluginsOnly,
    downloadPluginsOnly,
    uploadSettingsOnly,
    downloadSettingsOnly,
    uploadFavoritesOnly,
    downloadFavoritesOnly,
    syncFavorites,
    uploadPlaylists,
    downloadPlaylists,
    deleteCloudPlaylistLocal,
    initAutoSync,
    checkAutoSync,
    patchAutoSyncConfig,
    performAutoSync,
    syncOnLoginSuccess,
  };
}
