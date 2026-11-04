import type { AppSettings } from '../../../types';
import { mergeAppSettings, createDefaultAppSettings } from '../../../features/settings/store';
import { playerStorage } from '../../storage/playerStorage';
import {
  areSettingsEqual,
  buildFullSectionTs,
  downloadSettings,
  mergeSettingsBySection,
  parseUploadedAtMs,
  readLocalSectionTs,
  resolveCloudSectionTs,
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
  /** 纯登录态：未登录时服务层应提示「请先登录」，与互斥区分开 */
  isAuthed(): boolean;
  isSettingsUploadEnabled(): boolean;
  isPlaylistUploadEnabled(): boolean;
  isPluginUploadEnabled(): boolean;
  getSettings(): AppSettings;
  replaceSettings(settings: AppSettings): void;
  /** 同步后按映射写回分节时间戳账本（覆盖语义，供 LWW 对齐） */
  applySectionTimestamps(timestamps: Record<string, number>): void;
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

/** 设备本地字段恒以本端为准（下载路径/整理根目录/上传开关/自动同步运行时计数） */
function withDeviceLocalFields(current: AppSettings, merged: AppSettings): AppSettings {
  return {
    ...merged,
    organizeRoot: current.organizeRoot,
    upload: current.upload,
    download: { ...merged.download, downloadPath: current.download.downloadPath },
    autoSync: {
      ...merged.autoSync,
      delayedCount: current.autoSync.delayedCount,
      lastSyncAttemptAt: current.autoSync.lastSyncAttemptAt,
      lastSyncSuccessAt: current.autoSync.lastSyncSuccessAt,
      nextSyncAt: current.autoSync.nextSyncAt,
    },
  };
}

export function createSettingsSyncFlow(ports: SettingsSyncPorts) {
  async function uploadSettingsOnly(options?: { silent?: boolean }): Promise<void> {
    const notify = (msg: string, kind: ToastKind) => { if (!options?.silent) ports.notify(msg, kind); };
    ports.log('========== uploadSettingsOnly 开始 ==========');
    if (!ports.isAuthed()) {
      ports.logError('uploadSettingsOnly: 未登录或无弦予号');
      ports.notify('请先登录后再同步', 'error');
      return;
    }
    if (!ports.canSync()) {
      // 其他域同步中（互斥）：静默跳过，避免误报「未登录」
      ports.log('uploadSettingsOnly: 其他同步进行中，跳过本次');
      return;
    }

    if (!ports.isSettingsUploadEnabled()) {
      ports.log('uploadSettingsOnly: 设置同步未开启');
      notify('设置同步已关闭，请在设置中开启', 'info');
      return;
    }

    ports.setSyncing(true);
    ports.onProgress('正在同步设置...');

    try {
      const localSettings = ports.getSettings();
      ports.onProgress('正在从云端获取设置...');
      const { settings: cloudSettings, uploadedAt, sectionTs: cloudSectionTs, result: downloadResult } = await downloadSettings();

      if (downloadResult.errors.length > 0) {
        // 下载失败不能当作「云端无数据」，否则会把本地全量推上去覆盖云端
        ports.setLastResult(downloadResult);
        ports.setLastTime(Date.now());
        ports.log(`uploadSettingsOnly: 下载云端设置失败，中止本次同步: ${downloadResult.errors[0]}`);
        notify(`设置同步失败：${downloadResult.errors[0]}`, 'error');
        return;
      }

      if (!cloudSettings) {
        // 云端无数据：全量上传并携带分节时间戳账本
        const sectionTs = buildFullSectionTs(localSettings);
        const uploadResult = await uploadSettings(localSettings, { sectionTs });
        ports.applySectionTimestamps(sectionTs);
        ports.setLastTime(Date.now());
        ports.setLastResult(uploadResult);
        ports.log(`uploadSettingsOnly 完成: uploaded=${uploadResult.uploaded}, errors=${uploadResult.errors.length}`);
        if (uploadResult.errors.length > 0) {
          notify(`设置上传完成（${uploadResult.errors.length} 个错误）`, 'error');
        } else if (uploadResult.uploaded) {
          notify('设置已上传到云端', 'success');
        } else {
          notify('设置上传失败', 'info');
        }
        return;
      }

      if (!cloudSectionTs) {
        // 云端快照未携带分节账本（旧版端上传）：无法判定分节新旧，
        // 维持旧行为以上传为准，并落一份本端账本供新版端后续 LWW
        ports.log('uploadSettingsOnly: 云端无分节账本（旧版端上传），整体上传');
        const sectionTs = buildFullSectionTs(localSettings);
        const uploadResult = await uploadSettings(localSettings, { sectionTs });
        ports.applySectionTimestamps(sectionTs);
        ports.setLastTime(Date.now());
        ports.setLastResult(uploadResult);
        ports.log(`uploadSettingsOnly 完成: uploaded=${uploadResult.uploaded}, errors=${uploadResult.errors.length}`);
        if (uploadResult.errors.length > 0) {
          notify(`设置上传完成（${uploadResult.errors.length} 个错误）`, 'error');
        } else if (uploadResult.uploaded) {
          notify('设置已上传到云端', 'success');
        } else {
          notify('设置上传失败', 'info');
        }
        return;
      }

      // 云端有分节账本：按分节 LWW 合并（云端较新落地本地，本地较新上传云端）
      const cloudTs = resolveCloudSectionTs(cloudSettings, cloudSectionTs, parseUploadedAtMs(uploadedAt));
      const merge = mergeSettingsBySection(localSettings, cloudSettings, readLocalSectionTs(), cloudTs);
      ports.log(`uploadSettingsOnly: 云端较新=[${merge.cloudWonSections.join(',') || '无'}], 本地较新=[${merge.localWonSections.join(',') || '无'}]`);

      if (merge.cloudWonSections.length === 0 && merge.localWonSections.length === 0
        && !areSettingsEqual(localSettings, cloudSettings)) {
        // 时间戳持平但内容有差异（多见于账本刚启用）：以本端为准整体上传并重新打点，避免永久停滞
        ports.log('uploadSettingsOnly: 时间戳持平但内容有差异，整体上传');
        merge.localWonSections.push(...Object.keys(merge.mergedSectionTs));
        const now = Date.now();
        for (const key of Object.keys(merge.mergedSectionTs)) {
          merge.mergedSectionTs[key] = now;
        }
      }

      let uploaded = false;
      const errors: string[] = [];

      if (merge.cloudWonSections.length > 0) {
        ports.onProgress('正在应用云端较新的设置...');
        const applied = withDeviceLocalFields(localSettings, merge.merged);
        ports.replaceSettings(applied);
        playerStorage.writeSettings(applied);
      }
      // 账本全量对齐（云端较新分节记云端时刻，其余保持本地时刻）
      ports.applySectionTimestamps(merge.mergedSectionTs);

      if (merge.localWonSections.length > 0) {
        ports.onProgress('正在上传本地较新的设置...');
        const payload = withDeviceLocalFields(localSettings, merge.merged);
        const uploadResult = await uploadSettings(payload, { sectionTs: merge.mergedSectionTs });
        uploaded = uploadResult.uploaded;
        errors.push(...uploadResult.errors);
      }

      ports.setLastTime(Date.now());
      ports.setLastResult({ uploaded, downloaded: merge.cloudWonSections.length > 0, errors });
      ports.log(`uploadSettingsOnly 完成: uploaded=${uploaded}, cloudWon=${merge.cloudWonSections.length}, errors=${errors.length}`);
      if (errors.length > 0) {
        notify(`设置同步完成（${errors.length} 个错误）`, 'error');
      } else if (uploaded && merge.cloudWonSections.length > 0) {
        notify('设置已双向合并同步', 'success');
      } else if (uploaded) {
        notify('设置已上传到云端', 'success');
      } else if (merge.cloudWonSections.length > 0) {
        notify('设置已从云端更新', 'success');
      } else {
        notify('本地与云端设置一致，无需同步', 'info');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ports.logError(`uploadSettingsOnly 异常: ${msg}`, error);
      notify(`设置上传失败：${msg}`, 'error');
    } finally {
      ports.setSyncing(false);
      ports.onProgress('');
    }
  }

  async function downloadSettingsOnly(): Promise<void> {
    ports.log('========== downloadSettingsOnly 开始 ==========');
    if (!ports.isAuthed()) {
      ports.logError('downloadSettingsOnly: 未登录或无弦予号');
      ports.notify('请先登录后再同步', 'error');
      return;
    }
    if (!ports.canSync()) {
      // 其他域同步中（互斥）：静默跳过，避免误报「未登录」
      ports.log('downloadSettingsOnly: 其他同步进行中，跳过本次');
      return;
    }

    ports.setSyncing(true);
    ports.onProgress('正在从云端下载设置...');

    try {
      const { settings: cloudSettings, uploadedAt, sectionTs, result } = await downloadSettings();
      ports.setLastTime(Date.now());
      ports.setLastResult(result);
      ports.log(`downloadSettingsOnly 完成: downloaded=${result.downloaded}, errors=${result.errors.length}`);

      if (result.errors.length > 0) {
        ports.notify(`设置下载完成（${result.errors.length} 个错误）`, 'error');
      } else if (cloudSettings) {
        applyCloudSettingsLocally(ports, cloudSettings);
        // 全量落地：全部分节记云端时刻，避免下次自动同步把云端内容又推回去
        ports.applySectionTimestamps(
          resolveCloudSectionTs(cloudSettings, sectionTs, parseUploadedAtMs(uploadedAt)),
        );
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
    if (!ports.isAuthed()) {
      ports.logError('syncSettings: 未登录或无弦予号，取消同步');
      ports.notify('请先登录后再同步', 'error');
      return { uploaded: false, downloaded: false, errors: ['未登录'] };
    }
    if (!ports.canSync()) {
      // 其他域同步中（互斥）：静默跳过，避免误报「未登录」
      ports.log('syncSettings: 其他同步进行中，跳过本次');
      return { uploaded: false, downloaded: false, errors: [] };
    }

    ports.setSyncing(true);
    ports.onProgress('正在同步设置...');
    ports.setLastResult(null);

    try {
      ports.log('syncSettings: 步骤 1/2 - 下载云端设置进行比较');
      ports.onProgress('正在从云端获取设置...');
      const { settings: cloudSettings, uploadedAt, sectionTs, result: downloadResult } = await downloadSettings();
      ports.log('syncSettings: 步骤 1/2 - 云端设置下载完成', downloadResult);

      if (!cloudSettings) {
        if (ports.isSettingsUploadEnabled()) {
          ports.log('syncSettings: 云端无数据，上传本地设置');
          ports.onProgress('正在上传本地设置到云端...');
          const sectionTs = buildFullSectionTs(ports.getSettings());
          ports.applySectionTimestamps(sectionTs);
          const uploadResult = await uploadSettings(ports.getSettings(), { sectionTs });
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
          // 保留本地 = 本端成为全部分节的最新持有者，先对齐账本再上传
          const sectionTs = buildFullSectionTs(localSettings);
          ports.applySectionTimestamps(sectionTs);
          const r = await uploadSettings(localSettings, { sectionTs });
          uploaded = r.uploaded;
          errors.push(...r.errors);
        } else {
          ports.log('syncSettings: 设置 → 保留本地，但上传未开启，跳过');
        }
      } else {
        ports.log('syncSettings: 设置 → 保留云端，下载覆盖本地');
        ports.onProgress('正在从云端恢复设置...');
        applyCloudSettingsLocally(ports, cloudSettings);
        ports.applySectionTimestamps(
          resolveCloudSectionTs(cloudSettings, sectionTs, parseUploadedAtMs(uploadedAt)),
        );
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
