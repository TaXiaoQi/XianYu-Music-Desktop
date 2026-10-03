import { APP_VERSION } from '../../../version';
import { localStore } from '../storage/localStore';
import { tauriInvoke } from '../tauri/invoke';
import {
  FALLBACK_MODULE_METHODS,
  type CachedFallbackModule,
  type FallbackModuleCache,
  type FallbackModuleKey,
  type ServerFallbackModule,
} from './types';

const STORAGE_KEY = 'xianyu_fallback_modules_v1';

const MAX_CONSECUTIVE_ERRORS = 3;

// 模块已迁到桌面端 Rust QuickJS 宿主执行：验签 + 编译 + 四条硬校验在
// fallback_module_load 一体完成，调用走 fallback_module_call / call_many。
// _loaded 只保存「已加载标记 + 熔断状态」，不再持有 JS impl。
interface LoadedModule {
  version: number;
  consecutiveErrors: number;
  disabled: boolean;
}

const _loaded = new Map<FallbackModuleKey, LoadedModule>();

// 防预热/首调竞态（R8）：同 key 的 load 只发一次，其余等待同一 Promise
const loadPromises = new Map<FallbackModuleKey, Promise<LoadedModule | null>>();

const readCache = (): {
  fetchedAt: number;
  modules: Partial<Record<FallbackModuleKey, CachedFallbackModule>>;
} => localStore.getJson<FallbackModuleCache>(STORAGE_KEY) ?? { fetchedAt: 0, modules: {} };

const readCacheModules = (): Partial<Record<FallbackModuleKey, CachedFallbackModule>> =>
  readCache().modules;

const writeCacheModules = (
  fetchedAt: number,
  modules: Partial<Record<FallbackModuleKey, CachedFallbackModule>>,
) => {
  localStore.setJson(STORAGE_KEY, { fetchedAt, modules });
};

const verifyCachedSignature = async (
  moduleKey: FallbackModuleKey,
  version: number,
  code: string,
  signature: string,
): Promise<boolean> => {
  try {
    const ok = await tauriInvoke('verify_fallback_module_signature', {
      moduleKey,
      version,
      code,
      signature,
    });
    return ok === true;
  } catch (error) {
    console.warn(`[FallbackModule] ${moduleKey} 缓存验签命令不可用，按未通过处理:`, error);
    return false;
  }
};

export async function sanitizeFallbackModuleCache(): Promise<{ removed: number }> {
  const { fetchedAt, modules } = readCache();
  let removed = 0;
  const next: Partial<Record<FallbackModuleKey, CachedFallbackModule>> = {};
  for (const key of Object.keys(modules) as FallbackModuleKey[]) {
    const m = modules[key];
    if (
      !m ||
      typeof m.code !== 'string' ||
      !m.code ||
      typeof m.signature !== 'string' ||
      !m.signature
    ) {
      removed += 1;
      continue;
    }
    if (!(await verifyCachedSignature(key, m.version, m.code, m.signature))) {
      removed += 1;
      console.warn(`[FallbackModule] 缓存模块 ${key} v${m.version} 验签失败，已清除（回退内置实现）`);
      continue;
    }
    next[key] = m;
  }
  if (removed > 0) {
    writeCacheModules(fetchedAt, next);
    _loaded.clear();
  }
  return { removed };
}

const printModuleLogs = (
  key: FallbackModuleKey,
  logs?: { level: string; message: string; callId: number }[] | null,
): void => {
  if (!Array.isArray(logs)) return;
  for (const entry of logs) {
    const line = `[FallbackModule] ${key}: ${entry.message}`;
    if (entry.level === 'error') console.error(line);
    else if (entry.level === 'warn') console.warn(line);
    else console.log(line);
  }
};

const loadModuleFromCache = async (
  key: FallbackModuleKey,
): Promise<LoadedModule | null> => {
  const cached = readCacheModules()[key];
  if (!cached?.code || typeof cached.signature !== 'string' || !cached.signature) return null;
  try {
    const res = await tauriInvoke('fallback_module_load', {
      moduleKey: key,
      version: cached.version,
      code: cached.code,
      signature: cached.signature,
      appVersion: APP_VERSION,
    });
    printModuleLogs(key, res?.logs);
    if (res?.ok) {
      return { version: res.version ?? cached.version, consecutiveErrors: 0, disabled: false };
    }
    // 验签/编译失败是确定性错误：本会话禁用，避免每次调用都重试
    console.warn(`[FallbackModule] 模块 ${key} v${cached.version} 宿主加载失败，本会话回退内置实现:`, res?.error);
    return { version: cached.version, consecutiveErrors: 0, disabled: true };
  } catch (error) {
    // IPC 异常可能是暂时的：不缓存状态，下次调用重试 load
    console.warn(`[FallbackModule] ${key} 宿主加载命令不可用，本次回退内置实现:`, error);
    return null;
  }
};

const ensureModuleLoaded = (key: FallbackModuleKey): Promise<LoadedModule | null> => {
  const existing = _loaded.get(key);
  if (existing) return Promise.resolve(existing);
  let pending = loadPromises.get(key);
  if (!pending) {
    pending = loadModuleFromCache(key)
      .then(loaded => {
        if (loaded) _loaded.set(key, loaded);
        return loaded;
      })
      .finally(() => {
        loadPromises.delete(key);
      });
    loadPromises.set(key, pending);
  }
  return pending;
};

/// 启动/同步后把缓存中的模块批量加载进 Rust 宿主，消除首次调用的 load 延迟
export function prewarmFallbackModules(): void {
  for (const key of Object.keys(readCacheModules()) as FallbackModuleKey[]) {
    void ensureModuleLoaded(key);
  }
}

const reportModuleError = (key: FallbackModuleKey, method: string, error: unknown) => {
  const loaded = _loaded.get(key);
  if (!loaded) return;
  loaded.consecutiveErrors += 1;
  console.warn(`[FallbackModule] 模块 ${key}.${method} 第 ${loaded.consecutiveErrors} 次执行失败，本次回退内置实现:`, error);
  if (loaded.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    loaded.disabled = true;
    console.warn(`[FallbackModule] 模块 ${key} 连续失败 ${loaded.consecutiveErrors} 次，本会话内已禁用（等待服务器下发新版本）`);
  }
};

export async function dispatchFallbackModule<T>(
  key: FallbackModuleKey,
  method: string,
  args: Record<string, unknown>,
  builtin: () => Promise<T> | T,
): Promise<T> {
  const loaded = await ensureModuleLoaded(key);
  if (loaded && !loaded.disabled) {
    try {
      const res = await tauriInvoke('fallback_module_call', {
        moduleKey: key,
        method,
        argsJson: JSON.stringify(args),
        timeoutMs: null,
      });
      printModuleLogs(key, res?.logs);
      if (res?.ok) {
        loaded.consecutiveErrors = 0;
        return res.data as T;
      }
      // Rust 侧超时/中断会销毁实例：删掉已加载标记，下次调用重新 load
      if (typeof res?.error === 'string' && res.error.includes('模块未加载')) {
        _loaded.delete(key);
      }
      reportModuleError(key, method, res?.error || '模块调用失败');
    } catch (error) {
      reportModuleError(key, method, error);
    }
  }
  return builtin();
}

/// 列表边界批量调用：一次 IPC call_many，逐项错误计数（连续失败熔断语义与
/// 单发一致），失败项逐项回退内置实现
export async function dispatchFallbackModuleMany<T>(
  key: FallbackModuleKey,
  method: string,
  argsList: Record<string, unknown>[],
  builtinMany: (args: Record<string, unknown>, index: number) => T,
): Promise<T[]> {
  if (argsList.length === 0) return [];
  const loaded = await ensureModuleLoaded(key);
  if (loaded && !loaded.disabled) {
    try {
      const res = await tauriInvoke('fallback_module_call_many', {
        moduleKey: key,
        method,
        argsJsonList: argsList.map(args => JSON.stringify(args)),
        timeoutMs: null,
      });
      printModuleLogs(key, res?.logs);
      const results = Array.isArray(res?.results) ? res.results : [];
      const out: T[] = [];
      for (let i = 0; i < argsList.length; i++) {
        const item = results[i];
        if (item?.ok) {
          loaded.consecutiveErrors = 0;
          out.push(item.data as T);
        } else {
          reportModuleError(key, method, item?.error || '模块调用失败');
          out.push(builtinMany(argsList[i], i));
        }
      }
      return out;
    } catch (error) {
      reportModuleError(key, method, error);
    }
  }
  return argsList.map((args, i) => builtinMany(args, i));
}

export function applyServerFallbackModules(modules: ServerFallbackModule[]): {
  added: number;
  removed: number;
} {
  const next: Partial<Record<FallbackModuleKey, CachedFallbackModule>> = {};
  let added = 0;
  let removed = 0;

  const prev = readCacheModules();
  for (const item of modules) {
    if (!item?.code || typeof item.code !== 'string') continue;
    const expectedMethods = FALLBACK_MODULE_METHODS[item.moduleKey];
    if (!expectedMethods) continue;
    const cached = prev[item.moduleKey];
    const sameVerified =
      cached?.version === item.version &&
      cached?.digest === item.digest &&
      cached?.code === item.code &&
      cached?.signature === item.signature &&
      !!cached?.signature;
    if (sameVerified) {
      next[item.moduleKey] = cached;
      continue;
    }
    next[item.moduleKey] = {
      version: item.version,
      digest: item.digest,
      code: item.code,
      signature: item.signature,
      name: item.name,
      updatedAt: item.updatedAt,
    };
    added += 1;
  }

  for (const key of Object.keys(prev) as FallbackModuleKey[]) {
    if (!next[key]) removed += 1;
  }

  if (added > 0 || removed > 0) {
    writeCacheModules(Date.now(), next);
    _loaded.clear();
  }

  return { added, removed };
}

export function getCachedFallbackModuleVersions(): Partial<Record<FallbackModuleKey, number>> {
  const modules = readCacheModules();
  const result: Partial<Record<FallbackModuleKey, number>> = {};
  for (const key of Object.keys(modules) as FallbackModuleKey[]) {
    result[key] = modules[key]?.version;
  }
  return result;
}

export function clearFallbackModules(): void {
  localStore.remove(STORAGE_KEY);
  _loaded.clear();
}
