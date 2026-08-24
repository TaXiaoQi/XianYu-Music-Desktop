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
  /** 已保存的订阅清单（供订阅型插件的版本比对）。 */
  getSubscriptions: () => Array<{ id: string; url: string; name?: string }>;
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
 *
 * 兼容语义化版本（"1.0.5"、"2.0.0-beta.1"），也兼容落雪/时迁酱等插件常用的
 * 字母前缀/后缀版本（"v7"、"v10"、"1.2.0-fix7"）。解析时：
 *   - 去掉首字母 "v"/"V" 前缀；
 *   - 在数字与字母交界处插入分隔符（"fix7" → "fix.7"）；
 *   - 按 . - _ + 拆分，纯数字段按数值比较，字符串段按字典序比较；
 *   - 数字段 > 字符串段（"1.1.0" 大于 "1.1.0-beta"），缺失尾部按数值 0 处理。
 *
 * 旧实现把每个非数字段一律 parseInt 成 0，导致 "v7" → "v8"、"v9" → "v10" 这类
 * 版本方案比较时两边全等于 0，永远判定为"已是最新版本"，插件无法更新。
 */
function parseVersionParts(v: string): Array<number | string> {
  const s = String(v)
    .trim()
    .replace(/^[vV]\s*/, '')
    .replace(/(\d)([a-zA-Z])/g, '$1.$2')
    .replace(/([a-zA-Z])(\d)/g, '$1.$2');
  const parts = s.split(/[.\-_+]+/).filter(p => p.length > 0);
  return parts.map(p => (/^\d+$/.test(p) ? parseInt(p, 10) : p.toLowerCase()));
}

function compareVersionToken(a: number | string, b: number | string): number {
  const aNum = typeof a === 'number';
  const bNum = typeof b === 'number';
  if (aNum && bNum) return a - b;
  if (aNum) return 1; // 数字段 > 字符串段
  if (bNum) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareVersions(a: string, b: string): number {
  const va = parseVersionParts(a);
  const vb = parseVersionParts(b);
  const maxLen = Math.max(va.length, vb.length);
  for (let i = 0; i < maxLen; i++) {
    const ta = i < va.length ? va[i] : 0;
    const tb = i < vb.length ? vb[i] : 0;
    const diff = compareVersionToken(ta, tb);
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
  getSubscriptions,
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
   * 解析订阅清单，提取其中的插件条目（按 url 定位）。
   * 兼容 `{ plugins: [...] }` 或顶层数组两种结构。
   */
  const parseSubscriptionItems = (content: string): Array<{ url: string; version?: string; name?: string }> => {
    try {
      const json = JSON.parse(content);
      const list = Array.isArray(json) ? json : (json.plugins || json.plugin || json.sources || []);
      if (!Array.isArray(list)) return [];
      return list
        .filter((it: any) => it && typeof it.url === 'string' && it.url.trim())
        .map((it: any) => ({
          url: it.url.trim(),
          version: typeof it.version === 'string' ? it.version.trim() : undefined,
          name: typeof it.name === 'string' ? it.name : undefined,
        }));
    } catch {
      return [];
    }
  };

  // 订阅内容按 URL 缓存，避免批量检查时对同一订阅重复请求。
  // inFlight 保证缓存未命中时并发的多个插件只触发一次订阅下载，其余等待其复用，
  // 避免一个慢订阅被 N 个插件各自重复拉取（这正是批量更新检测变慢的放大根因）。
  const subscriptionContentCache = new Map<string, { at: number; items: Array<{ url: string; version?: string; name?: string }> }>();
  const subscriptionFetchInFlight = new Map<string, Promise<{ at: number; items: Array<{ url: string; version?: string; name?: string }> }>>();
  // TTL 提高到 5 分钟：订阅清单更新不频繁，缩短等待网络往返的次数。
  const SUB_CACHE_TTL_MS = 5 * 60_000;

  const getSubscriptionItems = async (subUrl: string) => {
    const cached = subscriptionContentCache.get(subUrl);
    if (cached && Date.now() - cached.at <= SUB_CACHE_TTL_MS) return cached;

    let inFlight = subscriptionFetchInFlight.get(subUrl);
    if (!inFlight) {
      inFlight = (async () => {
        const content = await fetchPluginScript(subUrl);
        return { at: Date.now(), items: content ? parseSubscriptionItems(content) : [] };
      })();
      subscriptionFetchInFlight.set(subUrl, inFlight);
    }
    try {
      const entry = await inFlight;
      subscriptionContentCache.set(subUrl, entry);
      return entry;
    } finally {
      subscriptionFetchInFlight.delete(subUrl);
    }
  };

  /**
   * 判断插件 target 是否命中订阅清单条目。
   * 订阅安装时插件的 filePath = 清单里的 url，但同一插件在不同来源里可能带不同的
   * query 参数（缓存指纹、渠道标记等），因此除了精确匹配外，也按"去 query 后的路径"
   * 与"插件名"做宽松匹配。参考 BakaMusic：清单条目可相对清单 URL 解析。
   */
  const stripUrlQuery = (u: string) => {
    try { return new URL(u).origin + new URL(u).pathname; } catch { return u; }
  };
  const matchSubscriptionItem = (
    item: { url: string; name?: string },
    filePath: string,
    pluginName: string,
  ): boolean => {
    if (item.url === filePath) return true;
    if (stripUrlQuery(item.url) !== '' && stripUrlQuery(item.url) === stripUrlQuery(filePath)) return true;
    if (pluginName && item.name && item.name.trim() === pluginName.trim()) return true;
    return false;
  };

  /**
   * 在已保存的订阅清单中按 filePath/name 匹配插件（订阅安装时 filePath = 清单里的 url）。
   * 命中即返回订阅声明的 version —— 这才是订阅型插件（Baka 等）真正的更新依据。
   * 无论 musicfree 还是 lx 格式都走这里，规避自引用 srcUrl 导致的"永远最新"。
   */
  const findSubscriptionPlugin = async (filePath: string, pluginName: string) => {
    if (!filePath || !filePath.startsWith('http')) return null;
    for (const sub of getSubscriptions()) {
      if (!sub?.url) continue;
      const entry = await getSubscriptionItems(sub.url);
      const hit = entry.items.find(it => matchSubscriptionItem(it, filePath, pluginName));
      if (hit) return { ...hit, subscriptionUrl: sub.url };
    }
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

    // [修复] 订阅型插件（Baka 等，含 LX 格式）先走订阅清单：无论插件是 musicfree 还是 lx，
    // 只要它来自订阅，订阅清单里声明的 version 才是真正的更新依据。
    // 旧逻辑把订阅判断放在 musicfree 分支内，导致来自订阅的 LX 插件绕过该判断，转而重取
    // 自身脚本（@homepage 自引用）→ 哈希一致 → 永远判"已是最新版本"，且重复下载 + 沙箱执行
    // 同一脚本导致检测很慢。参考 BakaMusic：订阅清单即为权威源，版本比对优先、无更新时不拉脚本。
    const subPlugin = await findSubscriptionPlugin(source.filePath, source.name);
    if (subPlugin && subPlugin.version) {
      const hasUpdate = compareVersions(subPlugin.version, source.version) > 0;
      log(`[checkPluginUpdate] ${source.name} 订阅源(${subPlugin.subscriptionUrl}) 当前=${source.version} 远程=${subPlugin.version} 有更新=${hasUpdate}`);
      if (!hasUpdate) {
        return {
          hasUpdate: false,
          currentVersion: source.version,
          newVersion: subPlugin.version,
          newScript: null,
          updateUrl: subPlugin.url,
        };
      }
      // 订阅声明了新版本 → 才去下载新脚本，避免无更新时白白拉取大脚本
      const newScript = await fetchPluginScript(subPlugin.url);
      if (newScript) {
        return {
          hasUpdate: true,
          currentVersion: source.version,
          newVersion: subPlugin.version,
          newScript,
          updateUrl: subPlugin.url,
        };
      }
      log(`[checkPluginUpdate] ${source.name} 订阅声明新版本但下载新脚本失败`);
    }

    // 未命中订阅（手动/URL/本地安装的插件）→ 回退到格式特定的 srcUrl/filePath 逻辑。
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
      // [修复] 与 BakaMusic 一致：优先重取插件脚本自身的 URL（filePath）作为更新源，
      // 而不是 @homepage —— @homepage 常指向 GitHub 仓库/项目页（HTML），抓取它解析不到
      // 版本号，导致 LX 插件"检查无结果"。远程安装的 lx 插件脚本就托管在 filePath 上，
      // 重取它并与已安装版本比对，即 lx 插件惯例的更新方式。本地导入的插件没有远程脚本，
      // 再回退到解析脚本里的 @homepage。
      if (source.filePath.startsWith('http')) {
        updateUrl = source.filePath;
      } else {
        let script = '';
        try {
          if (source.filePath) script = await pluginApi.readPluginFile(source.filePath);
        } catch { /* ignore */ }
        if (script) {
          const info = parseLxScriptInfo(script);
          if (info.homepage) updateUrl = info.homepage;
        }
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

    // [修复] 脚本内容哈希对比：source.id 就是安装时脚本 SHA256 哈希（musicfree 与 lx 均为哈希）。
    // 如果新脚本哈希与 source.id 完全一致，说明脚本内容未变化，直接判定无更新。
    // 这可以避免因版本号正则提取误差导致的"永远有更新"问题，也避免"脚本已变但版本号未变"漏更新。
    if (source.id && /^[a-f0-9]{16,}$/i.test(source.id)) {
      const newHash = await hostSha256Hex(newScript);
      const idLower = source.id.toLowerCase();
      if (newHash === idLower) {
        log(`[checkPluginUpdate] ${source.name} 脚本哈希一致 (hash=${newHash.substring(0, 16)}...)，无更新`);
        return {
          hasUpdate: false,
          currentVersion: source.version,
          newVersion: source.version,
          newScript: null,
          updateUrl,
        };
      }
      log(`[checkPluginUpdate] ${source.name} 脚本哈希不同: 当前=${idLower.substring(0, 16)}... 远程=${newHash.substring(0, 16)}...，继续版本比较`);
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
