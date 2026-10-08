
import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import { useAuthStore } from '../features/auth/store';
import { useSettingsStore } from '../features/settings/store';
import { useStatisticsStore } from '../features/statistics/store';
import { useToast } from './toast';
import { showSettingsConflict } from './useSettingsConflict';
import { getAutoSyncScheduler } from '../services/domain/autoSync';
import type { SyncResult } from '../services/domain/playlistSync';
import type { AutoSyncConfig } from '../types';
import { createPlaylistSyncService } from '../services/domain/sync/playlistSyncService';
import { createPluginSyncFlow } from '../services/domain/sync/pluginSyncService';
import { createSettingsSyncFlow } from '../services/domain/sync/settingsSyncService';
import { createFavoritesSyncFlow } from '../services/domain/sync/favoritesSyncService';
import { createAutoSyncFlow } from '../services/domain/sync/autoSyncService';
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
  loginSyncCompleted,
  persistLoginSyncCompleted,
  settingsSyncProgress,
  settingsSyncing,
  syncProgress,
  syncing,
  pluginSyncProgress,
  pluginSyncing,
  favoritesSyncProgress,
  favoritesSyncing,
} from './playlistSyncState';

export type SyncDirection = 'upload' | 'download' | 'sync';

const LOG = '[usePlaylistSync]';

let autoSyncInitialized = false;
let autoSyncStatusTimer: ReturnType<typeof setTimeout> | null = null;

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

  // ==================== 各域服务（业务与 IO 在 services 层，UI 状态经端口写入） ====================

  const { uploadPlaylists, downloadPlaylists, deleteCloudPlaylistLocal } = createPlaylistSyncService({
    collections: collectionsStore,
    library: libraryStore,
    onProgress: msg => { syncProgress.value = msg; },
    notify: showToast,
    log: logSync,
    logError: logSyncError,
  });

  const pluginFlow = createPluginSyncFlow({
    canSync,
    isUploadEnabled: isPluginUploadEnabled,
    onProgress: msg => { pluginSyncProgress.value = msg; },
    notify: showToast,
    setSyncing: v => { pluginSyncing.value = v; },
    setLastResult: result => { lastPluginSyncResult.value = result; },
    setLastTime: time => { lastPluginSyncTime.value = time; },
    log: logSync,
    logError: logSyncError,
  });

  const settingsFlow = createSettingsSyncFlow({
    canSync,
    isSettingsUploadEnabled,
    isPlaylistUploadEnabled: isUploadEnabled,
    isPluginUploadEnabled,
    getSettings: () => settingsStore.settings,
    replaceSettings: next => settingsStore.replaceSettings(next),
    onProgress: msg => { settingsSyncProgress.value = msg; },
    notify: showToast,
    setSyncing: v => { settingsSyncing.value = v; },
    setLastResult: result => { lastSettingsSyncResult.value = result; },
    setLastTime: time => { lastSettingsSyncTime.value = time; },
    resolveConflict: uploadedAt => showSettingsConflict(uploadedAt),
    uploadPlaylists,
    downloadPlaylists,
    log: logSync,
    logError: logSyncError,
  });

  const favoritesFlow = createFavoritesSyncFlow({
    canSync,
    isUploadEnabled: isFavoritesUploadEnabled,
    collections: collectionsStore,
    library: libraryStore,
    onProgress: msg => { favoritesSyncProgress.value = msg; },
    notify: showToast,
    setSyncing: v => { favoritesSyncing.value = v; },
    setLastResult: result => { lastFavoritesSyncResult.value = result; },
    setLastTime: time => { lastFavoritesSyncTime.value = time; },
    log: logSync,
    logError: logSyncError,
  });

  const { performAutoSync, syncOnLoginSuccess } = createAutoSyncFlow({
    getUploadConfig: () => settingsStore.settings.upload,
    tasks: {
      uploadPlaylists,
      uploadPluginsOnly: pluginFlow.uploadPluginsOnly,
      uploadFavoritesOnly: favoritesFlow.uploadFavoritesOnly,
      uploadSettingsOnly: settingsFlow.uploadSettingsOnly,
      syncPlaylists: () => syncPlaylists(),
      syncPlugins: pluginFlow.syncPlugins,
      syncFavorites: favoritesFlow.syncFavorites,
      syncSettings: settingsFlow.syncSettings,
    },
    statistics: statisticsStore,
    isLoginSyncCompleted: () => loginSyncCompleted.value,
    markLoginSyncCompleted: () => {
      loginSyncCompleted.value = true;
      persistLoginSyncCompleted();
    },
    log: logSync,
    logError: logSyncError,
  });

  // ==================== 歌单同步编排壳（syncing/syncProgress/toast） ====================

  async function syncPlaylists(): Promise<SyncResult> {
    logSync('========== syncPlaylists 开始 ==========');
    if (!canSync()) {
      logSyncError('syncPlaylists: 未登录或无弦予号，取消同步');
      showToast('请先登录后再同步', 'error');
      return {
        uploadedPlaylists: 0,
        downloadedPlaylists: 0,
        uploadedSongs: 0,
        downloadedSongs: 0,
        errors: ['未登录'],
      };
    }

    syncing.value = true;
    syncProgress.value = '正在同步歌单...';
    lastSyncResult.value = null;

    try {
      let uploadResult: SyncResult = {
        uploadedPlaylists: 0,
        downloadedPlaylists: 0,
        uploadedSongs: 0,
        downloadedSongs: 0,
        errors: [],
      };

      if (isUploadEnabled()) {
        logSync('syncPlaylists: 步骤 1/2 - 开始上传');
        syncProgress.value = '正在上传本地歌单到云端...';
        uploadResult = await uploadPlaylists();
        logSync('syncPlaylists: 步骤 1/2 - 上传完成', uploadResult);
      } else {
        logSync('syncPlaylists: 步骤 1/2 - 上传未开启，跳过');
      }

      logSync('syncPlaylists: 步骤 2/2 - 开始下载');
      syncProgress.value = '正在从云端拉取歌单...';
      const downloadResult = await downloadPlaylists();
      logSync('syncPlaylists: 步骤 2/2 - 下载完成', downloadResult);

      const combined: SyncResult = {
        uploadedPlaylists: uploadResult.uploadedPlaylists,
        downloadedPlaylists: downloadResult.downloadedPlaylists,
        uploadedSongs: uploadResult.uploadedSongs,
        downloadedSongs: downloadResult.downloadedSongs,
        errors: [...uploadResult.errors, ...downloadResult.errors],
      };

      lastSyncResult.value = combined;
      lastSyncTime.value = Date.now();

      logSync(`syncPlaylists 完成: uploaded=${combined.uploadedPlaylists}歌单/${combined.uploadedSongs}歌, downloaded=${combined.downloadedPlaylists}歌单/${combined.downloadedSongs}歌, errors=${combined.errors.length}`);
      if (combined.errors.length > 0) {
        combined.errors.forEach((err, idx) => logSyncError(`syncPlaylists error[${idx}]: ${err}`));
      }

      if (combined.errors.length > 0) {
        showToast(`歌单同步完成（${combined.errors.length} 个错误）`, 'error');
      } else {
        const parts: string[] = [];
        if (combined.uploadedPlaylists > 0) parts.push(`上传 ${combined.uploadedPlaylists} 个歌单`);
        if (combined.downloadedPlaylists > 0) parts.push(`下载 ${combined.downloadedPlaylists} 个歌单`);
        showToast(parts.length > 0 ? `歌单同步完成：${parts.join('，')}` : '歌单已是最新', 'success');
      }

      logSync('========== syncPlaylists 结束 ==========');
      return combined;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logSyncError(`syncPlaylists 异常: ${msg}`, error);
      showToast(`歌单同步失败：${msg}`, 'error');
      return {
        uploadedPlaylists: 0,
        downloadedPlaylists: 0,
        uploadedSongs: 0,
        downloadedSongs: 0,
        errors: [msg],
      };
    } finally {
      logSync('syncPlaylists: finally 块执行, 重置 syncing/syncProgress');
      syncing.value = false;
      syncProgress.value = '';
    }
  }

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

  // ==================== 自动同步调度挂载 ====================

  function patchAutoSyncConfig(patch: Partial<AutoSyncConfig>) {
    settingsStore.patchSettings({
      autoSync: patch,
    });
    getAutoSyncScheduler().restart();
  }

  function initAutoSync() {
    if (autoSyncInitialized) return;
    autoSyncInitialized = true;

    const scheduler = getAutoSyncScheduler();
    scheduler.init({
      getConfig: () => settingsStore.settings.autoSync,
      updateConfig: (patch) => settingsStore.patchSettings({ autoSync: patch }),
      canSync: () => canSync(),
      onSync: performAutoSync,
      onSyncStart: () => {
        autoSyncStatus.value = '正在自动同步...';
        autoSyncDelayed.value = false;
      },
      onSyncComplete: (success) => {
        autoSyncStatus.value = success ? '自动同步完成' : '自动同步未完成';
        if (autoSyncStatusTimer) {
          clearTimeout(autoSyncStatusTimer);
        }
        autoSyncStatusTimer = setTimeout(() => {
          autoSyncStatus.value = '';
          autoSyncStatusTimer = null;
        }, 5000);
      },
      onDelayed: (delaySeconds, attempt) => {
        autoSyncDelayed.value = true;
        const delayMin = Math.ceil(delaySeconds / 60);
        autoSyncStatus.value = `服务器繁忙，自动延后 ${delayMin} 分钟（第 ${attempt} 次）`;
        showToast(`服务器当前同步用户过多，已自动延后 ${delayMin} 分钟`, 'info');
      },
    });

    if (canSync()) {
      scheduler.start();
    }
  }

  function checkAutoSync() {
    const scheduler = getAutoSyncScheduler();
    if (settingsStore.settings.autoSync.enabled && canSync()) {
      scheduler.restart();
    } else {
      // 自动同步关闭/未登录也维持心跳（tick 内部门控：关闭时只做听歌统计
      // 快照拉取，未登录时 start 直接不起定时器）
      scheduler.start();
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
    syncPlugins: pluginFlow.syncPlugins,
    syncSettings: settingsFlow.syncSettings,
    uploadOnly,
    downloadOnly,
    uploadPluginsOnly: pluginFlow.uploadPluginsOnly,
    downloadPluginsOnly: pluginFlow.downloadPluginsOnly,
    uploadSettingsOnly: settingsFlow.uploadSettingsOnly,
    downloadSettingsOnly: settingsFlow.downloadSettingsOnly,
    uploadFavoritesOnly: favoritesFlow.uploadFavoritesOnly,
    downloadFavoritesOnly: favoritesFlow.downloadFavoritesOnly,
    syncFavorites: favoritesFlow.syncFavorites,
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
