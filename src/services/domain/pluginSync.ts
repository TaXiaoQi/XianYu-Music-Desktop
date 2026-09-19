
import type { PluginSource } from '../../types';
import { signedRequest } from '../auth/authService';
import { getCiyuanxiId } from './playlistSync';
import {
  getStoredPlugins,
  getPluginScript,
  restorePluginFromSync,
  loadPlugins,
  getSubscriptions,
  mergeSubscriptionsFromCloud,
  getPluginUserVariableValues,
  setPluginUserVariableValues,
} from './pluginEngine';
import {
  setSyncedPluginIds,
  addSyncedPluginIds,
  removeSyncedPluginIds,
  getDownloadSkipIds,
  removeDownloadSkipIds,
  getUploadSkipIds,
} from './pluginSyncState';

const LOG = '[PluginSync]';

function logSync(_msg: string, ..._args: unknown[]) {
}

function logSyncError(msg: string, ...args: unknown[]) {
  console.error(`${LOG} ${msg}`, ...args);
}

function encodeBase64(str: string): string {
  try {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).split('').reverse().join('');
  } catch {
    return btoa(unescape(encodeURIComponent(str))).split('').reverse().join('');
  }
}

function decodeBase64(b64: string): string {
  try {
    const reversed = b64.split('').reverse().join('');
    const binary = atob(reversed);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return decodeURIComponent(escape(atob(b64.split('').reverse().join(''))));
  }
}

// ==================== 用户变量 AES 加密 ====================

export interface EncryptedUserVars {
  iv: string;
  data: string;
}

function b64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function bytesFromB64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function userVarKeyFor(ciyuanxiId: string): Promise<CryptoKey> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(ciyuanxiId),
  );
  return globalThis.crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-CBC' },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptUserVars(
  ciyuanxiId: string,
  values: Record<string, string>,
): Promise<EncryptedUserVars> {
  const key = await userVarKeyFor(ciyuanxiId);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const ct = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: 'AES-CBC', iv },
      key,
      new TextEncoder().encode(JSON.stringify(values)),
    ),
  );
  return { iv: b64FromBytes(iv), data: b64FromBytes(ct) };
}

async function decryptUserVars(
  ciyuanxiId: string,
  enc: EncryptedUserVars,
): Promise<Record<string, string> | undefined> {
  try {
    const key = await userVarKeyFor(ciyuanxiId);
    const pt = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: bytesFromB64(enc.iv) },
      key,
      bytesFromB64(enc.data),
    );
    const parsed = JSON.parse(new TextDecoder().decode(pt));
    return typeof parsed === 'object' && parsed ? parsed as Record<string, string> : undefined;
  } catch {
    return undefined;
  }
}

// ==================== 类型定义 ====================

export interface PluginSyncItem extends PluginSource {
  script: string;
  scriptEncoded?: boolean;
  userVariablesEncrypted?: EncryptedUserVars;
}

export interface PluginSyncDownloadData {
  version: number;
  uploaded_at: string;
  timestamp: number;
  stats: {
    plugin_count: number;
    subscription_count?: number;
  };
  plugins: PluginSyncItem[];
  subscriptions?: CloudSubscriptionItem[];
}

export interface CloudSubscriptionItem {
  id?: string;
  name?: string;
  url: string;
  addedAt?: number;
  [key: string]: unknown;
}

export interface PluginSyncResult {
  uploadedPlugins: number;
  downloadedPlugins: number;
  syncedSubscriptions: number;
  errors: string[];
}

// ==================== 上传 ====================

export async function uploadPlugins(): Promise<PluginSyncResult> {
  const result: PluginSyncResult = {
    uploadedPlugins: 0,
    downloadedPlugins: 0,
    syncedSubscriptions: 0,
    errors: [],
  };

  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId) {
    logSyncError('uploadPlugins: 未获取到弦予号');
    result.errors.push('未登录或未获取到弦予号');
    return result;
  }

  await loadPlugins();

  const plugins = getStoredPlugins();
  const userPlugins = plugins.filter(p => !p.isBuiltin);
  const uploadSkip = getUploadSkipIds();
  const toUpload = userPlugins.filter(p => !uploadSkip.has(p.id));
  for (const skipped of userPlugins) {
    if (uploadSkip.has(skipped.id)) {
      logSync(`uploadPlugins: 跳过 "${skipped.name}" - 处于仅保留本地墓碑中`);
    }
  }
  const subscriptions = getSubscriptions();

  logSync(`uploadPlugins: 本地用户插件 ${userPlugins.length} 个, 订阅 ${subscriptions.length} 个`);

  if (toUpload.length === 0) {
    if (subscriptions.length > 0) {
      try {
        await signedRequest<{ plugin_count: number }>('plugin_sync_upload_one', {
          user_id: ciyuanxiId,
          plugin: {},
          is_first: true,
          subscriptions,
        }, {
          fetchTimeoutMs: 55_000,
          timeoutMs: 60_000,
        });
        logSync('uploadPlugins: 已单独上传订阅链接');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logSyncError('uploadPlugins: 订阅上传失败:', msg);
        result.errors.push(`订阅链接上传失败: ${msg}`);
      }
    } else {
      logSync('uploadPlugins: 无用户插件需要上传');
    }
    setSyncedPluginIds([]);
    return result;
  }

  const uploadedIds: string[] = [];
  for (let i = 0; i < toUpload.length; i++) {
    const plugin = toUpload[i];
    logSync(`uploadPlugins: [${i + 1}/${toUpload.length}] 上传插件 "${plugin.name}"`);

    try {
      const script = await getPluginScript(plugin.id);
      if (!script) {
        logSync(`uploadPlugins: 跳过 "${plugin.name}" - 无法获取脚本`);
        result.errors.push(`插件 "${plugin.name}" 脚本读取失败，已跳过`);
        continue;
      }

      const syncItem: PluginSyncItem = {
        ...plugin,
        script: encodeBase64(script),
        scriptEncoded: true,
      };

      const userVars = getPluginUserVariableValues(plugin.id);
      if (Object.keys(userVars).length > 0) {
        try {
          syncItem.userVariablesEncrypted = await encryptUserVars(ciyuanxiId, userVars);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logSyncError(`uploadPlugins: 插件 "${plugin.name}" 用户变量加密失败:`, msg);
          result.errors.push(`插件 "${plugin.name}" 用户变量加密失败，变量未同步`);
        }
      }

      const data = await signedRequest<{ plugin_count: number }>('plugin_sync_upload_one', {
        user_id: ciyuanxiId,
        plugin: syncItem,
        is_first: i === 0,
        subscriptions,
      }, {
        fetchTimeoutMs: 55_000,
        timeoutMs: 60_000,
      });

      result.uploadedPlugins++;
      uploadedIds.push(plugin.id);
      logSync(`uploadPlugins: [${i + 1}/${toUpload.length}] "${plugin.name}" 上传成功 (云端共 ${data.plugin_count ?? '?'} 个)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logSyncError(`uploadPlugins: 上传插件 "${plugin.name}" 失败:`, msg);
      result.errors.push(`插件 "${plugin.name}" 上传失败: ${msg}`);
    }
  }

  setSyncedPluginIds(uploadedIds);
  logSync(`uploadPlugins ← 完成: 成功 ${result.uploadedPlugins}/${toUpload.length} 个, ${result.errors.length} 个错误`);
  return result;
}

// ==================== 下载 ====================

export async function downloadPlugins(): Promise<PluginSyncResult> {
  const result: PluginSyncResult = {
    uploadedPlugins: 0,
    downloadedPlugins: 0,
    syncedSubscriptions: 0,
    errors: [],
  };

  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId) {
    logSyncError('downloadPlugins: 未获取到弦予号');
    result.errors.push('未登录或未获取到弦予号');
    return result;
  }

  logSync('downloadPlugins: 开始从云端下载插件');

  try {
    const downloadData = await signedRequest<PluginSyncDownloadData>('plugin_sync_download', {
      user_id: ciyuanxiId,
    });

    const cloudSubs = downloadData?.subscriptions;
    if (Array.isArray(cloudSubs) && cloudSubs.length > 0) {
      const added = mergeSubscriptionsFromCloud(cloudSubs);
      result.syncedSubscriptions = added;
      logSync(`downloadPlugins: 订阅链接合并完成, 新增 ${added} 个`);
    }

    if (!downloadData || !downloadData.plugins || downloadData.plugins.length === 0) {
      logSync('downloadPlugins: 云端无插件数据');
      return result;
    }

    logSync(`downloadPlugins: 云端共 ${downloadData.plugins.length} 个插件`);

    await loadPlugins();

    const downloadSkip = getDownloadSkipIds();
    const restoredIds: string[] = [];
    for (let i = 0; i < downloadData.plugins.length; i++) {
      const item = downloadData.plugins[i];
      if (downloadSkip.has(item.id)) {
        logSync(`downloadPlugins: [${i + 1}/${downloadData.plugins.length}] 跳过 "${item.name}" - 处于仅删本地墓碑中`);
        continue;
      }
      logSync(`downloadPlugins: [${i + 1}/${downloadData.plugins.length}] 恢复插件 "${item.name}" (${item.format})`);

      try {
        const script = item.scriptEncoded ? decodeBase64(item.script) : item.script;
        const ok = await restorePluginFromSync(item, script);
        if (ok) {
          if (item.userVariablesEncrypted) {
            const values = await decryptUserVars(ciyuanxiId, item.userVariablesEncrypted);
            if (values && Object.keys(values).length > 0) {
              setPluginUserVariableValues(item.id, values);
            } else {
              result.errors.push(`插件 "${item.name}" 用户变量解密失败`);
            }
          }
          result.downloadedPlugins++;
          restoredIds.push(item.id);
        } else {
          result.errors.push(`插件 "${item.name}" 恢复失败`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logSyncError(`downloadPlugins: 恢复插件 "${item.name}" 失败:`, msg);
        result.errors.push(`插件 "${item.name}" 恢复失败: ${msg}`);
      }
    }

    addSyncedPluginIds(restoredIds);
    logSync(`downloadPlugins ← 完成: 恢复 ${result.downloadedPlugins} 个插件, ${result.errors.length} 个错误`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logSyncError(`downloadPlugins: 下载失败:`, e);
    result.errors.push(`下载失败: ${msg}`);
  }

  return result;
}

// ==================== 云端删除 ====================

export async function deleteCloudPlugins(pluginIds: string[]): Promise<boolean> {
  if (pluginIds.length === 0) return true;
  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId) {
    logSyncError('deleteCloudPlugins: 未获取到弦予号');
    return false;
  }
  try {
    await signedRequest<{ deleted: number; plugin_count: number }>('plugin_sync_delete', {
      user_id: ciyuanxiId,
      plugin_ids: pluginIds,
    }, {
      fetchTimeoutMs: 55_000,
      timeoutMs: 60_000,
    });
    logSync(`deleteCloudPlugins: 云端删除 ${pluginIds.length} 个插件成功`);
    removeSyncedPluginIds(pluginIds);
    removeDownloadSkipIds(pluginIds);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logSyncError(`deleteCloudPlugins: 云端删除失败:`, msg);
    return false;
  }
}
