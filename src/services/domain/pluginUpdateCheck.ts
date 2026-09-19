import type { PluginSource } from '../../types';
import { hostSha256Hex } from '../tauri/hostCryptoApi';
import { fetchWithTimeout } from './pluginFetch';
import {
  compareVersions,
  extractMusicFreeVersion,
  extractMusicFreeSrcUrl,
} from './pluginUpdateVersion';
import type { PluginUpdateCheckResult, PluginUpdateServiceDeps } from './pluginUpdateTypes';

export function createPluginUpdateChecker(deps: PluginUpdateServiceDeps) {
  const {
    getSubscriptions,
    ensurePluginInstance,
    parseLxScriptInfo,
    pluginApi,
    getStoredPlugins,
    updatePluginSource,
    log,
  } = deps;

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

  const subscriptionContentCache = new Map<string, { at: number; items: Array<{ url: string; version?: string; name?: string }> }>();
  const subscriptionFetchInFlight = new Map<string, Promise<{ at: number; items: Array<{ url: string; version?: string; name?: string }> }>>();
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

  const checkPluginUpdate = async (source: PluginSource): Promise<PluginUpdateCheckResult | null> => {
    let updateUrl: string | undefined;

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
    } else if (source.format === 'anime') {
      // anime 插件的分发地址即订阅条目 URL（meta.update 同源），直接以 filePath 作为更新源
      if (source.filePath.startsWith('http')) {
        updateUrl = source.filePath;
      }
    } else if (source.format === 'lx') {
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
    if (source.format === 'musicfree' || source.format === 'anime') {
      // anime 的 meta.version 同样命中 `version: "x.y.z"` 提取规则
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
    checkAllPluginUpdates,
  };
}