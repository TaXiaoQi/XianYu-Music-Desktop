import type { PluginSource } from '../../types';
import {
  BUILTIN_PLUGINS,
  _sandboxedPlugins,
  bumpPluginsVersion,
  getPluginUserVariableValues,
  getStoredPlugins,
  log,
  pluginInstances,
  readPluginsFromLocalStorage,
  setStoredPlugins,
  userVarDefsCache,
} from './pluginEngineBase';
import { ensurePluginInstance, loadPluginFromScript } from './pluginEngineInstance';
import { removePluginUserVariableValues, setPluginUserVariableValues } from './pluginEngineUserVars';
import { destroySandbox } from './pluginSandboxManager';
import {
  destroyLxPlugin,
  getLxPluginScript,
  initLxPlugin,
  parseLxScriptInfo,
} from './lxPluginEngine';
import { pluginApi } from '../tauri/pluginApi';
import { fetchWithTimeout } from './pluginFetch';
import { readCachedHttpScript, writeCachedHttpScript, removeCachedHttpScript } from './pluginScriptCache';
import { compareVersions, createPluginUpdateService } from './pluginUpdates';
import { createPluginSubscriptionService } from './pluginSubscriptions';
import { clearPluginSyncTombstones } from './pluginSyncState';

// ==================== 插件存储 CRUD ====================

export function addPluginSource(source: PluginSource) {
  const plugins = readPluginsFromLocalStorage();
  const existing = plugins.findIndex(p => p.id === source.id);
  if (existing >= 0) {
    plugins[existing] = source;
  } else {
    source.sortOrder = plugins.length;
    plugins.push(source);
  }
  setStoredPlugins(plugins);
  clearPluginSyncTombstones([source.id]);
  bumpPluginsVersion();
}

export function reorderPlugins(orderedIds: string[]) {
  const stored = readPluginsFromLocalStorage();
  const idToIndex = new Map(orderedIds.map((id, i) => [id, i]));
  for (const p of stored) {
    const idx = idToIndex.get(p.id);
    if (idx !== undefined) {
      p.sortOrder = idx;
    }
  }
  setStoredPlugins(stored);
  bumpPluginsVersion();
}

export function removePluginSource(id: string) {
  const stored = readPluginsFromLocalStorage().filter(p => p.id !== id);
  setStoredPlugins(stored);
  if (_sandboxedPlugins.has(id)) {
    _sandboxedPlugins.delete(id);
    destroySandbox(id).catch(() => {});
  }
  pluginInstances.delete(id);
  userVarDefsCache.delete(id);
  removePluginUserVariableValues(id);
  destroyLxPlugin(id);
  bumpPluginsVersion();
}

function updatePluginSource(id: string, updates: Partial<PluginSource>) {
  const stored = readPluginsFromLocalStorage();
  const idx = stored.findIndex(p => p.id === id);
  if (idx >= 0) {
    stored[idx] = { ...stored[idx], ...updates };
    setStoredPlugins(stored);
    bumpPluginsVersion();
  }
}

export async function togglePlugin(id: string): Promise<{ success: boolean; enabled: boolean; message?: string }> {
  const plugins = getStoredPlugins();
  const idx = plugins.findIndex(p => p.id === id);
  if (idx < 0) {
    return { success: false, enabled: false, message: '插件不存在' };
  }

  const source = plugins[idx];
  const newEnabled = !source.enabled;
  const updatedSource = { ...source, enabled: newEnabled };

  const stored = readPluginsFromLocalStorage();
  const sIdx = stored.findIndex(p => p.id === id);
  if (sIdx >= 0) {
    stored[sIdx] = updatedSource;
    setStoredPlugins(stored);
    bumpPluginsVersion();
  }

  if (source.format === 'lx') {
    if (newEnabled) {
      log(`[togglePlugin] 启用 LX 插件，开始初始化: ${source.name}`);
      const ok = await initLxPlugin(updatedSource);
      if (!ok) {
        const rollback = readPluginsFromLocalStorage();
        const rIdx = rollback.findIndex(p => p.id === id);
        if (rIdx >= 0) {
          rollback[rIdx] = { ...updatedSource, enabled: false };
          setStoredPlugins(rollback);
          bumpPluginsVersion();
        }
        return { success: false, enabled: false, message: `${source.name} 初始化失败` };
      }
      return { success: true, enabled: true };
    } else {
      log(`[togglePlugin] 禁用 LX 插件，销毁实例: ${source.name}`);
      destroyLxPlugin(id);
      return { success: true, enabled: false };
    }
  }

  return { success: true, enabled: newEnabled };
}

// ==================== 内置插件清理（已取消所有内置插件，此函数仅用于清除旧版本遗留的内置插件条目） ====================

async function loadBuiltinPlugins(): Promise<void> {
  const stored = getStoredPlugins();
  const builtinPaths = new Set(Object.keys(BUILTIN_PLUGINS));
  const stalePlugins = stored.filter(p => p.filePath.startsWith('builtin://') && !builtinPaths.has(p.filePath));
  if (stalePlugins.length > 0) {
    for (const stale of stalePlugins) {
      removePluginSource(stale.id);
      pluginInstances.delete(stale.id);
    }
    log(`已清除 ${stalePlugins.length} 个旧内置插件`);
  }

  const entries = Object.entries(BUILTIN_PLUGINS);
  const results = await Promise.allSettled(entries.map(async ([builtinPath, webPath]) => {
    try {
      const existing = getStoredPlugins().find(p => p.filePath === builtinPath);
      if (existing) {
        if (!pluginInstances.has(existing.id) && existing.format !== 'lx') {
          try {
            const resp = await fetch(webPath);
            if (resp.ok) {
              const script = await resp.text();
              await loadPluginFromScript(script, builtinPath);
              for (const [key, entry] of pluginInstances) {
                if (entry.source.filePath === builtinPath && key !== existing.id) {
                  pluginInstances.set(existing.id, entry);
                  break;
                }
              }
            }
          } catch { /* ignore */ }
        }
        return null;
      }

      const resp = await fetch(webPath);
      if (!resp.ok) {
        log(`内置插件文件不可用: ${webPath}`);
        return null;
      }
      const script = await resp.text();
      const source = await loadPluginFromScript(script, builtinPath);
      if (source) {
        source.filePath = builtinPath;
        source.isBuiltin = true;
        addPluginSource(source);
        log(`内置插件加载成功: ${source.name}`);
      }
      return source;
    } catch (e) {
      log(`内置插件加载失败: ${builtinPath} - ${e}`);
      return null;
    }
  }));

  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0) log(`loadBuiltinPlugins: ${failed} 个插件加载被拒绝`);
}

export async function loadPlugins(lazyLoad: boolean = false): Promise<void> {
  await loadBuiltinPlugins();

  const plugins = getStoredPlugins();

  if (lazyLoad) {
    log(`[loadPlugins] 懒加载模式：跳过 ${plugins.length} 个插件的预初始化`);
    return;
  }

  await Promise.allSettled(plugins.map(async (source) => {
    if (pluginInstances.has(source.id)) return;
    if (source.format === 'lx') {
      if (!source.enabled) {
        log(`跳过禁用的 LX 插件: ${source.name}`);
        return;
      }
      try {
        await initLxPlugin(source);
      } catch (e: any) {
        log(`LX 插件 ${source.name} 初始化失败: ${e?.message || e}`);
      }
      return;
    }

    try {
      await ensurePluginInstance(source);
    } catch (e: any) {
      log(`插件 ${source.name} 加载失败: ${e?.message || e}`);
    }
  }));
}

// ==================== 插件更新 ====================

const pluginUpdateService = createPluginUpdateService({
  ensurePluginInstance,
  loadPluginFromScript,
  getStoredPlugins,
  getSubscriptions: () => pluginSubscriptionService.getSubscriptions(),
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
});

export const checkPluginUpdate = pluginUpdateService.checkPluginUpdate;
export const performPluginUpdate = pluginUpdateService.performPluginUpdate;
export const checkAllPluginUpdates = pluginUpdateService.checkAllPluginUpdates;
export type { PluginUpdateCheckResult } from './pluginUpdates';

// ==================== 云端同步支持 ====================

export async function getPluginScript(id: string): Promise<string | null> {
  const instance = pluginInstances.get(id);
  if (instance?.script) {
    return instance.script;
  }

  const source = getStoredPlugins().find(p => p.id === id);
  if (!source) return null;

  if (source.format === 'lx') {
    const lxScript = await getLxPluginScript(id, source.filePath);
    if (lxScript) return lxScript;
  }

  try {
    if (source.filePath.startsWith('builtin://')) {
      return null;
    } else if (source.filePath.startsWith('http')) {
      try {
        const resp = await fetchWithTimeout(source.filePath, 10000);
        if (resp.ok) {
          const script = await resp.text();
          // 拉取成功即静默落盘缓存：远程源不可达时上传有脚本可用
          await writeCachedHttpScript(id, script);
          return script;
        }
      } catch {
        /* 落到缓存兜底 */
      }
      const cached = await readCachedHttpScript(id);
      if (cached) return cached;
    } else {
      return await pluginApi.readPluginFile(source.filePath);
    }
  } catch {
    return null;
  }
  return null;
}

export async function persistPluginScriptToDataDir(
  source: PluginSource,
  script: string,
): Promise<string | null> {
  const fp = source.filePath;
  if (!fp || fp.startsWith('builtin://') || fp.startsWith('http')) return null;
  try {
    const savedPath = await pluginApi.savePluginScript(source.id, script);
    return savedPath;
  } catch (e: any) {
    log(`保存插件脚本到数据目录失败 ${source.name}: ${e?.message || e}`);
    return null;
  }
}

export async function restorePluginFromSync(
  source: PluginSource,
  script: string,
): Promise<boolean> {
  try {
    if (!script || script.trim().length === 0) {
      log(`restorePluginFromSync: 脚本为空, 跳过 ${source.name}`);
      return false;
    }

    const existing = getStoredPlugins().find(p => p.id === source.id);
    if (existing) {
      const updates: Partial<PluginSource> = {
        enabled: source.enabled,
        sortOrder: source.sortOrder,
        name: source.name,
        version: source.version,
      };
      const savedPath = await persistPluginScriptToDataDir(existing, script);
      if (savedPath) {
        updates.filePath = savedPath;
      } else if (existing.filePath.startsWith('http')) {
        // URL 型脚本无文件路径可持久化，落缓存兜底：云端重装后远程源再挂也不失联
        await writeCachedHttpScript(source.id, script);
      }
      updatePluginSource(source.id, updates);
      log(`restorePluginFromSync: 插件已存在, 更新元数据 ${source.name}`);
      return true;
    }

    const loadedSource = await loadPluginFromScript(script, source.filePath);
    if (!loadedSource) {
      log(`restorePluginFromSync: 脚本解析失败 ${source.name}`);
      return false;
    }

    const savedPath = await persistPluginScriptToDataDir(loadedSource, script);
    if (savedPath) {
      loadedSource.filePath = savedPath;
    } else if (loadedSource.filePath.startsWith('http')) {
      // URL 型脚本无文件路径可持久化，落缓存兜底
      await writeCachedHttpScript(loadedSource.id, script);
    }

    const merged: PluginSource = {
      ...loadedSource,
      enabled: source.enabled,
      sortOrder: source.sortOrder ?? loadedSource.sortOrder,
      importedAt: source.importedAt || loadedSource.importedAt,
      // 云端插件快照携带的原始安装 URL（含 key=/source=）透传给本地
      sourceUrl: source.sourceUrl || loadedSource.sourceUrl,
    };

    const entry = pluginInstances.get(loadedSource.id);
    if (entry) {
      entry.source = merged;
      pluginInstances.set(merged.id, entry);
      if (loadedSource.id !== merged.id) {
        pluginInstances.delete(loadedSource.id);
      }
    }

    addPluginSource(merged);
    log(`restorePluginFromSync: 恢复成功 ${merged.name} (${merged.format})`);

    if (merged.format === 'lx' && merged.enabled) {
      await initLxPlugin(merged);
    }

    return true;
  } catch (e: any) {
    log(`restorePluginFromSync: 恢复失败 ${source.name} - ${e?.message || e}`);
    return false;
  }
}

// ==================== URL 型插件本地转正 ====================

/**
 * 存量 URL 型插件本地转正（多端统一「安装即落盘」模型）：
 * 拉取脚本落盘并把 filePath 改指向本地（sourceUrl 保留，仍用于检查更新）。
 * 转正后加载实例/同步上传只读本地，第三方源挂掉不再导致插件失联。
 * 拉取失败的保持原状，继续由脚本缓存兜底，下次启动重试。
 * 幂等：转正后 filePath 为本地，重复调用自动跳过。
 */
export async function migrateHttpPluginsToLocal(): Promise<number> {
  const httpPlugins = getStoredPlugins().filter(p => p.filePath.startsWith('http'));
  if (httpPlugins.length === 0) return 0;
  let migrated = 0;
  for (const p of httpPlugins) {
    try {
      let script = '';
      try {
        const resp = await fetchWithTimeout(p.filePath, 10000);
        if (resp.ok) script = await resp.text();
      } catch {
        /* 尝试带 UA 的通道 */
      }
      if (!script) {
        try {
          script = await pluginApi.fetchPluginUrl(p.filePath);
        } catch {
          /* 源不可达，保留现状，下次启动重试 */
          continue;
        }
      }
      // 最小防坏校验：拒绝空脚本与误拉到的 HTML 错误页
      const trimmed = script.trim();
      if (trimmed.length < 50 || /^<!doctype html|^<html/i.test(trimmed)) {
        log(`[migrate] ${p.name} 源返回内容非插件脚本，跳过转正`);
        continue;
      }
      const savedPath = await pluginApi.savePluginScript(p.id, script);
      // 原 URL 迁入 sourceUrl：付费来源判定（key=/source=）与检查更新仍需原始 URL
      updatePluginSource(p.id, { filePath: savedPath, sourceUrl: p.filePath });
      // 转正后缓存记录不再需要，脚本本体即正式文件；
      // 已缓存的实例按旧 URL 内容加载，丢弃待按本地文件重建
      pluginInstances.delete(p.id);
      removeCachedHttpScript(p.id);
      migrated++;
      log(`[migrate] URL 型插件已转正本地: ${p.name}`);
    } catch (e: any) {
      log(`[migrate] URL 型插件转正失败 ${p.name}: ${e?.message || e}`);
    }
  }
  if (migrated > 0) {
    bumpPluginsVersion();
  }
  return migrated;
}

// ==================== 订阅管理 ====================

const pluginSubscriptionService = createPluginSubscriptionService({
  loadPluginFromScript,
  addPluginSource,
  getStoredPlugins,
  compareVersions,
});

export const getSubscriptions = pluginSubscriptionService.getSubscriptions;
export const isValidSubscriptionUrl = pluginSubscriptionService.isValidSubscriptionUrl;
export const addSubscription = pluginSubscriptionService.addSubscription;
export const updateSubscription = pluginSubscriptionService.updateSubscription;
export const removeSubscription = pluginSubscriptionService.removeSubscription;
export const removeSubscriptionsByUrls = pluginSubscriptionService.removeSubscriptionsByUrls;
export const mergeSubscriptionsFromCloud = pluginSubscriptionService.mergeSubscriptionsFromCloud;
export const installFromSubscriptionUrl = pluginSubscriptionService.installFromSubscriptionUrl;
export const installAllSubscriptions = pluginSubscriptionService.installAllSubscriptions;