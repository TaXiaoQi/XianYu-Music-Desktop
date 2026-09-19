import { localStore } from '../storage/localStore';
import { tauriInvoke } from '../tauri/invoke';
import { createFallbackHostCtx } from './hostCtx';
import {
  FALLBACK_MODULE_METHODS,
  type CachedFallbackModule,
  type FallbackModuleCache,
  type FallbackModuleImpl,
  type FallbackModuleKey,
  type ServerFallbackModule,
} from './types';

const STORAGE_KEY = 'xianyu_fallback_modules_v1';

const MAX_CONSECUTIVE_ERRORS = 3;

interface LoadedModule {
  impl: FallbackModuleImpl;
  version: number;
  consecutiveErrors: number;
  disabled: boolean;
}

const _loaded = new Map<FallbackModuleKey, LoadedModule>();

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

const loadModuleFromCode = (key: FallbackModuleKey, code: string): FallbackModuleImpl | null => {
  try {
    const factory = new Function('ctx', `"use strict";\n${code}`) as (ctx: unknown) => FallbackModuleImpl;
    const impl = factory(createFallbackHostCtx());
    if (!impl || typeof impl !== 'object') return null;
    if (typeof impl.version !== 'number' || !Number.isFinite(impl.version) || impl.version < 1) return null;
    const expected = FALLBACK_MODULE_METHODS[key] ?? [];
    if (!expected.some(m => typeof impl[m] === 'function')) return null;
    return impl;
  } catch (e) {
    console.warn(`[FallbackModule] 模块 ${key} 代码加载失败，回退内置实现:`, e);
    return null;
  }
};

const getLoadedModule = (key: FallbackModuleKey): LoadedModule | null => {
  const existing = _loaded.get(key);
  if (existing) return existing;

  const cached = readCacheModules()[key];
  if (!cached?.code || typeof cached.signature !== 'string' || !cached.signature) return null;

  const impl = loadModuleFromCode(key, cached.code);
  if (!impl) {
    _loaded.set(key, { impl: { version: cached.version }, version: cached.version, consecutiveErrors: 0, disabled: true });
    return null;
  }

  const loaded: LoadedModule = { impl, version: impl.version, consecutiveErrors: 0, disabled: false };
  _loaded.set(key, loaded);
  return loaded;
};

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
  builtin: () => Promise<T>,
): Promise<T> {
  const loaded = getLoadedModule(key);
  if (loaded && !loaded.disabled) {
    const fn = loaded.impl[method];
    if (typeof fn === 'function') {
      try {
        const result = await (fn as (a: Record<string, unknown>) => Promise<T> | T)(args);
        loaded.consecutiveErrors = 0;
        return result;
      } catch (error) {
        reportModuleError(key, method, error);
      }
    }
  }
  return builtin();
}

export function dispatchFallbackModuleSync<T>(
  key: FallbackModuleKey,
  method: string,
  args: Record<string, unknown>,
  builtin: () => T,
): T {
  const loaded = getLoadedModule(key);
  if (loaded && !loaded.disabled) {
    const fn = loaded.impl[method];
    if (typeof fn === 'function') {
      try {
        const result = (fn as (a: Record<string, unknown>) => T)(args);
        loaded.consecutiveErrors = 0;
        return result;
      } catch (error) {
        reportModuleError(key, method, error);
      }
    }
  }
  return builtin();
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
