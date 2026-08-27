/**
 * 插件引擎 · 存储与生命周期。
 *
 * 插件列表的持久化 CRUD、启用/禁用切换、内置清理与批量加载、脚本读取/
 * 持久化/从云端同步恢复，以及插件更新与订阅两个服务的装配导出。
 * 仅依赖 pluginEngineBase / pluginEngineInstance / pluginEngineUserVars 与外部工具模块。
 */
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
import { compareVersions, createPluginUpdateService } from './pluginUpdates';
import { createPluginSubscriptionService } from './pluginSubscriptions';

// ==================== 插件存储 CRUD ====================

export function addPluginSource(source: PluginSource) {
  const plugins = readPluginsFromLocalStorage();
  const existing = plugins.findIndex(p => p.id === source.id);
  if (existing >= 0) {
    plugins[existing] = source;
  } else {
    // 设置初始排序权重：新插件排到所有插件的末尾
    source.sortOrder = plugins.length;
    plugins.push(source);
  }
  setStoredPlugins(plugins);
  bumpPluginsVersion();
}

/**
 * 按用户拖拽后的新顺序重写所有插件的 sortOrder
 * @param orderedIds 排序后的插件 ID 数组（完整列表）
 */
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
  // 沙箱模式清理：销毁 Worker
  if (_sandboxedPlugins.has(id)) {
    _sandboxedPlugins.delete(id);
    destroySandbox(id).catch(() => {});
  }
  pluginInstances.delete(id);
  userVarDefsCache.delete(id);
  removePluginUserVariableValues(id);
  // [修复防御]: LX 插件删除时也要销毁 iframe
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

/**
 * 切换插件启用/禁用状态
 * LX 插件启用时创建 iframe 初始化，禁用时销毁 iframe
 * 与 lx-music-desktop setUserApi → createWindow/closeWindow 流程一致
 */
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

  // LX 插件需要管理 iframe 生命周期
  if (source.format === 'lx') {
    if (newEnabled) {
      // 启用：创建 iframe 并初始化
      log(`[togglePlugin] 启用 LX 插件，开始初始化: ${source.name}`);
      const ok = await initLxPlugin(updatedSource);
      if (!ok) {
        // 初始化失败，回滚为禁用
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
      // 禁用：销毁 iframe
      log(`[togglePlugin] 禁用 LX 插件，销毁实例: ${source.name}`);
      destroyLxPlugin(id);
      return { success: true, enabled: false };
    }
  }

  // MusicFree 插件只需切换标志
  return { success: true, enabled: newEnabled };
}

// ==================== 内置插件清理（已取消所有内置插件，此函数仅用于清除旧版本遗留的内置插件条目） ====================

async function loadBuiltinPlugins(): Promise<void> {
  // 清除所有遗留的内置插件条目（BUILTIN_PLUGINS 已为空，所有 builtin:// 条目均视为过期）
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

  // BUILTIN_PLUGINS 已为空，无内置插件需加载；entries 为空数组，以下循环不会执行
  const entries = Object.entries(BUILTIN_PLUGINS);
  const results = await Promise.allSettled(entries.map(async ([builtinPath, webPath]) => {
    try {
      // 检查是否已存在
      const existing = getStoredPlugins().find(p => p.filePath === builtinPath);
      if (existing) {
        // 已存在：确保实例已加载
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

      // 不存在：加载并注册
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
  // 清理旧版本遗留的内置插件条目（已无内置插件）
  await loadBuiltinPlugins();

  const plugins = getStoredPlugins();

  // 懒加载模式：仅加载插件列表到内存，不预初始化实例
  // 实例将在 ensurePluginInstance 被调用时按需初始化
  if (lazyLoad) {
    log(`[loadPlugins] 懒加载模式：跳过 ${plugins.length} 个插件的预初始化`);
    return;
  }

  // [修复防御]: 并行加载所有插件，避免串行 await 导致 N 个插件 = N × 单插件耗时
  // 落雪插件每个最多等待 15s 初始化超时，串行 3 个 = 45s，并行后 = 15s
  await Promise.allSettled(plugins.map(async (source) => {
    // MusicFree 插件：已缓存则跳过
    if (pluginInstances.has(source.id)) return;
    // LX 插件：已初始化则跳过，禁用则不加载
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

    // MusicFree 插件：复用 ensurePluginInstance 加载（含并发保护），
    // 避免与榜单/搜索等页面按需加载同一插件时互相销毁沙箱导致加载失败
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
  // 订阅服务在本模块后部创建，此处以闭包惰性引用，运行时必然已初始化。
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

/**
 * 获取插件脚本内容（用于云端同步上传）
 * 优先从内存缓存读取，没有则尝试从文件/URL 读取
 */
export async function getPluginScript(id: string): Promise<string | null> {
  // 1. 优先从内存缓存读取
  const instance = pluginInstances.get(id);
  if (instance?.script) {
    return instance.script;
  }

  // 2. 从 localStorage 读取元数据，尝试重新加载脚本
  const source = getStoredPlugins().find(p => p.id === id);
  if (!source) return null;

  // 3. LX 格式插件：从 lxPluginEngine 的脚本缓存获取（使用 Tauri 代理避免 CORS）
  if (source.format === 'lx') {
    const lxScript = await getLxPluginScript(id, source.filePath);
    if (lxScript) return lxScript;
  }

  try {
    if (source.filePath.startsWith('builtin://')) {
      return null; // 内置插件不需要同步
    } else if (source.filePath.startsWith('http')) {
      const resp = await fetchWithTimeout(source.filePath, 10000);
      if (resp.ok) return await resp.text();
    } else {
      return await pluginApi.readPluginFile(source.filePath);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * 将本地文件路径的插件脚本保存到应用数据目录，返回新的 filePath。
 * 避免插件安装后原文件被移动/删除导致脚本读取失败。
 * 非本地路径（builtin/http）或保存失败时返回 null。
 */
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

/**
 * 从云端同步数据恢复插件
 * 解析脚本、创建实例、持久化元数据
 */
export async function restorePluginFromSync(
  source: PluginSource,
  script: string,
): Promise<boolean> {
  try {
    if (!script || script.trim().length === 0) {
      log(`restorePluginFromSync: 脚本为空, 跳过 ${source.name}`);
      return false;
    }

    // 检查是否已存在相同插件
    const existing = getStoredPlugins().find(p => p.id === source.id);
    if (existing) {
      // 已存在：更新元数据，保留现有脚本缓存
      const updates: Partial<PluginSource> = {
        enabled: source.enabled,
        sortOrder: source.sortOrder,
        name: source.name,
        version: source.version,
      };
      // 本地文件路径的插件：同步一份副本到数据目录，避免原文件移动后失效
      const savedPath = await persistPluginScriptToDataDir(existing, script);
      if (savedPath) {
        updates.filePath = savedPath;
      }
      updatePluginSource(source.id, updates);
      log(`restorePluginFromSync: 插件已存在, 更新元数据 ${source.name}`);
      return true;
    }

    // 新插件：解析脚本并创建实例
    const loadedSource = await loadPluginFromScript(script, source.filePath);
    if (!loadedSource) {
      log(`restorePluginFromSync: 脚本解析失败 ${source.name}`);
      return false;
    }

    // 本地文件路径的插件：保存副本到数据目录，避免原文件移动后失效
    const savedPath = await persistPluginScriptToDataDir(loadedSource, script);
    if (savedPath) {
      loadedSource.filePath = savedPath;
    }

    // 合并同步的元数据（保留 enabled、sortOrder 等用户设置）
    const merged: PluginSource = {
      ...loadedSource,
      enabled: source.enabled,
      sortOrder: source.sortOrder ?? loadedSource.sortOrder,
      importedAt: source.importedAt || loadedSource.importedAt,
    };

    // 确保 instance 缓存使用正确的 id
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

    // LX 插件如果启用，需要初始化 iframe
    if (merged.format === 'lx' && merged.enabled) {
      await initLxPlugin(merged);
    }

    return true;
  } catch (e: any) {
    log(`restorePluginFromSync: 恢复失败 ${source.name} - ${e?.message || e}`);
    return false;
  }
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
export const mergeSubscriptionsFromCloud = pluginSubscriptionService.mergeSubscriptionsFromCloud;
export const installFromSubscriptionUrl = pluginSubscriptionService.installFromSubscriptionUrl;
export const installAllSubscriptions = pluginSubscriptionService.installAllSubscriptions;