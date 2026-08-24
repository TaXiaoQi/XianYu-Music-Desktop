/**
 * 兜底模块注册表：管理服务器下发模块的缓存、加载、分发与自动回滚。
 *
 * 设计要点：
 * - 内置默认实现即各业务函数本体，注册表只管理「下载的覆盖实现」；
 * - 分发语义：模块方法存在则优先调用，异常/连续失败自动回退内置实现；
 * - 生效语义：拉取成功后写入 localStorage 并清空已加载实例，
 *   正在执行的调用不受影响，下一次调用使用新实现（下一首/下次进页面生效）。
 */
import { localStore } from '../storage/localStore';
import { createFallbackHostCtx } from './hostCtx';
import {
  FALLBACK_MODULE_METHODS,
  type CachedFallbackModule,
  type FallbackModuleImpl,
  type FallbackModuleKey,
  type ServerFallbackModule,
} from './types';

const STORAGE_KEY = 'xianyu_fallback_modules_v1';

/** 连续失败达到该次数后，本会话内禁用该模块（下次拉取到新版本可恢复） */
const MAX_CONSECUTIVE_ERRORS = 3;

interface LoadedModule {
  impl: FallbackModuleImpl;
  version: number;
  consecutiveErrors: number;
  disabled: boolean;
}

const _loaded = new Map<FallbackModuleKey, LoadedModule>();

const readCacheModules = (): Partial<Record<FallbackModuleKey, CachedFallbackModule>> => {
  const cache = localStore.getJson<{ fetchedAt: number; modules: Partial<Record<FallbackModuleKey, CachedFallbackModule>> }>(STORAGE_KEY);
  return cache?.modules ?? {};
};

const writeCacheModules = (
  fetchedAt: number,
  modules: Partial<Record<FallbackModuleKey, CachedFallbackModule>>,
) => {
  localStore.setJson(STORAGE_KEY, { fetchedAt, modules });
};

/** 校验模块代码并执行，返回实现对象；任何异常返回 null */
const loadModuleFromCode = (key: FallbackModuleKey, code: string): FallbackModuleImpl | null => {
  try {
    // 下发代码 = 函数体，接收 ctx，返回实现对象
    const factory = new Function('ctx', `"use strict";\n${code}`) as (ctx: unknown) => FallbackModuleImpl;
    const impl = factory(createFallbackHostCtx());
    if (!impl || typeof impl !== 'object') return null;
    if (typeof impl.version !== 'number' || !Number.isFinite(impl.version) || impl.version < 1) return null;
    // 至少实现该模块声明的一个方法才有意义
    const expected = FALLBACK_MODULE_METHODS[key] ?? [];
    if (!expected.some(m => typeof impl[m] === 'function')) return null;
    return impl;
  } catch (e) {
    console.warn(`[FallbackModule] 模块 ${key} 代码加载失败，回退内置实现:`, e);
    return null;
  }
};

/** 懒加载：首次分发时从缓存读取并执行模块代码 */
const getLoadedModule = (key: FallbackModuleKey): LoadedModule | null => {
  const existing = _loaded.get(key);
  if (existing) return existing;

  const cached = readCacheModules()[key];
  if (!cached?.code) return null;

  const impl = loadModuleFromCode(key, cached.code);
  if (!impl) {
    // 坏代码：标记禁用，避免每次分发都重复尝试执行
    _loaded.set(key, { impl: { version: cached.version }, version: cached.version, consecutiveErrors: 0, disabled: true });
    return null;
  }

  const loaded: LoadedModule = { impl, version: impl.version, consecutiveErrors: 0, disabled: false };
  _loaded.set(key, loaded);
  return loaded;
};

/** 模块方法执行失败时记录；连续失败达到阈值则本会话禁用 */
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

/**
 * 异步分发：下载的覆盖实现优先，失败/缺失回落内置实现。
 * @param builtin 内置默认实现（现有函数本体）
 */
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

/** 同步分发：用于 isQqTrialMediaUrl / extractCoverUrl 等同步兜底函数 */
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

/**
 * 应用服务端下发结果：写入缓存并使已加载实例失效。
 * 仅在整包校验通过后调用；服务端不可达时不应调用（保留本地缓存继续生效）。
 */
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
    if (cached?.version === item.version && cached?.digest === item.digest && cached.code === item.code) {
      next[item.moduleKey] = cached;
      continue;
    }
    next[item.moduleKey] = {
      version: item.version,
      digest: item.digest,
      code: item.code,
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
    // 已加载实例立即失效：正在执行的调用持有旧引用不受影响，
    // 后续调用（下一首/下次进页面）重新从缓存加载新实现
    _loaded.clear();
  }

  return { added, removed };
}

/** 当前缓存中的模块版本（调试用） */
export function getCachedFallbackModuleVersions(): Partial<Record<FallbackModuleKey, number>> {
  const modules = readCacheModules();
  const result: Partial<Record<FallbackModuleKey, number>> = {};
  for (const key of Object.keys(modules) as FallbackModuleKey[]) {
    result[key] = modules[key]?.version;
  }
  return result;
}

/** 清空本地缓存与已加载实例（恢复全部内置实现） */
export function clearFallbackModules(): void {
  localStore.remove(STORAGE_KEY);
  _loaded.clear();
}
