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

export function setPluginUserVariableValues(pluginId: string, values: Record<string, string>) {
  try {
    const keys = Object.keys(values);
    log(`[setPluginUserVariableValues] pluginId=${pluginId.substring(0, 12)}... 保存 keys=[${keys.join(',')}] count=${keys.length}`);
    for (const k of keys) {
      log(`[setPluginUserVariableValues]  ${k}=${values[k] ? '(已设置,' + String(values[k]).length + '字符)' : '(空)'}`);
    }
    localStorage.setItem(userVarKey(pluginId), JSON.stringify(values));
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

export function removePluginUserVariableValues(pluginId: string) {
  try {
    localStorage.removeItem(userVarKey(pluginId));
  } catch { /* ignore */ }
}

// ==================== 用户变量定义获取 ====================

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

export async function ensurePluginUserVariables(source: PluginSource): Promise<PluginUserVariable[]> {
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

  const loaded = await ensurePluginInstance(source);
  const loadedVars = loaded?.instance?.userVariables
    ? normalizePluginUserVariables(loaded.instance.userVariables)
    : [];
  if (loadedVars.length > 0) {
    userVarDefsCache.set(source.id, loadedVars);
    return loadedVars;
  }

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

export async function refreshUserVariableBadges(): Promise<Set<string>> {
  const allPlugins = getStoredPlugins();
  const result = new Set<string>();

  await Promise.allSettled(allPlugins.map(async (source) => {
    if (source.format === 'lx') return;

    const cached = getNormalizedCachedUserVariables(source.id);
    if (cached.length > 0) {
      result.add(source.id);
      return;
    }

    const inst = pluginInstances.get(source.id);
    const instVars = inst?.instance?.userVariables
      ? normalizePluginUserVariables(inst.instance.userVariables)
      : [];
    if (instVars.length > 0) {
      userVarDefsCache.set(source.id, instVars);
      result.add(source.id);
      return;
    }

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