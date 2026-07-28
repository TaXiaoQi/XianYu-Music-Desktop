/**
 * 插件存储引擎（简化版）
 *
 * 从 YinDongMusic 的 pluginEngine.ts 中提取插件存储/管理部分，
 * 用于管理 LX 插件的持久化和状态。
 * 不包含 MusicFree 插件加载逻辑（LX 插件由 lxPluginEngine.ts 处理）。
 */

import type { PluginSource } from '../types';

// ==================== 常量 ====================

const PLUGIN_SOURCES_KEY = 'lycia_plugin_sources_v4';

// ==================== 插件存储 ====================

function readPluginsFromLocalStorage(): PluginSource[] {
  try {
    const raw = localStorage.getItem(PLUGIN_SOURCES_KEY);
    if (raw) return JSON.parse(raw);
    return [];
  } catch {
    return [];
  }
}

export function getStoredPlugins(): PluginSource[] {
  return readPluginsFromLocalStorage();
}

export function addPluginSource(source: PluginSource) {
  const plugins = readPluginsFromLocalStorage();
  const existing = plugins.findIndex(p => p.id === source.id);
  if (existing >= 0) {
    plugins[existing] = source;
  } else {
    plugins.push(source);
  }
  localStorage.setItem(PLUGIN_SOURCES_KEY, JSON.stringify(plugins));
}

export function removePluginSource(id: string) {
  const stored = readPluginsFromLocalStorage().filter(p => p.id !== id);
  localStorage.setItem(PLUGIN_SOURCES_KEY, JSON.stringify(stored));
  // 同步清理 LX 插件实例
  try {
    const { destroyLxPlugin } = require('./lxPluginEngine');
    destroyLxPlugin(id);
  } catch { /* ignore */ }
}

export function updatePluginSource(id: string, updates: Partial<PluginSource>) {
  const stored = readPluginsFromLocalStorage();
  const idx = stored.findIndex(p => p.id === id);
  if (idx >= 0) {
    stored[idx] = { ...stored[idx], ...updates };
    localStorage.setItem(PLUGIN_SOURCES_KEY, JSON.stringify(stored));
  }
}

/**
 * 切换插件启用/禁用状态
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
    localStorage.setItem(PLUGIN_SOURCES_KEY, JSON.stringify(stored));
  }

  // LX 插件需要管理实例生命周期
  if (source.format === 'lx') {
    try {
      const { initLxPlugin, destroyLxPlugin } = await import('./lxPluginEngine');
      if (newEnabled) {
        const ok = await initLxPlugin(updatedSource);
        if (!ok) {
          // 初始化失败，回滚为禁用
          const rollback = readPluginsFromLocalStorage();
          const rIdx = rollback.findIndex(p => p.id === id);
          if (rIdx >= 0) {
            rollback[rIdx] = { ...updatedSource, enabled: false };
            localStorage.setItem(PLUGIN_SOURCES_KEY, JSON.stringify(rollback));
          }
          return { success: false, enabled: false, message: `${source.name} 初始化失败` };
        }
        return { success: true, enabled: true };
      } else {
        destroyLxPlugin(id);
        return { success: true, enabled: false };
      }
    } catch (e: any) {
      return { success: false, enabled: false, message: e?.message || '操作失败' };
    }
  }

  return { success: true, enabled: newEnabled };
}

/**
 * 启动时加载所有已启用的插件
 */
export async function loadPlugins(): Promise<void> {
  const plugins = getStoredPlugins();
  const enabledLxPlugins = plugins.filter(p => p.enabled && p.format === 'lx');
  if (enabledLxPlugins.length === 0) return;

  try {
    const { initLxPlugin } = await import('./lxPluginEngine');
    await Promise.allSettled(enabledLxPlugins.map(async (source) => {
      try {
        await initLxPlugin(source);
      } catch (e: any) {
        console.warn(`[PluginEngine] LX 插件 ${source.name} 初始化失败: ${e?.message || e}`);
      }
    }));
  } catch { /* ignore */ }
}
