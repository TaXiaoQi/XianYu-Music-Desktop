import type { PluginSource } from '../../types';
import { pluginApi } from '../tauri/pluginApi';
import { hostSha256Hex } from '../tauri/hostCryptoApi';
import { fetchWithTimeout } from './pluginFetch';
import {
  loadLxInSandbox,
  destroySandbox,
  linkSandboxAlias,
} from './pluginSandboxManager';
import {
  _sandboxedPlugins,
  log,
  lxPlugins,
  parseLxScriptInfo,
  type LxPluginState,
} from './lxPluginEngineBase';

const _g = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {} as any);
if (!_g.__lxScriptCache) {
  _g.__lxScriptCache = new Map<string, string>();
}
const scriptCache: Map<string, string> = _g.__lxScriptCache;

if (!_g.__lxEnsureLock) {
  _g.__lxEnsureLock = new Map<string, Promise<LxPluginState | null>>();
}
const _ensureLock: Map<string, Promise<LxPluginState | null>> = _g.__lxEnsureLock;

async function fetchLxPluginScript(filePath: string): Promise<string> {
  const cached = scriptCache.get(filePath);
  if (cached) return cached;

  let script = '';
  if (filePath.startsWith('builtin://')) {
    const builtinMap: Record<string, string> = {};
    const webPath = builtinMap[filePath];
    if (webPath) {
      try {
        const resp = await fetchWithTimeout(webPath, 5000);
        if (resp.ok) script = await resp.text();
      } catch (e: any) {
        log(`[fetchLxPluginScript] 内置插件 fetch 失败: ${filePath} - ${e?.message}`);
      }
    }
  } else if (filePath.startsWith('http')) {
    try {
      const resp = await pluginApi.pluginHttpRequest('GET', filePath, {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
      }, undefined, 10000);
      if (resp.status >= 200 && resp.status < 300 && resp.body) script = resp.body;
    } catch (e: any) {
      log(`[fetchLxPluginScript] Tauri 代理获取远程脚本失败: ${filePath} - ${e?.message}`);
    }
  } else if (filePath) {
    try {
      script = await pluginApi.readPluginFile(filePath);
    } catch (e: any) {
      log(`[fetchLxPluginScript] 读取本地文件失败: ${filePath} - ${e?.message}`);
    }
  }

  if (script) {
    scriptCache.set(filePath, script);
  }
  return script;
}

export async function loadLxPluginFromScript(
  script: string,
  uri: string,
): Promise<PluginSource | null> {
  const bytes = new TextEncoder().encode(script);
  if (bytes.length > 2 * 1024 * 1024) {
    log(`插件大小超过 2MB: ${bytes.length} bytes`);
    return null;
  }
  if (script.trim().length === 0) {
    log('插件内容为空');
    return null;
  }

  const scriptInfo = parseLxScriptInfo(script);
  log(`=== 开始加载落雪插件: ${scriptInfo.name || uri} ===`);

  const hash = await hostSha256Hex(script);
  const existingState = lxPlugins.get(hash);
  if (existingState && existingState.status === 'ready' && existingState.source) {
    log(`[loadLxPluginFromScript] 复用已有就绪实例: ${hash}`);
    return existingState.source;
  }
  if (existingState) {
    log(`[loadLxPluginFromScript] 销毁残留实例(非就绪): ${hash}`);
    destroyLxPlugin(hash);
  }

  // ===== Rust QuickJS 沙箱执行插件脚本（唯一路径，禁止回退主线程 eval）=====
  log(`[loadLxPluginFromScript] 沙箱模式加载: ${scriptInfo.name}`);
  try {
    const initInfo = await loadLxInSandbox(hash, script, {
      name: scriptInfo.name,
      version: scriptInfo.version,
      author: scriptInfo.author,
      description: scriptInfo.description,
      homepage: scriptInfo.homepage,
    });

    if (!initInfo?.sources || Object.keys(initInfo.sources).length === 0) {
      log('沙箱: 插件未声明任何源 (sources 为空)');
      return {
        id: hash,
        name: scriptInfo.name || '未知插件',
        format: 'lx',
        version: scriptInfo.version || '',
        author: scriptInfo.author || '',
        description: scriptInfo.description || '插件未声明任何音源',
        filePath: uri,
        importedAt: Date.now(),
        enabled: false,
        sources: [],
      };
    }

    const sandboxState: LxPluginState = {
      source: null as any,
      initInfo,
      status: 'ready',
      requestHandler: null,
      lxApi: null,
      pendingRequests: new Map(),
    };

    const source: PluginSource = {
      id: hash,
      name: scriptInfo.name || '未知插件',
      format: 'lx',
      version: scriptInfo.version || '',
      author: scriptInfo.author || '',
      description: scriptInfo.description || '',
      filePath: uri,
      importedAt: Date.now(),
      enabled: true,
      sources: Object.keys(initInfo.sources),
    };
    sandboxState.source = source;
    lxPlugins.set(hash, sandboxState);
    _sandboxedPlugins.add(hash);

    log(`=== 落雪插件沙箱加载成功: "${source.name}" (sources: ${Object.keys(initInfo.sources).join(',')}) ===`);
    return source;
  } catch (e: any) {
    log(`[loadLxPluginFromScript] 沙箱加载失败，已阻止回退到主线程直接执行: ${e?.message}`);
    throw e;
  }
}

export async function ensureLxPluginInstance(source: PluginSource): Promise<LxPluginState | null> {
  if (!source.enabled) {
    log(`[ensureLxPluginInstance] 插件已禁用，跳过: ${source.name}`);
    return null;
  }
  const state = lxPlugins.get(source.id);
  if (state && state.status === 'ready') return state;

  const existing = _ensureLock.get(source.id);
  if (existing) {
    log(`[ensureLxPluginInstance] 等待已存在的初始化 Promise: ${source.name}`);
    return existing;
  }

  const initPromise = (async () => {
    log(`落雪插件实例未缓存，重新加载: ${source.name} (${source.filePath})`);
    try {
      const script = await fetchLxPluginScript(source.filePath);

      if (script) {
        const result = await loadLxPluginFromScript(script, source.filePath);
        if (result && result.id !== source.id) {
          const newState = lxPlugins.get(result.id);
          if (newState) {
            lxPlugins.set(source.id, newState);
            if (_sandboxedPlugins.has(result.id)) {
              _sandboxedPlugins.add(source.id);
              linkSandboxAlias(source.id, result.id);
            }
          }
        }
      }

      return lxPlugins.get(source.id) || null;
    } catch (e) {
      log(`落雪插件重新加载失败: ${source.name} ${e}`);
      return null;
    } finally {
      _ensureLock.delete(source.id);
    }
  })();

  _ensureLock.set(source.id, initPromise);
  return initPromise;
}

export function destroyLxPlugin(sourceId: string) {
  if (_sandboxedPlugins.has(sourceId)) {
    _sandboxedPlugins.delete(sourceId);
    destroySandbox(sourceId).catch(() => {});
  }

  const state = lxPlugins.get(sourceId);
  if (!state) return;
  for (const [key, pending] of state.pendingRequests) {
    clearTimeout(pending.timer);
    pending.reject(new Error('Plugin destroyed'));
    state.pendingRequests.delete(key);
  }
  state.requestHandler = null;
  state.lxApi = null;
  state.status = 'error';
  state.initInfo = null;
  lxPlugins.delete(sourceId);
  log(`落雪插件已销毁: ${sourceId}`);
}

export async function initLxPlugin(source: PluginSource): Promise<boolean> {
  const existing = lxPlugins.get(source.id);
  if (existing && existing.status === 'ready') return true;

  if (existing) {
    destroyLxPlugin(source.id);
  }

  log(`[initLxPlugin] 开始初始化: ${source.name} (${source.filePath})`);

  try {
    const script = await fetchLxPluginScript(source.filePath);

    if (!script) {
      log(`[initLxPlugin] 无法读取脚本: ${source.filePath}`);
      return false;
    }

    const result = await loadLxPluginFromScript(script, source.filePath);
    if (result && result.sources && result.sources.length > 0) {
      if (result.id !== source.id) {
        const newState = lxPlugins.get(result.id);
        if (newState) {
          lxPlugins.set(source.id, newState);
          if (_sandboxedPlugins.has(result.id)) {
            _sandboxedPlugins.add(source.id);
            linkSandboxAlias(source.id, result.id);
          }
        }
      }
      log(`[initLxPlugin] 初始化成功: ${source.name}`);
      return true;
    } else {
      log(`[initLxPlugin] 初始化失败: ${source.name} (sources 为空)`);
      return false;
    }
  } catch (e: any) {
    log(`[initLxPlugin] 初始化异常: ${source.name} - ${e?.message}`);
    return false;
  }
}

export async function getLxPluginScript(sourceId: string, fallbackFilePath?: string): Promise<string | null> {
  const state = lxPlugins.get(sourceId);
  const memoryPath = state?.source?.filePath ?? '';
  const persistPath = fallbackFilePath?.trim() ?? '';
  const filePath = persistPath || memoryPath;
  if (!filePath) return null;

  if (persistPath && memoryPath && persistPath !== memoryPath) {
    log(`[getLxPluginScript] ${sourceId.slice(0, 8)}… 持久化路径(备份) ${persistPath} 与内存路径(原文件) ${memoryPath} 不一致，优先读取备份`);
  }

  const cached = scriptCache.get(filePath)
    || (memoryPath && scriptCache.get(memoryPath) ? scriptCache.get(memoryPath) : undefined);
  if (cached) return cached;

  for (const p of new Set([filePath, memoryPath].filter(Boolean))) {
    try {
      const script = await fetchLxPluginScript(p as string);
      if (script) return script;
    } catch { /* 尝试下一个路径 */ }
  }
  return null;
}