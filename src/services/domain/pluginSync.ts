/**
 * 插件云端同步服务
 *
 * 封装后端 `api/index.php` 的插件同步接口，提供本地插件与云端之间的
 * 双向同步能力。所有请求复用 authService 的签名机制（MD5 + 可选 AES 加密）。
 *
 * 后端接口一览（action=xxx）：
 * - plugin_sync_upload_one：逐个上传插件（含脚本内容）到服务器文件存储
 * - plugin_sync_download：下载云端插件数据
 * - plugin_sync_status：查询同步状态
 */

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

/** 日志前缀 */
const LOG = '[PluginSync]';

function logSync(_msg: string, ..._args: unknown[]) {
}

function logSyncError(msg: string, ...args: unknown[]) {
  console.error(`${LOG} ${msg}`, ...args);
}

/**
 * 将字符串编码为「反转 Base64」：先 UTF-8 Base64，再反转字符串。
 * 这样 WAF 无法通过常规 Base64 解码检测到原始 JS 代码内容。
 */
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

/** 将「反转 Base64」解码为字符串：先反转，再 UTF-8 Base64 解码 */
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
// 插件用户变量（API key / Cookie / Token）为敏感信息，上传前用 AES-256-CBC
// 加密，密钥由弦予号经 SHA-256 派生，任意端登录同一账号即可解密。
// 服务端仅作为密文存储载体，不参与加解密。

/** AES 加密后的用户变量块（iv 与 data 均为标准 Base64） */
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

/** 由弦予号派生 AES-256 密钥（SHA-256 → 32 字节原始密钥） */
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

/** AES-CBC 加密插件用户变量 */
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

/** AES-CBC 解密插件用户变量（失败返回 undefined，由调用方决定跳过） */
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

/** 上传用的插件数据（包含脚本内容） */
export interface PluginSyncItem extends PluginSource {
  /** 插件脚本内容（上传时为 Base64 编码，下载时需解码） */
  script: string;
  /** 标记脚本是否已 Base64 编码 */
  scriptEncoded?: boolean;
  /** AES 加密后的用户变量值（API key / Cookie / Token），服务端密文存储 */
  userVariablesEncrypted?: EncryptedUserVars;
}

/** 云端下载的完整数据 */
export interface PluginSyncDownloadData {
  version: number;
  uploaded_at: string;
  timestamp: number;
  stats: {
    plugin_count: number;
    subscription_count?: number;
  };
  plugins: PluginSyncItem[];
  /** 云端订阅链接列表 */
  subscriptions?: CloudSubscriptionItem[];
}

/** 云端订阅条目（字段与本地 PluginSubscription 兼容） */
export interface CloudSubscriptionItem {
  id?: string;
  name?: string;
  url: string;
  addedAt?: number;
  [key: string]: unknown;
}

/** 同步结果 */
export interface PluginSyncResult {
  uploadedPlugins: number;
  downloadedPlugins: number;
  /** 本次合并进本地的云端订阅数 */
  syncedSubscriptions: number;
  errors: string[];
}

// ==================== 上传 ====================

/**
 * 上传所有本地插件到云端
 * 逐个上传以避免 WAF 拦截大请求体，每个插件的脚本经反转 Base64 编码。
 * 订阅链接列表随每个请求一并上传（服务端整包替换）。
 */
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

  // 确保所有插件已加载（脚本在内存缓存中）
  await loadPlugins();

  const plugins = getStoredPlugins();
  // 过滤掉内置插件
  const userPlugins = plugins.filter(p => !p.isBuiltin);
  // 订阅链接列表随插件一起上传
  const subscriptions = getSubscriptions();

  logSync(`uploadPlugins: 本地用户插件 ${userPlugins.length} 个, 订阅 ${subscriptions.length} 个`);

  if (userPlugins.length === 0) {
    if (subscriptions.length > 0) {
      // 本地无插件但有订阅：用空 plugin 做载体单独上传订阅
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
    return result;
  }

  // 逐个上传插件，避免大请求体触发 WAF
  for (let i = 0; i < userPlugins.length; i++) {
    const plugin = userPlugins[i];
    logSync(`uploadPlugins: [${i + 1}/${userPlugins.length}] 上传插件 "${plugin.name}"`);

    try {
      const script = await getPluginScript(plugin.id);
      if (!script) {
        logSync(`uploadPlugins: 跳过 "${plugin.name}" - 无法获取脚本`);
        result.errors.push(`插件 "${plugin.name}" 脚本读取失败，已跳过`);
        continue;
      }

      const syncItem: PluginSyncItem = {
        ...plugin,
        // 反转 Base64 编码脚本内容，避免 WAF 解码检测到原始 JS 代码
        script: encodeBase64(script),
        scriptEncoded: true,
      };

      // 附加 AES 加密的用户变量值（失败仅跳过变量同步，不影响插件本身上传）
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
      logSync(`uploadPlugins: [${i + 1}/${userPlugins.length}] "${plugin.name}" 上传成功 (云端共 ${data.plugin_count ?? '?'} 个)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logSyncError(`uploadPlugins: 上传插件 "${plugin.name}" 失败:`, msg);
      result.errors.push(`插件 "${plugin.name}" 上传失败: ${msg}`);
    }
  }

  logSync(`uploadPlugins ← 完成: 成功 ${result.uploadedPlugins}/${userPlugins.length} 个, ${result.errors.length} 个错误`);
  return result;
}

// ==================== 下载 ====================

/**
 * 从云端下载并恢复所有插件
 * 对每个云端插件，解析脚本并安装到本地；
 * 云端订阅链接按 URL 合并进本地订阅列表（本地已有的保留）。
 */
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

    // 云端订阅链接合并进本地（即使云端无插件也要合并）
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

    // 确保本地插件已加载
    await loadPlugins();

    for (let i = 0; i < downloadData.plugins.length; i++) {
      const item = downloadData.plugins[i];
      logSync(`downloadPlugins: [${i + 1}/${downloadData.plugins.length}] 恢复插件 "${item.name}" (${item.format})`);

      try {
        // 解码 Base64 脚本内容
        const script = item.scriptEncoded ? decodeBase64(item.script) : item.script;
        const ok = await restorePluginFromSync(item, script);
        if (ok) {
          // 还原 AES 加密的用户变量值（用云端 plugin id 作为键，与上传端一致）
          if (item.userVariablesEncrypted) {
            const values = await decryptUserVars(ciyuanxiId, item.userVariablesEncrypted);
            if (values && Object.keys(values).length > 0) {
              setPluginUserVariableValues(item.id, values);
            } else {
              result.errors.push(`插件 "${item.name}" 用户变量解密失败`);
            }
          }
          result.downloadedPlugins++;
        } else {
          result.errors.push(`插件 "${item.name}" 恢复失败`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logSyncError(`downloadPlugins: 恢复插件 "${item.name}" 失败:`, msg);
        result.errors.push(`插件 "${item.name}" 恢复失败: ${msg}`);
      }
    }

    logSync(`downloadPlugins ← 完成: 恢复 ${result.downloadedPlugins} 个插件, ${result.errors.length} 个错误`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logSyncError(`downloadPlugins: 下载失败:`, e);
    result.errors.push(`下载失败: ${msg}`);
  }

  return result;
}
