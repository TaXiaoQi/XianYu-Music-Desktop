import type { PluginSource, PluginSubscription } from '../types';
import { pluginApi } from './tauri/pluginApi';
import { fetchWithTimeout } from './pluginFetch';

const PLUGIN_SUBSCRIPTIONS_KEY = 'xianyu_plugin_subscriptions';

export interface SubscriptionInstallResult {
  successCount: number;
  failCount: number;
  names: string[];
  errors: string[];
}

export interface PluginSubscriptionServiceDeps {
  loadPluginFromScript: (script: string, filePath: string) => Promise<PluginSource | null>;
  addPluginSource: (source: PluginSource) => void;
  getStoredPlugins: () => PluginSource[];
  compareVersions: (a: string, b: string) => number;
}

export const createPluginSubscriptionService = ({
  loadPluginFromScript,
  addPluginSource,
  getStoredPlugins,
  compareVersions,
}: PluginSubscriptionServiceDeps) => {
  const getSubscriptions = (): PluginSubscription[] => {
    try {
      const raw = localStorage.getItem(PLUGIN_SUBSCRIPTIONS_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };

  const saveSubscriptions = (list: PluginSubscription[]): void => {
    try {
      localStorage.setItem(PLUGIN_SUBSCRIPTIONS_KEY, JSON.stringify(list));
    } catch { /* ignore */ }
  };

  const isValidSubscriptionUrl = (url: string): boolean => (
    /^https?:\/\/.+\.(js|json)(\?.*)?$/i.test(url.trim())
  );

  const genSubscriptionId = (): string => (
    `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );

  const addSubscription = (input: { name: string; url: string }): PluginSubscription | null => {
    const url = input.url.trim();
    if (!isValidSubscriptionUrl(url)) return null;

    const list = getSubscriptions();
    if (list.some(s => s.url === url)) return null;

    let name = input.name.trim();
    if (!name) {
      try {
        const u = new URL(url);
        const lastSeg = u.pathname.split('/').pop() || '';
        name = u.hostname + (lastSeg ? `/${lastSeg}` : '');
      } catch {
        name = url;
      }
    }

    const sub: PluginSubscription = {
      id: genSubscriptionId(),
      name,
      url,
      addedAt: Date.now(),
    };
    list.push(sub);
    saveSubscriptions(list);
    return sub;
  };

  const updateSubscription = (
    id: string,
    updates: Partial<Pick<PluginSubscription, 'name' | 'url' | 'lastSyncAt' | 'lastSyncStatus' | 'lastSyncMessage' | 'lastSyncCount'>>,
  ): void => {
    const list = getSubscriptions();
    const idx = list.findIndex(s => s.id === id);
    if (idx < 0) return;
    if (updates.url !== undefined && !isValidSubscriptionUrl(updates.url)) return;
    list[idx] = { ...list[idx], ...updates };
    saveSubscriptions(list);
  };

  const removeSubscription = (id: string): void => {
    saveSubscriptions(getSubscriptions().filter(s => s.id !== id));
  };

  /** 将云端同步下来的订阅按 URL 合并进本地列表（本地已有的保留原记录），返回新增条数。 */
  const mergeSubscriptionsFromCloud = (
    cloud: Array<{ url?: unknown; name?: unknown; id?: unknown; addedAt?: unknown }>,
  ): number => {
    const list = getSubscriptions();
    const knownUrls = new Set(list.map(s => s.url));
    let added = 0;
    for (const raw of cloud) {
      const url = typeof raw.url === 'string' ? raw.url.trim() : '';
      if (!url || knownUrls.has(url)) continue;
      let name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '';
      if (!name) {
        try {
          const u = new URL(url);
          const lastSeg = u.pathname.split('/').pop() || '';
          name = u.hostname + (lastSeg ? `/${lastSeg}` : '');
        } catch {
          name = url;
        }
      }
      list.push({
        id: typeof raw.id === 'string' && raw.id ? raw.id : genSubscriptionId(),
        name,
        url,
        addedAt: typeof raw.addedAt === 'number' ? raw.addedAt : Date.now(),
      });
      knownUrls.add(url);
      added++;
    }
    if (added > 0) saveSubscriptions(list);
    return added;
  };

  const fetchSubscriptionContent = async (url: string): Promise<string> => {
    let content = '';
    try {
      const resp = await fetchWithTimeout(url, 15000);
      if (resp.ok) content = await resp.text();
    } catch { /* ignore, try Tauri backend */ }
    if (!content) {
      try {
        content = await pluginApi.fetchPluginUrl(url);
      } catch { /* ignore */ }
    }
    return content || '';
  };

  const installSinglePluginScript = async (
    script: string,
    filePath: string,
    skipVersionCheck: boolean,
  ): Promise<{ ok: boolean; name?: string; error?: string }> => {
    const source = await loadPluginFromScript(script, filePath);
    if (!source) {
      return { ok: false, error: '插件加载失败' };
    }

    if (!skipVersionCheck) {
      const existing = getStoredPlugins().find(p => p.name === source.name);
      if (existing && compareVersions(source.version, existing.version) <= 0) {
        return { ok: false, error: `已存在 v${existing.version}，新版本未更高，已跳过` };
      }
    }

    addPluginSource(source);
    return { ok: true, name: source.name };
  };

  const installFromSubscriptionUrl = async (
    url: string,
    options: {
      skipVersionCheck?: boolean;
      /** 插件级进度：done 为已完成数（0 起），total 为有效插件总数 */
      onPluginProgress?: (done: number, total: number, name?: string) => void;
    } = {},
  ): Promise<SubscriptionInstallResult> => {
    const result: SubscriptionInstallResult = { successCount: 0, failCount: 0, names: [], errors: [] };
    const skipVersionCheck = !!options.skipVersionCheck;

    const content = await fetchSubscriptionContent(url);
    if (!content || !content.trim()) {
      result.failCount = 1;
      result.errors.push('获取订阅内容失败，请检查 URL');
      return result;
    }

    const trimmed = content.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const json = JSON.parse(trimmed);
        const pluginList = Array.isArray(json) ? json : (json.plugins || json.plugin || null);
        if (Array.isArray(pluginList) && pluginList.length > 0 && pluginList[0]?.url) {
          const validList = pluginList.filter((item: any) => item?.url);
          const total = validList.length;

          // 逐个串行下载脚本很慢（订阅常含几十个插件）。改为有限并发下载，
          // 既显著提速，又避免一次性并发过多压垮沙箱/源站。
          const CONCURRENCY = 5;
          let done = 0;
          const outcomes: Array<{ ok: boolean; name?: string; error?: string }> = new Array(total);
          for (let startIdx = 0; startIdx < total; startIdx += CONCURRENCY) {
            const batchIdx = validList
              .slice(startIdx, startIdx + CONCURRENCY)
              .map((item: any, inner: number) => ({ item, globalIdx: startIdx + inner }));
            await Promise.all(batchIdx.map(async ({ item, globalIdx }) => {
              try {
                options.onPluginProgress?.(done, total, item.name);
                const script = await fetchSubscriptionContent(item.url);
                if (!script || !script.trim()) {
                  outcomes[globalIdx] = { ok: false, error: `${item.name || item.url}: 获取脚本失败` };
                  return;
                }
                const r = await installSinglePluginScript(script, item.url, skipVersionCheck);
                outcomes[globalIdx] = r.ok
                  ? { ok: true, name: r.name || item.name || '' }
                  : { ok: false, error: `${item.name || item.url}: ${r.error}` };
              } catch (e: any) {
                outcomes[globalIdx] = { ok: false, error: `${item.name || item.url}: ${e?.message || e}` };
              } finally {
                done++;
                options.onPluginProgress?.(done, total);
              }
            }));
          }

          let processed = 0;
          for (const res of outcomes) {
            processed++;
            if (res.ok) {
              result.successCount++;
              result.names.push(res.name || '');
            } else {
              result.failCount++;
              result.errors.push(res.error || '安装失败');
            }
          }
          options.onPluginProgress?.(processed, total);
          return result;
        }
      } catch { /* 不是有效 JSON，当作单插件脚本处理 */ }
    }

    const r = await installSinglePluginScript(content, url, skipVersionCheck);
    if (r.ok) {
      result.successCount = 1;
      result.names.push(r.name || '');
    } else {
      result.failCount = 1;
      result.errors.push(r.error || '插件加载失败');
    }
    return result;
  };

  const installAllSubscriptions = async (
    onProgress?: (index: number, total: number, sub: PluginSubscription, result: SubscriptionInstallResult) => void,
  ): Promise<{ totalSubs: number; totalInstalled: number; failedSubs: number }> => {
    const subs = getSubscriptions();
    const summary = { totalSubs: subs.length, totalInstalled: 0, failedSubs: 0 };

    for (let i = 0; i < subs.length; i++) {
      const sub = subs[i];
      let result: SubscriptionInstallResult;
      try {
        result = await installFromSubscriptionUrl(sub.url);
      } catch (e: any) {
        result = { successCount: 0, failCount: 1, names: [], errors: [e?.message || String(e)] };
      }

      const status: PluginSubscription['lastSyncStatus'] =
        result.failCount === 0 ? 'success' : (result.successCount > 0 ? 'partial' : 'failed');
      updateSubscription(sub.id, {
        lastSyncAt: Date.now(),
        lastSyncStatus: status,
        lastSyncMessage: result.errors[0] || `成功安装 ${result.successCount} 个插件`,
        lastSyncCount: result.successCount,
      });

      summary.totalInstalled += result.successCount;
      if (result.successCount === 0) summary.failedSubs++;

      onProgress?.(i, subs.length, sub, result);
    }

    return summary;
  };

  return {
    getSubscriptions,
    isValidSubscriptionUrl,
    addSubscription,
    updateSubscription,
    removeSubscription,
    mergeSubscriptionsFromCloud,
    installFromSubscriptionUrl,
    installAllSubscriptions,
  };
};
