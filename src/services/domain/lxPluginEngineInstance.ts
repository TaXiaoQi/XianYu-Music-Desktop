/**
 * 落雪（LX）插件引擎 · 实例生命周期。
 *
 * 负责脚本内容读取/缓存、插件加载（Rust QuickJS 沙箱）、实例缓存、
 * 并发初始化锁、销毁与启用时初始化。仅依赖 lxPluginEngineBase 与
 * 外部工具模块（pluginApi/hostCryptoApi/pluginFetch/pluginSandboxManager）。
 */
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

// 脚本内容缓存：避免同一脚本被反复 fetch（挂到 globalThis 防 HMR 重置）
const _g = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {} as any);
if (!_g.__lxScriptCache) {
  _g.__lxScriptCache = new Map<string, string>();
}
const scriptCache: Map<string, string> = _g.__lxScriptCache;

// 并发初始化锁：首次播放时歌词获取与URL解析会并发调用 ensureLxPluginInstance，
// 没有此锁时第二个调用会销毁第一个正在 loading 的实例，导致歌词加载失败
if (!_g.__lxEnsureLock) {
  _g.__lxEnsureLock = new Map<string, Promise<LxPluginState | null>>();
}
const _ensureLock: Map<string, Promise<LxPluginState | null>> = _g.__lxEnsureLock;

/** 获取落雪插件脚本（带缓存） */
async function fetchLxPluginScript(filePath: string): Promise<string> {
  // 1. 检查缓存
  const cached = scriptCache.get(filePath);
  if (cached) return cached;

  let script = '';
  if (filePath.startsWith('builtin://')) {
    // 已取消所有内置插件，builtinMap 为空
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
    // [修复防御]: 远程 URL 必须通过 Tauri 后端代理，浏览器 fetch 会被 CORS 阻止
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

/**
 * 加载落雪 LX 插件脚本（Rust QuickJS 沙箱执行，前端仅编排）
 */
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

  // [修复防御]: 如果已有同 hash 且状态为 ready 的实例，直接复用，避免销毁重建 iframe
  // 之前每次 loadLxPluginFromScript 都会销毁已有实例并重建 iframe，导致 15s 初始化超时被重复触发
  const hash = await hostSha256Hex(script);
  const existingState = lxPlugins.get(hash);
  if (existingState && existingState.status === 'ready' && existingState.source) {
    log(`[loadLxPluginFromScript] 复用已有就绪实例: ${hash}`);
    return existingState.source;
  }
  // 残留状态（loading 或 error）则先销毁
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

    // 创建 LxPluginState（requestHandler/lxApi 恒为 null，请求由 Rust 引擎处理）
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
  // [修复防御]: 禁用的插件不自动初始化
  if (!source.enabled) {
    log(`[ensureLxPluginInstance] 插件已禁用，跳过: ${source.name}`);
    return null;
  }
  const state = lxPlugins.get(source.id);
  if (state && state.status === 'ready') return state;

  // [修复防御]: 并发初始化锁 —— 同一插件的并发调用共享同一个初始化 Promise，
  // 避免两个调用同时进入 loadLxPluginFromScript 导致互相销毁 loading 实例
  const existing = _ensureLock.get(source.id);
  if (existing) {
    log(`[ensureLxPluginInstance] 等待已存在的初始化 Promise: ${source.name}`);
    return existing;
  }

  const initPromise = (async () => {
    log(`落雪插件实例未缓存，重新加载: ${source.name} (${source.filePath})`);
    try {
      // [修复防御]: 使用带缓存的 fetchLxPluginScript，避免同一脚本被反复 fetch
      const script = await fetchLxPluginScript(source.filePath);

      if (script) {
        const result = await loadLxPluginFromScript(script, source.filePath);
        // [修复防御]: 用 source.id 也缓存一份，确保后续 lxPluginRequest 能找到
        if (result && result.id !== source.id) {
          const newState = lxPlugins.get(result.id);
          if (newState) {
            lxPlugins.set(source.id, newState);
            // [修复] 重新加载得到的 hash 与外部存储的 source.id 可能不一致，
            // 若不把 source.id 也标记为沙箱并注册别名，lxPluginRequest 会走
            // 直接调用路径（沙箱实例 requestHandler 为 null），导致直链解析静默失败。
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
      // 初始化完成（成功或失败）后清除锁，允许后续重试
      _ensureLock.delete(source.id);
    }
  })();

  _ensureLock.set(source.id, initPromise);
  return initPromise;
}

/** 销毁落雪插件实例 */
export function destroyLxPlugin(sourceId: string) {
  // 沙箱模式清理：销毁 Worker
  if (_sandboxedPlugins.has(sourceId)) {
    _sandboxedPlugins.delete(sourceId);
    destroySandbox(sourceId).catch(() => {});
  }

  const state = lxPlugins.get(sourceId);
  if (!state) return;
  // [修复防御]: 清理所有待处理请求，避免 resolve/reject 泄漏
  for (const [key, pending] of state.pendingRequests) {
    clearTimeout(pending.timer);
    pending.reject(new Error('Plugin destroyed'));
    state.pendingRequests.delete(key);
  }
  // [新方案] 清理 requestHandler
  state.requestHandler = null;
  state.lxApi = null;  // [修复防御] 清理 lxApi 引用，避免销毁后仍能调用
  state.status = 'error';
  state.initInfo = null;
  lxPlugins.delete(sourceId);
  log(`落雪插件已销毁: ${sourceId}`);
}

/**
 * 启用落雪插件时调用 —— 读取脚本并直接 eval 初始化
 * 与 lx-music-desktop setUserApi → createWindow → initEnv 流程一致
 */
export async function initLxPlugin(source: PluginSource): Promise<boolean> {
  // 已就绪则直接返回
  const existing = lxPlugins.get(source.id);
  if (existing && existing.status === 'ready') return true;

  // 有残留状态则先销毁
  if (existing) {
    destroyLxPlugin(source.id);
  }

  log(`[initLxPlugin] 开始初始化: ${source.name} (${source.filePath})`);

  try {
    // [修复防御]: 使用带缓存的 fetchLxPluginScript，避免同一脚本被反复 fetch
    const script = await fetchLxPluginScript(source.filePath);

    if (!script) {
      log(`[initLxPlugin] 无法读取脚本: ${source.filePath}`);
      return false;
    }

    const result = await loadLxPluginFromScript(script, source.filePath);
    // [修复防御]: 区分真正初始化成功（sources 非空）和 fallback（初始化失败但允许导入）
    if (result && result.sources && result.sources.length > 0) {
      // [修复防御]: 用 source.id（localStorage 中的旧 hash）也缓存一份
      // loadLxPluginFromScript 用 SHA256(script) 作为 key，如果脚本内容变化，新 hash 与旧 source.id 不同
      // 导致后续 ensureLxPluginInstance/lxPluginRequest 通过 source.id 找不到缓存
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

/**
 * 获取 LX 插件的脚本内容（用于云端同步上传）
 * 优先从 scriptCache 读取，没有则通过 fetchLxPluginScript 重新获取。
 * @param sourceId 插件 ID
 * @param fallbackFilePath 当插件未加载到 lxPlugins 时，使用此 filePath 作为回退
 */
export async function getLxPluginScript(sourceId: string, fallbackFilePath?: string): Promise<string | null> {
  const state = lxPlugins.get(sourceId);
  // 优先使用调用方持久化的 filePath（`getPluginScript` 传入 `source.filePath`）。
  // 本地导入的插件经 persistPluginScriptToDataDir 后，该路径指向数据目录备份副本；
  // 而内存中 lxPlugins 的 filePath 仍是 loadPluginFromScript 时留下的原始导入文件位置。
  // 若按内存路径走，账号同步/备份会读取原导入文件——原文件被移动/删除时同步即失败，
  // 且违背"导入后以备份副本为准"的初衷。
  const memoryPath = state?.source?.filePath ?? '';
  const persistPath = fallbackFilePath?.trim() ?? '';
  const filePath = persistPath || memoryPath;
  if (!filePath) return null;

  if (persistPath && memoryPath && persistPath !== memoryPath) {
    log(`[getLxPluginScript] ${sourceId.slice(0, 8)}… 持久化路径(备份) ${persistPath} 与内存路径(原文件) ${memoryPath} 不一致，优先读取备份`);
  }

  // 1. 优先从脚本缓存读取（备份路径未命中时退回内存路径的缓存）
  const cached = scriptCache.get(filePath)
    || (memoryPath && scriptCache.get(memoryPath) ? scriptCache.get(memoryPath) : undefined);
  if (cached) return cached;

  // 2. 缓存未命中，按"持久化路径 → 内存路径"依次读取
  for (const p of new Set([filePath, memoryPath].filter(Boolean))) {
    try {
      const script = await fetchLxPluginScript(p as string);
      if (script) return script;
    } catch { /* 尝试下一个路径 */ }
  }
  return null;
}