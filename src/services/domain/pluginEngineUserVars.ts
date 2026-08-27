/**
 * 插件引擎 · 用户变量管理。
 *
 * 负责读取/保存插件的用户变量值（含 B站 Cookie 同步）、获取/异步确保
 * 用户变量定义（优先实例缓存 → 完整加载 → 源码静态提取）、刷新变量徽标。
 * 仅依赖 pluginEngineBase / pluginEngineInstance 与外部工具模块。
 */
import type { PluginSource } from '../../types';
import {
  BUILTIN_PLUGINS,
  extractPluginUserVariablesFromScript,
  getNormalizedCachedUserVariables,
  getStoredPlugins,
  log,
  normalizePluginUserVariables,
  pluginInstances,
  userVarDefsCache,
  userVarKey,
  type PluginUserVariable,
} from './pluginEngineBase';
import { ensurePluginInstance } from './pluginEngineInstance';
import { pluginApi } from '../tauri/pluginApi';
import { fetchWithTimeout } from './pluginFetch';

// ==================== 源码读取（用于用户变量静态提取） ====================

async function readPluginScriptForUserVariables(source: PluginSource): Promise<string> {
  if (source.filePath.startsWith('builtin://')) {
    const webPath = BUILTIN_PLUGINS[source.filePath];
    if (!webPath) return '';
    const resp = await fetchWithTimeout(webPath, 5000);
    return resp.ok ? await resp.text() : '';
  }
  if (source.filePath.startsWith('http')) {
    try {
      const resp = await fetchWithTimeout(source.filePath, 10000);
      if (resp.ok) return await resp.text();
    } catch { /* fallback to tauri fetch */ }
    try {
      return await pluginApi.fetchPluginUrl(source.filePath);
    } catch {
      return '';
    }
  }
  if (source.filePath) {
    try {
      return await pluginApi.readPluginFile(source.filePath);
    } catch {
      return '';
    }
  }
  return '';
}

// ==================== 用户变量值存储 ====================

const BILIBILI_COOKIE_KEYS = new Set([
  'SESSDATA',
  'buvid3',
  'buvid4',
  'bili_jct',
  'DedeUserID',
  'DedeUserID__ckMd5',
  'b_nut',
  '_uuid',
  'PVID',
  'sid',
]);

function storePluginCookie(name: string, value: unknown): void {
  try {
    if (!name || value == null || String(value) === '') return;
    const cookieStore = JSON.parse(localStorage.getItem('__plugin_cookies') || '{}');
    cookieStore[name] = { value: String(value), domain: 'bilibili.com' };
    localStorage.setItem('__plugin_cookies', JSON.stringify(cookieStore));
  } catch {
    /* ignore */
  }
}

/**
 * 把 B站插件用户变量里可识别的 B站 Cookie 写入 __plugin_cookies，
 * 供 getPluginBilibiliCookies() 取流/下载防盗链使用。支持：
 *  - 已知 Cookie 键名的变量（SESSDATA/buvid3 等）
 *  - 值整体为浏览器导出的 Cookie JSON 数组 / 对象
 */
function syncBilibiliCookiesFromVars(values: Record<string, string>): void {
  for (const k of Object.keys(values)) {
    if (BILIBILI_COOKIE_KEYS.has(k) && values[k]) {
      storePluginCookie(k, values[k]);
    }
  }
  for (const raw of Object.values(values)) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!(trimmed.startsWith('[') || trimmed.startsWith('{'))) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const items = Array.isArray(parsed)
        ? parsed
        : Object.entries(parsed).map(([n, v]) => ({ name: n, value: v }));
      for (const it of items) {
        if (it && it.name && it.value != null) {
          storePluginCookie(String(it.name), it.value);
        }
      }
    } catch {
      /* ignore */
    }
  }
}

/** 保存指定插件的用户变量值 */
export function setPluginUserVariableValues(pluginId: string, values: Record<string, string>) {
  try {
    const keys = Object.keys(values);
    log(`[setPluginUserVariableValues] pluginId=${pluginId.substring(0, 12)}... 保存 keys=[${keys.join(',')}] count=${keys.length}`);
    for (const k of keys) {
      log(`[setPluginUserVariableValues]  ${k}=${values[k] ? '(已设置,' + String(values[k]).length + '字符)' : '(空)'}`);
    }
    localStorage.setItem(userVarKey(pluginId), JSON.stringify(values));
    // B站插件：把用户变量里的 B站 Cookie 同步进取流读取的 Cookie 存储（取流/下载防盗链）
    const biliSource = getStoredPlugins().find(
      (p) => p.id === pluginId && (p.name === 'bilibili' || String(p.id || '').includes('bilibili')),
    );
    if (biliSource) {
      syncBilibiliCookiesFromVars(values);
    }
  } catch (e) {
    log(`[setPluginUserVariableValues] 保存异常: ${e}`);
  }
}

/** 删除指定插件的用户变量值（卸载时调用） */
export function removePluginUserVariableValues(pluginId: string) {
  try {
    localStorage.removeItem(userVarKey(pluginId));
  } catch { /* ignore */ }
}

// ==================== 用户变量定义获取 ====================

/**
 * 获取插件实例定义的用户变量列表（用于 UI 渲染输入表单）。
 * 优先从完整实例缓存读取，其次从轻量 userVarDefsCache 读取，
 * 两者均未命中时返回空数组（需调用 ensurePluginUserVariables 异步加载）。
 */
export function getPluginUserVariables(pluginId: string): PluginUserVariable[] {
  const inst = pluginInstances.get(pluginId);
  if (inst?.instance?.userVariables) {
    const normalized = normalizePluginUserVariables(inst.instance.userVariables);
    if (normalized.length > 0) {
      userVarDefsCache.set(pluginId, normalized);
      return normalized;
    }
  }
  return getNormalizedCachedUserVariables(pluginId);
}

/**
 * 异步确保插件用户变量定义已加载。
 * 懒加载模式下插件可能尚未初始化，此函数会触发 ensurePluginInstance 完成加载，
 * 然后从实例中提取 userVariables 并缓存到 userVarDefsCache。
 *
 * 典型场景：QQ音乐L2 等插件需要用户配置密钥（cookie/token）才能播放，
 * 用户在设置页打开插件详情时调用此函数获取变量定义以渲染输入表单。
 */
export async function ensurePluginUserVariables(source: PluginSource): Promise<PluginUserVariable[]> {
  // 1. 优先从已有缓存读取（无需加载插件）
  const cached = getNormalizedCachedUserVariables(source.id);
  if (cached.length > 0) return cached;

  const inst = pluginInstances.get(source.id);
  const instVars = inst?.instance?.userVariables
    ? normalizePluginUserVariables(inst.instance.userVariables)
    : [];
  if (instVars.length > 0) {
    userVarDefsCache.set(source.id, instVars);
    return instVars;
  }

  // 2. 缓存未命中，触发完整加载
  const loaded = await ensurePluginInstance(source);
  const loadedVars = loaded?.instance?.userVariables
    ? normalizePluginUserVariables(loaded.instance.userVariables)
    : [];
  if (loadedVars.length > 0) {
    userVarDefsCache.set(source.id, loadedVars);
    return loadedVars;
  }

  // 3. 实例加载失败或实例未暴露 userVariables 时，从源码静态提取。
  // Baka/Toskysun 插件通常直接在 module.exports 中声明 userVariables，
  // 例如 QQ音乐[L2] 的 SOURCE_API_KEY。静态兜底可避免设置页密钥输入框消失。
  const script = await readPluginScriptForUserVariables(source);
  if (script) {
    const normalized = extractPluginUserVariablesFromScript(script);
    if (normalized.length > 0) {
      userVarDefsCache.set(source.id, normalized);
      return normalized;
    }
  }

  return [];
}

/**
 * 异步刷新所有已存储插件的 userVariables 定义缓存。
 * 用于设置页初始化时显示"变量"徽标——仅加载尚未缓存的插件，已缓存则跳过。
 * 返回有用户变量定义的插件 ID 集合。
 */
export async function refreshUserVariableBadges(): Promise<Set<string>> {
  const allPlugins = getStoredPlugins();
  const result = new Set<string>();

  await Promise.allSettled(allPlugins.map(async (source) => {
    // 跳过 LX 插件（LX 协议无 userVariables 概念）
    if (source.format === 'lx') return;

    // 优先读缓存
    const cached = getNormalizedCachedUserVariables(source.id);
    if (cached.length > 0) {
      result.add(source.id);
      return;
    }

    // 已在实例缓存中。若沙箱代理只暴露了空数组（truthy 但无定义），
    // 不提前返回，继续走 ensurePluginUserVariables 的静态提取兜底。
    const inst = pluginInstances.get(source.id);
    const instVars = inst?.instance?.userVariables
      ? normalizePluginUserVariables(inst.instance.userVariables)
      : [];
    if (instVars.length > 0) {
      userVarDefsCache.set(source.id, instVars);
      result.add(source.id);
      return;
    }

    // 未缓存：异步加载或从源码静态提取。
    // 不限制 enabled 状态，也兼容历史数据中 format=unknown 的 MusicFree/Baka 插件。
    try {
      const normalized = await ensurePluginUserVariables(source);
      if (normalized.length > 0) {
        result.add(source.id);
      }
    } catch {
      // 加载失败不阻塞其他插件
    }
  }));

  return result;
}