import type { PluginSource } from '../types';
import type { pluginApi } from './tauri/pluginApi';
import { hostSha256Hex } from './tauri/hostCryptoApi';
import { fetchWithTimeout } from './pluginFetch';

export interface PluginUpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  newVersion: string;
  newScript: string | null;
  updateUrl: string;
}

export interface PluginUpdateServiceDeps {
  ensurePluginInstance: (source: PluginSource) => Promise<{ instance: any } | null>;
  loadPluginFromScript: (script: string, filePath: string) => Promise<PluginSource | null>;
  getStoredPlugins: () => PluginSource[];
  addPluginSource: (source: PluginSource) => void;
  removePluginSource: (id: string) => void;
  updatePluginSource: (id: string, updates: Partial<PluginSource>) => void;
  getPluginUserVariableValues: (pluginId: string) => Record<string, string>;
  setPluginUserVariableValues: (pluginId: string, values: Record<string, string>) => void;
  parseLxScriptInfo: (script: string) => { version: string; homepage?: string };
  initLxPlugin: (source: PluginSource) => Promise<boolean>;
  destroyLxPlugin: (id: string) => void;
  pluginApi: Pick<typeof pluginApi, 'fetchPluginUrl' | 'readPluginFile'>;
  log: (msg: string) => void;
}

/**
 * 版本号比较：返回 >0 表示 a 更新，<0 表示 b 更新，0 表示相同。
 * 支持语义化版本如 "1.0.5", "1.0.5-fix7", "2.0.0-beta.1"。
 */
export function compareVersions(a: string, b: string): number {
  const parseVer = (v: string) => {
    const parts = v.split(/[-.]/);
    return parts.map(p => {
      const n = parseInt(p);
      return isNaN(n) ? 0 : n;
    });
  };
  const va = parseVer(a);
  const vb = parseVer(b);
  const maxLen = Math.max(va.length, vb.length);
  for (let i = 0; i < maxLen; i++) {
    const diff = (va[i] || 0) - (vb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * 从 MusicFree/Baka 脚本中提取版本号（不执行脚本）。
 *
 * [修复] 旧正则 /version\s*[=:]\s*['"]([^'"]+)['"]/ 会匹配脚本中任意出现的
 * "version = '...'" 字符串，包括注释、变量声明、API URL 参数等，导致提取到
 * 错误的版本号。Baka 插件尤其容易在 return 对象之前出现其他 version 字符串。
 *
 * 新策略：
 * 1. 优先匹配对象属性形式的 version（前面是 { 或 ,），取最后一个匹配
 *    （return 对象通常在脚本末尾）
 * 2. 回退到旧正则（向后兼容）
 */
function extractMusicFreeVersion(script: string): string | null {
  // 策略 1：匹配对象属性 { version: '1.0.0' } 或 , version: '1.0.0'
  // 使用 matchAll 找所有匹配，取最后一个（最可能是 return 对象的 version）
  const propMatches = [...script.matchAll(/[{,]\s*version\s*:\s*['"]([^'"]+)['"]/g)];
  if (propMatches.length > 0) {
    return propMatches[propMatches.length - 1][1];
  }

  // 策略 2（回退）：旧正则，匹配任意 version = '...' 或 version: '...'
  const match = script.match(/version\s*[=:]\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

/**
 * 从 MusicFree/Baka 脚本中提取 srcUrl（不执行脚本）。
 *
 * [修复] 同 extractMusicFreeVersion，使用对象属性匹配避免误匹配。
 */
function extractMusicFreeSrcUrl(script: string): string | null {
  // 策略 1：匹配对象属性 { srcUrl: '...' } 或 , srcUrl: '...'
  const propMatches = [...script.matchAll(/[{,]\s*srcUrl\s*:\s*['"]([^'"]+)['"]/g)];
  if (propMatches.length > 0) {
    return propMatches[propMatches.length - 1][1];
  }

  // 策略 2（回退）：旧正则
  const match = script.match(/srcUrl\s*[=:]\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

export const createPluginUpdateService = ({
  ensurePluginInstance,
  loadPluginFromScript,
  getStoredPlugins,
  addPluginSource,
  removePluginSource,
  updatePluginSource,
  getPluginUserVariableValues,
  setPluginUserVariableValues,
  parseLxScriptInfo,
  initLxPlugin,
  destroyLxPlugin,
  pluginApi,
  log,
}: PluginUpdateServiceDeps) => {
  /** 从远程 URL 获取插件脚本。 */
  const fetchPluginScript = async (url: string): Promise<string | null> => {
    try {
      const resp = await fetchWithTimeout(url, 10000);
      if (resp.ok) return await resp.text();
    } catch { /* ignore */ }
    try {
      return await pluginApi.fetchPluginUrl(url);
    } catch { /* ignore */ }
    return null;
  };

  /**
   * 检查插件是否有可用更新。
   * - MusicFree 插件：优先使用实例的 srcUrl，回退到 filePath（如果是 http URL）。
   * - LX 插件：使用 parseLxScriptInfo 提取的 @homepage，回退到 filePath。
   *
   * [修复] 新增脚本内容哈希对比：source.id 本身就是脚本 SHA256 哈希，
   * 如果新脚本哈希与 source.id 相同，直接判定为无更新，避免版本提取误差导致的重复更新。
   */
  const checkPluginUpdate = async (source: PluginSource): Promise<PluginUpdateCheckResult | null> => {
    let updateUrl: string | undefined;

    if (source.format === 'musicfree') {
      const inst = await ensurePluginInstance(source);
      const instanceSrcUrl = (inst?.instance as any)?.srcUrl as string | undefined;

      if (instanceSrcUrl) {
        updateUrl = instanceSrcUrl;
      } else if (source.filePath.startsWith('http')) {
        updateUrl = source.filePath;
      }

      if (!updateUrl) {
        let script = '';
        try {
          if (source.filePath.startsWith('http')) {
            script = await fetchPluginScript(source.filePath) || '';
          } else if (source.filePath) {
            script = await pluginApi.readPluginFile(source.filePath);
          }
        } catch { /* ignore */ }
        if (script) {
          updateUrl = extractMusicFreeSrcUrl(script) || undefined;
        }
      }
    } else if (source.format === 'lx') {
      let script = '';
      try {
        if (source.filePath.startsWith('http')) {
          script = await fetchPluginScript(source.filePath) || '';
        } else if (source.filePath) {
          script = await pluginApi.readPluginFile(source.filePath);
        }
      } catch { /* ignore */ }

      if (script) {
        const info = parseLxScriptInfo(script);
        if (info.homepage) {
          updateUrl = info.homepage;
        }
      }

      if (!updateUrl && source.filePath.startsWith('http')) {
        updateUrl = source.filePath;
      }
    }

    if (!updateUrl) {
      log(`[checkPluginUpdate] ${source.name} 无可用更新源`);
      return null;
    }

    log(`[checkPluginUpdate] ${source.name} 检查更新: ${updateUrl}`);
    const newScript = await fetchPluginScript(updateUrl);
    if (!newScript) {
      log(`[checkPluginUpdate] ${source.name} 获取脚本失败`);
      return null;
    }

    // [修复] 脚本内容哈希对比：source.id 就是安装时脚本 SHA256 哈希。
    // 如果新脚本哈希与 source.id 完全一致，说明脚本内容未变化，直接判定无更新。
    // 这可以避免因版本号正则提取误差导致的"永远有更新"问题。
    if (source.format === 'musicfree' && source.id) {
      const newHash = await hostSha256Hex(newScript);
      if (newHash === source.id) {
        log(`[checkPluginUpdate] ${source.name} 脚本哈希一致 (hash=${newHash.substring(0, 16)}...)，无更新`);
        return {
          hasUpdate: false,
          currentVersion: source.version,
          newVersion: source.version,
          newScript: null,
          updateUrl,
        };
      }
      log(`[checkPluginUpdate] ${source.name} 脚本哈希不同: 当前=${source.id.substring(0, 16)}... 远程=${newHash.substring(0, 16)}...，继续版本比较`);
    }

    let newVersion = '';
    if (source.format === 'musicfree') {
      newVersion = extractMusicFreeVersion(newScript) || '';
    } else if (source.format === 'lx') {
      const info = parseLxScriptInfo(newScript);
      newVersion = info.version;
    }

    if (!newVersion) {
      log(`[checkPluginUpdate] ${source.name} 无法从新脚本提取版本号`);
      return null;
    }

    const hasUpdate = compareVersions(newVersion, source.version) > 0;
    log(`[checkPluginUpdate] ${source.name}: 当前=${source.version}, 远程=${newVersion}, 有更新=${hasUpdate}`);

    return {
      hasUpdate,
      currentVersion: source.version,
      newVersion,
      newScript: hasUpdate ? newScript : null,
      updateUrl,
    };
  };

  /** 执行插件更新：重新加载新脚本并替换旧插件。 */
  const performPluginUpdate = async (
    source: PluginSource,
    checkResult: PluginUpdateCheckResult,
  ): Promise<{ success: boolean; newSource: PluginSource | null; message: string }> => {
    if (!checkResult.newScript) {
      return { success: false, newSource: null, message: '无新脚本可更新' };
    }

    try {
      const newSource = await loadPluginFromScript(checkResult.newScript, checkResult.updateUrl);
      if (!newSource) {
        return { success: false, newSource: null, message: '新脚本加载失败' };
      }

      newSource.enabled = source.enabled;
      newSource.sortOrder = source.sortOrder;

      // 插件 ID 使用脚本 SHA-256。Baka/MusicFree 插件更新后脚本内容变化会导致 ID 变化，
      // 而用户变量值按插件 ID 存储。删除旧插件前先取出旧值，安装新插件后迁移到新 ID，
      // 避免 QQ音乐[L2] 等插件的 SOURCE_API_KEY 在更新后丢失。
      const oldUserVars = getPluginUserVariableValues(source.id);

      if (newSource.id !== source.id) {
        removePluginSource(source.id);
      }

      addPluginSource(newSource);

      if (newSource.id !== source.id && Object.keys(oldUserVars).length > 0) {
        setPluginUserVariableValues(newSource.id, oldUserVars);
        log(`[performPluginUpdate] 已迁移用户变量: ${source.id.substring(0, 16)}... → ${newSource.id.substring(0, 16)}... keys=[${Object.keys(oldUserVars).join(',')}]`);
      }

      if (newSource.format === 'lx' && newSource.enabled) {
        destroyLxPlugin(source.id);
        await initLxPlugin(newSource);
      }

      log(`[performPluginUpdate] ${source.name} 更新成功: ${source.version} → ${newSource.version}`);
      return { success: true, newSource, message: `${source.name} 已更新到 ${newSource.version}` };
    } catch (e: any) {
      log(`[performPluginUpdate] ${source.name} 更新失败: ${e?.message || e}`);
      return { success: false, newSource: null, message: `更新失败: ${e?.message || e}` };
    }
  };

  /** 批量检查所有插件的更新。 */
  const checkAllPluginUpdates = async (): Promise<Map<string, PluginUpdateCheckResult>> => {
    const plugins = getStoredPlugins();
    const results = new Map<string, PluginUpdateCheckResult>();

    await Promise.allSettled(plugins.map(async (source) => {
      try {
        const result = await checkPluginUpdate(source);
        if (result) {
          results.set(source.id, result);
          updatePluginSource(source.id, { updateAvailable: result.hasUpdate });
        }
      } catch (e: any) {
        log(`[checkAllPluginUpdates] ${source.name} 检查失败: ${e?.message || e}`);
      }
    }));

    return results;
  };

  return {
    checkPluginUpdate,
    performPluginUpdate,
    checkAllPluginUpdates,
  };
};
