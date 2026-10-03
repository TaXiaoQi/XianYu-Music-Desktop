import type { AppSettings } from '../../../types';
import { mergeAppSettings, createDefaultAppSettings } from '../../../features/settings/store';
import { playerStorage } from '../../storage/playerStorage';
import {
  areSettingsEqual,
  downloadSettings,
  uploadSettings,
  type SettingsSyncResult,
} from '../settingsSync';
import { downloadPlugins, uploadPlugins } from '../pluginSync';
import type { SyncResult } from '../playlistSync';
import type { ToastKind } from './toastKind';

// ==================== 冲突分支类型（UI 弹窗端口实现本类型协议） ====================

export type SettingsChoiceValue = 'local' | 'cloud';

export interface SettingsCategoryChoices {
  settings: SettingsChoiceValue;
  playlists: SettingsChoiceValue;
  plugins: SettingsChoiceValue;
}

export type SettingsConflictChoice = 'cancel' | SettingsCategoryChoices;

// ==================== 端口（由 UI 层注入状态、反馈与冲突弹窗） ====================

export interface SettingsSyncPorts {
  canSync(): boolean;
  isSettingsUploadEnabled(): boolean;
  isPlaylistUploadEnabled(): boolean;
  isPluginUploadEnabled(): boolean;
  getSettings(): AppSettings;
  replaceSettings(settings: AppSettings): void;
  onProgress(msg: string): void;
  notify(msg: string, kind: ToastKind): void;
  setSyncing(v: boolean): void;
  setLastResult(result: SettingsSyncResult | null): void;
  setLastTime(time: number): void;
  /** UI 冲突弹窗端口：返回 cancel 或三路类别选择 */
  resolveConflict(uploadedAt?: string): Promise<SettingsConflictChoice>;
  /** 歌单上下行由 playlistSyncService 提供 */
  uploadPlaylists(): Promise<SyncResult>;
  downloadPlaylists(): Promise<SyncResult>;
  log(msg: string, ...args: unknown[]): void;
  logError(msg: string, ...args: unknown[]): void;
}

// ==================== 流程（业务决策与 IO，UI 状态经端口写入） ====================

/** 云端设置落地：合并默认值后保留本地性字段（下载路径/上传开关/整理根目录）。 */
function applyCloudSettingsLocally(
  ports: SettingsSyncPorts,
  cloudSettings: AppSettings,
): AppSettings {
  const currentSettings = ports.getSettings();
  const merged = mergeAppSettings(createDefaultAppSettings(), cloudSettings as any);
  merged.download.downloadPath = currentSettings.download.downloadPath;
  merged.upload = currentSettings.upload;
  merged.organizeRoot = currentSettings.organizeRoot;
  ports.replaceSettings(merged);
  playerStorage.writeSettings(merged);
  return merged;
}

export function createSettingsSyncFlow(ports: SettingsSyncPorts) {
  async function uploadSettingsOnly(): Promise<void> {
    ports.log('========== uploadSettingsOnly 开始 ==========');
    if (!ports.canSync()) {
      ports.logError('uploadSettingsOnly: 未登录或无弦予号');
      ports.notify('请先登录后再同步', 'error');
      return;
    }

    if (!ports.isSettingsUploadEnabled()) {
      ports.log('uploadSettingsOnly: 设置同步未开启');
      ports.notify('设置同步已关闭，请在设置中开启', 'info');
      return;
    }

    ports.setSyncing(true);
    ports.onProgress('正在上传设置到云端...');

    try {
      const result = await uploadSettings(ports.getSettings());
      ports.setLastTime(Date.now());
      ports.setLastResult(result);
      ports.log(`uploadSettingsOnly 完成: uploaded=${result.uploaded}, errors=${result.errors.length}`);

      if (result.errors.length > 0) {
        ports.notify(`设置上传完成（${result.errors.length} 个错误）`, 'error');
      } else if (result.uploaded) {
        ports.notify('设置已上传到云端', 'success');
      } else {
        ports.notify('设置上传失败', 'info');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ports.logError(`uploadSettingsOnly 异常: ${msg}`, error);
      ports.notify(`设置上传失败：${msg}`, 'error');
    } finally {
      ports.setSyncing(false);
      ports.onProgress('');
    }
  }

  async function downloadSettingsOnly(): Promise<void> {
    ports.log('========== downloadSettingsOnly 开始 ==========');
    if (!ports.canSync()) {
      ports.logError('downloadSettingsOnly: 未登录或无弦予号');
      ports.notify('请先登录后再同步', 'error');
      return;
    }

    ports.setSyncing(true);
    ports.onProgress('正在从云端下载设置...');

    try {
      const { settings: cloudSettings, result } = await downloadSettings();
      ports.setLastTime(Date.now());
      ports.setLastResult(result);
      ports.log(`downloadSettingsOnly 完成: downloaded=${result.downloaded}, errors=${result.errors.length}`);

      if (result.errors.length > 0) {
        ports.notify(`设置下载完成（${result.errors.length} 个错误）`, 'error');
      } else if (cloudSettings) {
        applyCloudSettingsLocally(ports, cloudSettings);
        ports.notify('设置已从云端恢复', 'success');
      } else {
        ports.notify('云端暂无设置数据', 'info');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ports.logError(`downloadSettingsOnly 异常: ${msg}`, error);
      ports.notify(`设置下载失败：${msg}`, 'error');
    } finally {
      ports.setSyncing(false);
      ports.onProgress('');
    }
  }

  async function syncSettings(): Promise<SettingsSyncResult> {
    ports.log('========== syncSettings 开始 ==========');
    if (!ports.canSync()) {
      ports.logError('syncSettings: 未登录或无弦予号，取消同步');
      ports.notify('请先登录后再同步', 'error');
      return { uploaded: false, downloaded: false, errors: ['未登录'] };
    }

    ports.setSyncing(true);
    ports.onProgress('正在同步设置...');
    ports.setLastResult(null);

    try {
      ports.log('syncSettings: 步骤 1/2 - 下载云端设置进行比较');
      ports.onProgress('正在从云端获取设置...');
      const { settings: cloudSettings, uploadedAt, result: downloadResult } = await downloadSettings();
      ports.log('syncSettings: 步骤 1/2 - 云端设置下载完成', downloadResult);

      if (!cloudSettings) {
        if (ports.isSettingsUploadEnabled()) {
          ports.log('syncSettings: 云端无数据，上传本地设置');
          ports.onProgress('正在上传本地设置到云端...');
          const uploadResult = await uploadSettings(ports.getSettings());
          ports.setLastResult(uploadResult);
          ports.setLastTime(Date.now());
          if (uploadResult.errors.length > 0) {
            ports.notify(`设置同步完成（${uploadResult.errors.length} 个错误）`, 'error');
          } else {
            ports.notify('设置已上传到云端', 'success');
          }
          ports.log('========== syncSettings 结束（首次上传） ==========');
          return uploadResult;
        }
        ports.log('syncSettings: 云端无数据且上传未开启，跳过');
        ports.setLastResult(downloadResult);
        ports.setLastTime(Date.now());
        ports.notify('云端暂无设置数据', 'info');
        return downloadResult;
      }

      const localSettings = ports.getSettings();
      const isEqual = areSettingsEqual(localSettings, cloudSettings);

      if (isEqual) {
        ports.log('syncSettings: 本地与云端设置一致，跳过同步');
        ports.setLastResult({ uploaded: false, downloaded: false, errors: [] });
        ports.setLastTime(Date.now());
        ports.notify('本地与云端设置一致，无需同步', 'info');
        ports.log('========== syncSettings 结束（一致跳过） ==========');
        return { uploaded: false, downloaded: false, errors: [] };
      }

      ports.log('syncSettings: 本地与云端设置不一致，等待用户选择');
      ports.onProgress('检测到设置不一致，等待用户选择...');
      const choice = await ports.resolveConflict(uploadedAt ?? undefined);

      if (choice === 'cancel') {
        ports.log('syncSettings: 用户取消同步');
        ports.setLastResult({ uploaded: false, downloaded: false, errors: [] });
        ports.setLastTime(Date.now());
        ports.notify('已取消设置同步', 'info');
        ports.log('========== syncSettings 结束（用户取消） ==========');
        return { uploaded: false, downloaded: false, errors: [] };
      }

      const choices = choice as SettingsCategoryChoices;
      const errors: string[] = [];
      let uploaded = false;
      let downloaded = false;

      // --- 设置 ---
      if (choices.settings === 'local') {
        if (ports.isSettingsUploadEnabled()) {
          ports.log('syncSettings: 设置 → 保留本地，上传覆盖云端');
          ports.onProgress('正在上传本地设置到云端...');
          const r = await uploadSettings(localSettings);
          uploaded = r.uploaded;
          errors.push(...r.errors);
        } else {
          ports.log('syncSettings: 设置 → 保留本地，但上传未开启，跳过');
        }
      } else {
        ports.log('syncSettings: 设置 → 保留云端，下载覆盖本地');
        ports.onProgress('正在从云端恢复设置...');
        applyCloudSettingsLocally(ports, cloudSettings);
        downloaded = true;
        errors.push(...downloadResult.errors);
      }

      // --- 歌单 ---
      if (choices.playlists === 'local') {
        if (ports.isPlaylistUploadEnabled()) {
          ports.log('syncSettings: 歌单 → 保留本地，上传到云端');
          ports.onProgress('正在上传本地歌单到云端...');
          try {
            await ports.uploadPlaylists();
          } catch (e) {
            errors.push(e instanceof Error ? e.message : String(e));
          }
        } else {
          ports.log('syncSettings: 歌单 → 保留本地，但上传未开启，跳过');
        }
      } else {
        ports.log('syncSettings: 歌单 → 保留云端，下载到本地');
        ports.onProgress('正在从云端下载歌单...');
        try {
          await ports.downloadPlaylists();
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }

      // --- 插件 ---
      if (choices.plugins === 'local') {
        if (ports.isPluginUploadEnabled()) {
          ports.log('syncSettings: 插件 → 保留本地，上传到云端');
          ports.onProgress('正在上传本地插件到云端...');
          try {
            await uploadPlugins();
          } catch (e) {
            errors.push(e instanceof Error ? e.message : String(e));
          }
        } else {
          ports.log('syncSettings: 插件 → 保留本地，但上传未开启，跳过');
        }
      } else {
        ports.log('syncSettings: 插件 → 保留云端，下载到本地');
        ports.onProgress('正在从云端下载插件...');
        try {
          await downloadPlugins();
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }

      const combinedResult: SettingsSyncResult = { uploaded, downloaded, errors };
      ports.setLastResult(combinedResult);
      ports.setLastTime(Date.now());

      if (errors.length > 0) {
        ports.notify(`同步完成（${errors.length} 个错误）`, 'error');
      } else {
        ports.notify('同步完成', 'success');
      }
      ports.log('========== syncSettings 结束（按类别同步） ==========');
      return combinedResult;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ports.logError(`syncSettings 异常: ${msg}`, error);
      ports.notify(`设置同步失败：${msg}`, 'error');
      return { uploaded: false, downloaded: false, errors: [msg] };
    } finally {
      ports.setSyncing(false);
      ports.onProgress('');
    }
  }

  return {
    syncSettings,
    uploadSettingsOnly,
    downloadSettingsOnly,
  };
}
