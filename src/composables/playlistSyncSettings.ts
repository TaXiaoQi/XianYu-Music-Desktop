import { useSettingsStore } from '../features/settings/store';
import {
  uploadSettings as uploadSettingsToCloud,
  downloadSettings as downloadSettingsFromCloud,
  areSettingsEqual,
  type SettingsSyncResult,
} from '../services/domain/settingsSync';
import {
  uploadPlugins as uploadPluginsToCloud,
  downloadPlugins as downloadPluginsFromCloud,
} from '../services/domain/pluginSync';
import {
  showSettingsConflict,
  type SyncCategoryChoices,
} from './useSettingsConflict';
import { mergeAppSettings, createDefaultAppSettings } from '../features/settings/store';
import { playerStorage } from '../services/storage/playerStorage';
import {
  lastSettingsSyncResult,
  lastSettingsSyncTime,
  settingsSyncProgress,
  settingsSyncing,
} from './playlistSyncState';
import { useToast } from './toast';
import type { SyncResult } from '../services/domain/playlistSync';

export interface SettingsSyncCoordinatorDeps {
  settingsStore: ReturnType<typeof useSettingsStore>;
  canSync: () => boolean;
  isUploadEnabled: () => boolean;
  isPluginUploadEnabled: () => boolean;
  isSettingsUploadEnabled: () => boolean;
  uploadPlaylists: () => Promise<SyncResult>;
  downloadPlaylists: () => Promise<SyncResult>;
  showToast: ReturnType<typeof useToast>['showToast'];
  logSync: (message: string, ...args: unknown[]) => void;
  logSyncError: (message: string, ...args: unknown[]) => void;
}

export function createSettingsSyncCoordinator({
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
}: SettingsSyncCoordinatorDeps) {
async function uploadSettingsOnly(): Promise<void> {
  logSync('========== uploadSettingsOnly 开始 ==========');
  if (!canSync()) {
    logSyncError('uploadSettingsOnly: 未登录或无弦予号');
    showToast('请先登录后再同步', 'error');
    return;
  }

  if (!isSettingsUploadEnabled()) {
    logSync('uploadSettingsOnly: 设置同步未开启');
    showToast('设置同步已关闭，请在设置中开启', 'info');
    return;
  }

  settingsSyncing.value = true;
  settingsSyncProgress.value = '正在上传设置到云端...';

  try {
    const result = await uploadSettingsToCloud(settingsStore.settings);
    lastSettingsSyncTime.value = Date.now();
    lastSettingsSyncResult.value = result;
    logSync(`uploadSettingsOnly 完成: uploaded=${result.uploaded}, errors=${result.errors.length}`);

    if (result.errors.length > 0) {
      showToast(`设置上传完成（${result.errors.length} 个错误）`, 'error');
    } else if (result.uploaded) {
      showToast('设置已上传到云端', 'success');
    } else {
      showToast('设置上传失败', 'info');
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logSyncError(`uploadSettingsOnly 异常: ${msg}`, error);
    showToast(`设置上传失败：${msg}`, 'error');
  } finally {
    settingsSyncing.value = false;
    settingsSyncProgress.value = '';
  }
}

async function downloadSettingsOnly(): Promise<void> {
  logSync('========== downloadSettingsOnly 开始 ==========');
  if (!canSync()) {
    logSyncError('downloadSettingsOnly: 未登录或无弦予号');
    showToast('请先登录后再同步', 'error');
    return;
  }

  settingsSyncing.value = true;
  settingsSyncProgress.value = '正在从云端下载设置...';

  try {
    const { settings: cloudSettings, result } = await downloadSettingsFromCloud();
    lastSettingsSyncTime.value = Date.now();
    lastSettingsSyncResult.value = result;
    logSync(`downloadSettingsOnly 完成: downloaded=${result.downloaded}, errors=${result.errors.length}`);

    if (result.errors.length > 0) {
      showToast(`设置下载完成（${result.errors.length} 个错误）`, 'error');
    } else if (cloudSettings) {
      const currentSettings = settingsStore.settings;
      const merged = mergeAppSettings(createDefaultAppSettings(), cloudSettings as any);
      merged.download.downloadPath = currentSettings.download.downloadPath;
      merged.upload = currentSettings.upload;
      merged.organizeRoot = currentSettings.organizeRoot;
      settingsStore.replaceSettings(merged);

      playerStorage.writeSettings(merged);

      showToast('设置已从云端恢复', 'success');
    } else {
      showToast('云端暂无设置数据', 'info');
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logSyncError(`downloadSettingsOnly 异常: ${msg}`, error);
    showToast(`设置下载失败：${msg}`, 'error');
  } finally {
    settingsSyncing.value = false;
    settingsSyncProgress.value = '';
  }
}

async function syncSettings(): Promise<SettingsSyncResult> {
  logSync('========== syncSettings 开始 ==========');
  if (!canSync()) {
    logSyncError('syncSettings: 未登录或无弦予号，取消同步');
    showToast('请先登录后再同步', 'error');
    return { uploaded: false, downloaded: false, errors: ['未登录'] };
  }

  settingsSyncing.value = true;
  settingsSyncProgress.value = '正在同步设置...';
  lastSettingsSyncResult.value = null;

  try {
    logSync('syncSettings: 步骤 1/2 - 下载云端设置进行比较');
    settingsSyncProgress.value = '正在从云端获取设置...';
    const { settings: cloudSettings, uploadedAt, result: downloadResult } = await downloadSettingsFromCloud();
    logSync('syncSettings: 步骤 1/2 - 云端设置下载完成', downloadResult);

    if (!cloudSettings) {
      if (isSettingsUploadEnabled()) {
        logSync('syncSettings: 云端无数据，上传本地设置');
        settingsSyncProgress.value = '正在上传本地设置到云端...';
        const uploadResult = await uploadSettingsToCloud(settingsStore.settings);
        lastSettingsSyncResult.value = uploadResult;
        lastSettingsSyncTime.value = Date.now();
        if (uploadResult.errors.length > 0) {
          showToast(`设置同步完成（${uploadResult.errors.length} 个错误）`, 'error');
        } else {
          showToast('设置已上传到云端', 'success');
        }
        logSync('========== syncSettings 结束（首次上传） ==========');
        return uploadResult;
      }
      logSync('syncSettings: 云端无数据且上传未开启，跳过');
      lastSettingsSyncResult.value = downloadResult;
      lastSettingsSyncTime.value = Date.now();
      showToast('云端暂无设置数据', 'info');
      return downloadResult;
    }

    const localSettings = settingsStore.settings;
    const isEqual = areSettingsEqual(localSettings, cloudSettings);

    if (isEqual) {
      logSync('syncSettings: 本地与云端设置一致，跳过同步');
      lastSettingsSyncResult.value = { uploaded: false, downloaded: false, errors: [] };
      lastSettingsSyncTime.value = Date.now();
      showToast('本地与云端设置一致，无需同步', 'info');
      logSync('========== syncSettings 结束（一致跳过） ==========');
      return { uploaded: false, downloaded: false, errors: [] };
    }

    logSync('syncSettings: 本地与云端设置不一致，等待用户选择');
    settingsSyncProgress.value = '检测到设置不一致，等待用户选择...';
    const choice = await showSettingsConflict(uploadedAt ?? undefined);

    if (choice === 'cancel') {
      logSync('syncSettings: 用户取消同步');
      lastSettingsSyncResult.value = { uploaded: false, downloaded: false, errors: [] };
      lastSettingsSyncTime.value = Date.now();
      showToast('已取消设置同步', 'info');
      logSync('========== syncSettings 结束（用户取消） ==========');
      return { uploaded: false, downloaded: false, errors: [] };
    }

    const choices = choice as SyncCategoryChoices;
    const errors: string[] = [];
    let uploaded = false;
    let downloaded = false;

    // --- 设置 ---
    if (choices.settings === 'local') {
      if (isSettingsUploadEnabled()) {
        logSync('syncSettings: 设置 → 保留本地，上传覆盖云端');
        settingsSyncProgress.value = '正在上传本地设置到云端...';
        const r = await uploadSettingsToCloud(localSettings);
        uploaded = r.uploaded;
        errors.push(...r.errors);
      } else {
        logSync('syncSettings: 设置 → 保留本地，但上传未开启，跳过');
      }
    } else {
      logSync('syncSettings: 设置 → 保留云端，下载覆盖本地');
      settingsSyncProgress.value = '正在从云端恢复设置...';
      const merged = mergeAppSettings(createDefaultAppSettings(), cloudSettings as any);
      merged.download.downloadPath = localSettings.download.downloadPath;
      merged.upload = localSettings.upload;
      merged.organizeRoot = localSettings.organizeRoot;
      settingsStore.replaceSettings(merged);
      playerStorage.writeSettings(merged);
      downloaded = true;
      errors.push(...downloadResult.errors);
    }

    // --- 歌单 ---
    if (choices.playlists === 'local') {
      if (isUploadEnabled()) {
        logSync('syncSettings: 歌单 → 保留本地，上传到云端');
        settingsSyncProgress.value = '正在上传本地歌单到云端...';
        try {
          await uploadPlaylists();
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      } else {
        logSync('syncSettings: 歌单 → 保留本地，但上传未开启，跳过');
      }
    } else {
      logSync('syncSettings: 歌单 → 保留云端，下载到本地');
      settingsSyncProgress.value = '正在从云端下载歌单...';
      try {
        await downloadPlaylists();
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }

    // --- 插件 ---
    if (choices.plugins === 'local') {
      if (isPluginUploadEnabled()) {
        logSync('syncSettings: 插件 → 保留本地，上传到云端');
        settingsSyncProgress.value = '正在上传本地插件到云端...';
        try {
          await uploadPluginsToCloud();
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      } else {
        logSync('syncSettings: 插件 → 保留本地，但上传未开启，跳过');
      }
    } else {
      logSync('syncSettings: 插件 → 保留云端，下载到本地');
      settingsSyncProgress.value = '正在从云端下载插件...';
      try {
        await downloadPluginsFromCloud();
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }

    const combinedResult: SettingsSyncResult = { uploaded, downloaded, errors };
    lastSettingsSyncResult.value = combinedResult;
    lastSettingsSyncTime.value = Date.now();

    if (errors.length > 0) {
      showToast(`同步完成（${errors.length} 个错误）`, 'error');
    } else {
      showToast('同步完成', 'success');
    }
    logSync('========== syncSettings 结束（按类别同步） ==========');
    return combinedResult;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logSyncError(`syncSettings 异常: ${msg}`, error);
    showToast(`设置同步失败：${msg}`, 'error');
    return { uploaded: false, downloaded: false, errors: [msg] };
  } finally {
    settingsSyncing.value = false;
    settingsSyncProgress.value = '';
  }
}


  return {
    uploadSettingsOnly,
    downloadSettingsOnly,
    syncSettings,
  };
}
