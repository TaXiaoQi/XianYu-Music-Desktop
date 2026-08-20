/**
 * 插件沙箱管理器 —— 后端 QuickJS 引擎门面
 *
 * 插件脚本已在 Rust 后端（rquickjs/QuickJS）中隔离执行，本文件只做：
 *   1. 通过 Tauri 命令把加载/调用/销毁请求路由到后端引擎
 *   2. 本地缓存插件元数据与就绪状态（isSandboxReady / getSandboxInstance 是同步 API）
 *   3. 管理插件 ID 别名（旧存储 ID → 实际 hash ID）
 *   4. 回放引擎日志（含错误关键字采集）到控制台
 *   5. 一次性把旧 localStorage 中的插件 Cookie/Storage 迁移到后端持久化存储
 *
 * 导出签名与原 Worker 版完全一致，pluginEngine / lxPluginEngine /
 * bakaPluginManager 无需改动。
 */

import { tauriInvoke } from './tauri/invoke';
import type { LxScriptInfo } from './pluginSandboxTypes';
import type { PluginEngineLogContract } from './tauri/contracts';
import { randomizePinnedDeviceIdentity } from './pluginSandbox.deviceIdentity';

let _logCallback: ((msg: string) => void) | null = null;

function log(msg: string) {
  try { if (_logCallback) { _logCallback(msg); } } catch { /* ignore */ }
}

let _lastSandboxError: string | null = null;

export function clearLastSandboxError(): void {
  _lastSandboxError = null;
}

export function getLastSandboxError(): string | null {
  return _lastSandboxError;
}

// ==================== 类型 ====================

interface ManagedEntry {
  pluginId: string;
  format: 'musicfree' | 'lx';
  ready: boolean;
  instance: any | null;
}

// ==================== 状态 ====================

const _entries = new Map<string, ManagedEntry>();
const _aliases = new Map<string, string>();

function resolveSandboxId(pluginId: string): string {
  return _aliases.get(pluginId) || pluginId;
}

// ==================== 用户变量提供器 ====================

let _userVarsProvider: ((pluginId: string) => Record<string, string>) | null = null;

/**
 * 注册用户变量提供器
 *
 * pluginEngine 在加载插件时调用此函数注册一个回调，
 * 每次方法调用前由此回调获取最新用户变量值传给后端引擎。
 */
export function setUserVarsProvider(provider: ((pluginId: string) => Record<string, string>) | null) {
  _userVarsProvider = provider;
}

// ==================== 日志回放 ====================

/**
 * 把后端引擎日志回放到控制台。
 *
 * 语义与原 Worker 版一致：info 级诊断也直接输出，
 * 便于观察插件 musicUrl/lyric 的原始返回值；
 * 同时采集错误关键字供 getLastSandboxError 使用。
 */
function emitEngineLogs(logs: PluginEngineLogContract[] | null | undefined): void {
  if (!logs || !Array.isArray(logs)) return;
  for (const entry of logs) {
    const level = entry.level || 'log';
    const msg = entry.message || '';
    if (level === 'error') console.error(msg);
    else if (level === 'warn') console.warn(msg);
    else console.log(msg);
    if (msg.includes('获取播放源错误') || msg.includes('PlayAuth') || msg.includes('playauth')) {
      _lastSandboxError = msg;
    }
    try { _logCallback?.(msg); } catch { /* ignore */ }
  }
}

// ==================== 旧数据一次性迁移 ====================

const MIGRATION_FLAG_KEY = '__plugin_store_migrated_to_backend';

/**
 * 把旧 localStorage 中的插件 Cookie / Storage 一次性迁移到后端。
 * Rust 侧已有条目优先，仅补缺；迁移成功后打标记避免重复导入。
 */
async function migrateLegacyStoreOnce(): Promise<void> {
  try {
    if (localStorage.getItem(MIGRATION_FLAG_KEY)) return;

    const cookies: Record<string, { value: string; domain: string }> = {};
    try {
      const rawCookies = JSON.parse(localStorage.getItem('__plugin_cookies') || '{}');
      for (const [name, info] of Object.entries(rawCookies)) {
        const c = info as any;
        if (c && typeof c.value === 'string' && typeof c.domain === 'string') {
          cookies[name] = { value: c.value, domain: c.domain };
        }
      }
    } catch { /* ignore malformed cookie store */ }

    const storage: Record<string, string> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('__plugin_storage_')) {
          const value = localStorage.getItem(key);
          if (value !== null) storage[key.slice('__plugin_storage_'.length)] = value;
        }
      }
    } catch { /* ignore */ }

    await tauriInvoke('plugin_engine_store_import', { payload: { cookies, storage } });
    localStorage.setItem(MIGRATION_FLAG_KEY, String(Date.now()));
    if (Object.keys(cookies).length > 0 || Object.keys(storage).length > 0) {
      log(`插件存储已迁移到后端: ${Object.keys(cookies).length} cookies, ${Object.keys(storage).length} storage keys`);
    }
  } catch (e) {
    // 迁移失败不阻塞插件加载，下次启动会重试
    console.warn('[PluginSandbox] 插件存储迁移失败:', e);
  }
}

void migrateLegacyStoreOnce();

// ==================== 公开 API ====================

/**
 * 在后端引擎中加载 MusicFree 插件
 *
 * @param pluginId 插件唯一 ID（通常是脚本 SHA256）
 * @param script 插件源码
 * @param userVariables 用户变量值
 * @returns 插件元数据（platform, version, userVariables, _availableMethods 等）
 */
export async function loadMusicFreeInSandbox(
  pluginId: string,
  script: string,
  userVariables: Record<string, string>,
): Promise<any> {
  if (_entries.has(pluginId)) {
    await destroySandbox(pluginId);
  }

  // 硬编码设备标识随机化（Baka 系 QQ 插件共享身份限流问题）
  const script2 = randomizePinnedDeviceIdentity(script);

  const result = await tauriInvoke('plugin_engine_load_musicfree', {
    pluginId,
    script: script2,
    userVarsJson: JSON.stringify(userVariables || {}),
  });
  emitEngineLogs(result.logs);
  if (!result.ok) {
    _entries.delete(pluginId);
    throw new Error(result.error || '插件加载失败');
  }
  _entries.set(pluginId, {
    pluginId,
    format: 'musicfree',
    ready: true,
    instance: result.metadata || null,
  });
  return result.metadata;
}

/**
 * 给已存在的沙箱注册一个别名。
 *
 * 插件记录 ID 可能来自旧版本存储，而重新加载脚本得到的实际 hash ID 可能不同。
 * 通过别名让调用方仍可使用当前 source.id，同时由管理器转发到实际后端实例。
 */
export function linkSandboxAlias(aliasId: string, targetId: string): void {
  if (!aliasId || !targetId || aliasId === targetId) return;
  if (!_entries.has(targetId)) return;
  _aliases.set(aliasId, targetId);
  log(`沙箱别名已注册: ${aliasId.substring(0, 12)}... -> ${targetId.substring(0, 12)}...`);
}

/**
 * 在后端引擎中加载 LX 插件
 *
 * @param pluginId 插件唯一 ID
 * @param script 插件源码
 * @param scriptInfo 脚本元信息
 * @returns 初始化信息（sources 等）
 */
export async function loadLxInSandbox(
  pluginId: string,
  script: string,
  scriptInfo: LxScriptInfo,
): Promise<any> {
  if (_entries.has(pluginId)) {
    await destroySandbox(pluginId);
  }

  const result = await tauriInvoke('plugin_engine_load_lx', {
    pluginId,
    script,
    scriptInfoJson: JSON.stringify(scriptInfo || {}),
  });
  emitEngineLogs(result.logs);
  if (!result.ok) {
    _entries.delete(pluginId);
    throw new Error(result.error || 'LX 插件初始化失败');
  }
  _entries.set(pluginId, {
    pluginId,
    format: 'lx',
    ready: true,
    instance: result.metadata || null,
  });
  return result.metadata;
}

/**
 * 将方法参数转换为可 JSON 序列化的纯数据。
 *
 * 后端 QuickJS 通过 JSON 字符串传参，Vue reactive proxy、函数、
 * Symbol、循环引用等成员无法序列化。JSON 化失败时回退为 null，
 * 避免整个调用链因序列化崩溃。
 */
function toCloneableArgs(args: any[]): any[] {
  return args.map((arg) => {
    if (arg === null || arg === undefined) return arg;
    const type = typeof arg;
    if (type === 'string' || type === 'number' || type === 'boolean') return arg;
    if (type === 'function' || type === 'symbol') return null;

    try {
      return JSON.parse(JSON.stringify(arg));
    } catch {
      console.warn('[PluginSandbox] 参数无法序列化，已置空:', type);
      return null;
    }
  });
}

/**
 * 在后端引擎中调用插件方法
 *
 * @param pluginId 插件 ID
 * @param method 方法名（如 'search', 'getMediaSource', 'request'）
 * @param args 方法参数
 * @param timeout 超时时间（毫秒）
 * @returns 方法返回值
 */
export async function callSandboxMethod(
  pluginId: string,
  method: string,
  args: any[],
  timeout = 30000,
): Promise<any> {
  const sandboxId = resolveSandboxId(pluginId);
  const entry = _entries.get(sandboxId);
  if (!entry) {
    throw new Error(`沙箱不存在: ${pluginId}`);
  }
  if (!entry.ready) {
    throw new Error(`沙箱未就绪: ${pluginId}`);
  }

  // 用户变量按调用方传入的 pluginId 查询（与原 Worker 版一致，
  // 调用方可能传别名，也可能传实际 hash ID）
  const freshUserVars = _userVarsProvider?.(pluginId) || {};

  const result = await tauriInvoke('plugin_engine_call', {
    pluginId: sandboxId,
    method,
    argsJson: JSON.stringify(toCloneableArgs(args)),
    userVarsJson: JSON.stringify(freshUserVars),
    timeoutMs: timeout,
  });
  emitEngineLogs(result.logs);
  if (!result.ok) {
    throw new Error(result.error || '方法调用失败');
  }
  return result.data;
}

/**
 * 销毁指定插件的后端实例
 */
export async function destroySandbox(pluginId: string): Promise<void> {
  const sandboxId = resolveSandboxId(pluginId);
  const entry = _entries.get(sandboxId);
  if (!entry) return;

  for (const [alias, target] of [..._aliases]) {
    if (alias === pluginId || target === sandboxId) {
      _aliases.delete(alias);
    }
  }

  try {
    await tauriInvoke('plugin_engine_destroy', { pluginId: sandboxId });
  } catch { /* ignore */ }

  _entries.delete(sandboxId);
  log(`沙箱已销毁: ${sandboxId}`);
}

/**
 * 检查沙箱是否存在且就绪
 */
export function isSandboxReady(pluginId: string): boolean {
  const entry = _entries.get(resolveSandboxId(pluginId));
  return !!entry?.ready;
}

/**
 * 获取插件实例元数据
 */
export function getSandboxInstance(pluginId: string): any | null {
  const entry = _entries.get(resolveSandboxId(pluginId));
  return entry?.instance || null;
}
