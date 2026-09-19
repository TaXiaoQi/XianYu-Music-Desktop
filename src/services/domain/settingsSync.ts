
import type { AppSettings } from '../../types';
import { signedRequest } from '../auth/authService';
import { getCiyuanxiId } from './playlistSync';

// ==================== 设置比较 ====================

function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value).sort()) {
        sorted[k] = (value as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return value;
  });
}

export function normalizeSettingsForComparison(settings: AppSettings): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(settings)) as Record<string, unknown>;

  if (cloned.download && typeof cloned.download === 'object') {
    (cloned.download as Record<string, unknown>).downloadPath = '';
  }
  (cloned as Record<string, unknown>).organizeRoot = '';

  delete (cloned as Record<string, unknown>).upload;

  if (cloned.autoSync && typeof cloned.autoSync === 'object') {
    const autoSync = cloned.autoSync as Record<string, unknown>;
    delete autoSync.delayedCount;
    delete autoSync.lastSyncAttemptAt;
    delete autoSync.lastSyncSuccessAt;
    delete autoSync.nextSyncAt;
  }

  return cloned;
}

export function areSettingsEqual(local: AppSettings, cloud: AppSettings): boolean {
  const normalizedLocal = normalizeSettingsForComparison(local);
  const normalizedCloud = normalizeSettingsForComparison(cloud);
  return stableStringify(normalizedLocal) === stableStringify(normalizedCloud);
}

const LOG = '[SettingsSync]';

function logSync(_msg: string, ..._args: unknown[]) {
}

function logSyncError(msg: string, ...args: unknown[]) {
  console.error(`${LOG} ${msg}`, ...args);
}

export interface SettingsSyncDownloadData {
  version: number;
  uploaded_at: string;
  timestamp: number;
  settings: AppSettings;
}

export interface SettingsSyncResult {
  uploaded: boolean;
  downloaded: boolean;
  errors: string[];
}

// ==================== 上传 ====================

export async function uploadSettings(settings: AppSettings): Promise<SettingsSyncResult> {
  const result: SettingsSyncResult = {
    uploaded: false,
    downloaded: false,
    errors: [],
  };

  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId) {
    logSyncError('uploadSettings: 未获取到弦予号');
    result.errors.push('未登录或未获取到弦予号');
    return result;
  }

  logSync('uploadSettings: 开始上传本地设置');

  try {
    const settingsToUpload: AppSettings = {
      ...settings,
      download: {
        ...settings.download,
        downloadPath: '',
      },
    };

    await signedRequest('settings_sync_upload', {
      user_id: ciyuanxiId,
      platform: 'desktop',
      settings: settingsToUpload,
    }, {
      fetchTimeoutMs: 15_000,
      timeoutMs: 20_000,
    });

    result.uploaded = true;
    logSync('uploadSettings: 上传成功');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logSyncError(`uploadSettings: 上传失败: ${msg}`);
    result.errors.push(`上传失败: ${msg}`);
  }

  return result;
}

// ==================== 下载 ====================

export async function downloadSettings(): Promise<{ settings: AppSettings | null; uploadedAt: string | null; result: SettingsSyncResult }> {
  const result: SettingsSyncResult = {
    uploaded: false,
    downloaded: false,
    errors: [],
  };

  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId) {
    logSyncError('downloadSettings: 未获取到弦予号');
    result.errors.push('未登录或未获取到弦予号');
    return { settings: null, uploadedAt: null, result };
  }

  logSync('downloadSettings: 开始从云端下载设置');

  try {
    const downloadData = await signedRequest<SettingsSyncDownloadData>('settings_sync_download', {
      user_id: ciyuanxiId,
      platform: 'desktop',
    });

    if (!downloadData || !downloadData.settings) {
      logSync('downloadSettings: 云端无设置数据');
      return { settings: null, uploadedAt: null, result };
    }

    result.downloaded = true;
    logSync(`downloadSettings: 下载成功, uploaded_at=${downloadData.uploaded_at}`);
    return { settings: downloadData.settings, uploadedAt: downloadData.uploaded_at ?? null, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logSyncError(`downloadSettings: 下载失败: ${msg}`);
    result.errors.push(`下载失败: ${msg}`);
    return { settings: null, uploadedAt: null, result };
  }
}
