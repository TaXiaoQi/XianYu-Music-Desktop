/**
 * 设置云端同步服务
 *
 * 封装后端 `api/index.php` 的设置同步接口，提供本地设置与云端之间的
 * 双向同步能力。所有请求复用 authService 的签名机制（MD5）。
 *
 * 后端接口一览（action=xxx）：
 * - settings_sync_upload：上传本地设置到云端文件存储
 * - settings_sync_download：下载云端设置到本地
 * - settings_sync_status：查询同步状态
 */

import type { AppSettings } from '../types';
import { signedRequest } from './auth/authService';
import { getCiyuanxiId } from './playlistSync';

/** 日志前缀 */
const LOG = '[SettingsSync]';

function logSync(msg: string, ...args: unknown[]) {
  console.log(`${LOG} ${msg}`, ...args);
}

function logSyncError(msg: string, ...args: unknown[]) {
  console.error(`${LOG} ${msg}`, ...args);
}

/** 云端下载的完整数据 */
export interface SettingsSyncDownloadData {
  version: number;
  uploaded_at: string;
  timestamp: number;
  settings: AppSettings;
}

/** 同步结果 */
export interface SettingsSyncResult {
  uploaded: boolean;
  downloaded: boolean;
  errors: string[];
}

// ==================== 上传 ====================

/**
 * 上传本地设置到云端
 */
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
    // 移除不需要同步的敏感/设备相关字段
    const settingsToUpload: AppSettings = {
      ...settings,
      // downloadPath 是设备相关的本地路径，不同设备无意义，但保留其他下载设置
      download: {
        ...settings.download,
        downloadPath: '',
      },
    };

    await signedRequest('settings_sync_upload', {
      user_id: ciyuanxiId,
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

/**
 * 从云端下载设置
 * 返回下载的设置数据，调用方负责合并到本地
 */
export async function downloadSettings(): Promise<{ settings: AppSettings | null; result: SettingsSyncResult }> {
  const result: SettingsSyncResult = {
    uploaded: false,
    downloaded: false,
    errors: [],
  };

  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId) {
    logSyncError('downloadSettings: 未获取到弦予号');
    result.errors.push('未登录或未获取到弦予号');
    return { settings: null, result };
  }

  logSync('downloadSettings: 开始从云端下载设置');

  try {
    const downloadData = await signedRequest<SettingsSyncDownloadData>('settings_sync_download', {
      user_id: ciyuanxiId,
    });

    if (!downloadData || !downloadData.settings) {
      logSync('downloadSettings: 云端无设置数据');
      return { settings: null, result };
    }

    result.downloaded = true;
    logSync(`downloadSettings: 下载成功, uploaded_at=${downloadData.uploaded_at}`);
    return { settings: downloadData.settings, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logSyncError(`downloadSettings: 下载失败: ${msg}`);
    result.errors.push(`下载失败: ${msg}`);
    return { settings: null, result };
  }
}
