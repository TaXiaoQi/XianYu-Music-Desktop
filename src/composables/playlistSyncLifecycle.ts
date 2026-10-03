import { useSettingsStore } from '../features/settings/store';
import { useStatisticsStore } from '../features/statistics/store';
import { getAutoSyncScheduler } from '../services/domain/autoSync';
import { syncListenStats } from '../services/domain/listenStatsSync';
import {
  autoSyncStatus,
  autoSyncDelayed,
  loginSyncCompleted,
  persistLoginSyncCompleted,
} from './playlistSyncState';
import { useToast } from './toast';
import type { AutoSyncConfig } from '../types';
import type { SyncResult } from '../services/domain/playlistSync';
import type { PluginSyncResult } from '../services/domain/pluginSync';
import type { SettingsSyncResult } from '../services/domain/settingsSync';

let autoSyncInitialized = false;
let autoSyncStatusTimer: ReturnType<typeof setTimeout> | null = null;
let loginSyncInProgress = false;
let syncOperationInProgress = false;

export interface SyncLifecycleCoordinatorDeps {
  settingsStore: ReturnType<typeof useSettingsStore>;
  statisticsStore: ReturnType<typeof useStatisticsStore>;
  canSync: () => boolean;
  uploadPlaylists: () => Promise<SyncResult>;
  uploadPluginsOnly: () => Promise<void>;
  uploadFavoritesOnly: () => Promise<void>;
  uploadSettingsOnly: () => Promise<void>;
  syncPlaylists: () => Promise<SyncResult>;
  syncPlugins: () => Promise<PluginSyncResult>;
  syncFavorites: () => Promise<void>;
  syncSettings: () => Promise<SettingsSyncResult>;
  showToast: ReturnType<typeof useToast>['showToast'];
  logSync: (message: string, ...args: unknown[]) => void;
  logSyncError: (message: string, ...args: unknown[]) => void;
}

export function createSyncLifecycleCoordinator({
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
}: SyncLifecycleCoordinatorDeps) {
async function performAutoSync(): Promise<void> {
  if (syncOperationInProgress) {
    logSync('performAutoSync: 其他同步流程进行中，跳过本次自动同步');
    return;
  }
  syncOperationInProgress = true;
  try {
    logSync('performAutoSync: 开始自动同步（客户端为主，只上传）');
    const upload = settingsStore.settings.upload;
    let hasError = false;

    const parallelTasks: Array<{ label: string; run: () => Promise<unknown> }> = [];
    if (upload.playlists) {
      parallelTasks.push({ label: '上传歌单', run: uploadPlaylists });
    }
    if (upload.plugins) {
      parallelTasks.push({ label: '上传插件', run: uploadPluginsOnly });
    }
    if (upload.favorites) {
      parallelTasks.push({ label: '上传收藏', run: uploadFavoritesOnly });
    }
    if (upload.settings) {
      parallelTasks.push({ label: '上传设置', run: uploadSettingsOnly });
    }

    if (parallelTasks.length > 0) {
      const results = await Promise.allSettled(parallelTasks.map(task => task.run()));
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          logSyncError(`performAutoSync: ${parallelTasks[index].label}失败`, result.reason);
          hasError = true;
        }
      });
    }

    logSync('performAutoSync: 上传完成，开始听歌时长快照同步');
    try {
      await syncListenStats();
      await statisticsStore.refreshBehaviorOnly('All');
    } catch (e) {
      logSyncError('performAutoSync: 听歌时长快照同步失败', e);
      hasError = true;
      await statisticsStore.refreshBehaviorOnly('All').catch(() => undefined);
    }

    logSync('performAutoSync: 自动同步完成');
    if (hasError) {
      throw new Error('部分同步项失败');
    }
  } finally {
    syncOperationInProgress = false;
  }
}

async function syncOnLoginSuccess(): Promise<void> {
  if (loginSyncCompleted.value) {
    logSync('syncOnLoginSuccess: 首次登录同步已完成，跳过');
    return;
  }
  if (loginSyncInProgress) return;
  if (syncOperationInProgress) {
    logSync('syncOnLoginSuccess: 其他同步流程进行中，跳过本次登录同步');
    return;
  }
  loginSyncInProgress = true;
  syncOperationInProgress = true;
  logSync('========== 首次登录全量同步开始 ==========');
  const upload = settingsStore.settings.upload;
  try {
    const tasks: Array<{ label: string; run: () => Promise<unknown> }> = [];
    if (upload.playlists) {
      tasks.push({ label: '同步歌单', run: syncPlaylists });
    }
    if (upload.plugins) {
      tasks.push({ label: '同步插件', run: syncPlugins });
    }
    if (upload.favorites) {
      tasks.push({ label: '同步收藏', run: syncFavorites });
    }
    if (tasks.length > 0) {
      await Promise.allSettled(tasks.map(task => task.run()));
    }
    try {
      await syncListenStats();
      await statisticsStore.refreshBehaviorOnly('All');
    } catch (e) {
      logSyncError('syncOnLoginSuccess: 听歌时长快照同步失败', e);
      await statisticsStore.refreshBehaviorOnly('All').catch(() => undefined);
    }
    if (upload.settings) {
      try {
        await syncSettings();
      } catch (e) {
        logSyncError('syncOnLoginSuccess: 首次设置同步失败', e);
      }
    }
  } catch (e) {
    logSyncError('syncOnLoginSuccess: 首次全量同步异常', e);
  } finally {
    loginSyncCompleted.value = true;
    persistLoginSyncCompleted();
    loginSyncInProgress = false;
    syncOperationInProgress = false;
    logSync('========== 首次登录全量同步结束 ==========');
  }
}

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

  if (canSync() && settingsStore.settings.autoSync.enabled) {
    scheduler.start();
  }
}

function checkAutoSync() {
  const scheduler = getAutoSyncScheduler();
  if (settingsStore.settings.autoSync.enabled && canSync()) {
    scheduler.restart();
  } else {
    scheduler.stop();
  }
}

  return {
    initAutoSync,
    checkAutoSync,
    patchAutoSyncConfig,
    performAutoSync,
    syncOnLoginSuccess,
  };
}
