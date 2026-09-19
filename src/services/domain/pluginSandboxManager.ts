
import { tauriInvoke } from '../tauri/invoke';
import type { LxScriptInfo } from './pluginSandboxTypes';
import type { PluginEngineLogContract } from '../tauri/contracts';
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

export function setUserVarsProvider(provider: ((pluginId: string) => Record<string, string>) | null) {
  _userVarsProvider = provider;
}

// ==================== 日志回放 ====================

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
    console.warn('[PluginSandbox] 插件存储迁移失败:', e);
  }
}

void migrateLegacyStoreOnce();

// ==================== 公开 API ====================

export async function loadMusicFreeInSandbox(
  pluginId: string,
  script: string,
  userVariables: Record<string, string>,
): Promise<any> {
  if (_entries.has(pluginId)) {
    await destroySandbox(pluginId);
  }

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

export function linkSandboxAlias(aliasId: string, targetId: string): void {
  if (!aliasId || !targetId || aliasId === targetId) return;
  if (!_entries.has(targetId)) return;
  _aliases.set(aliasId, targetId);
  log(`沙箱别名已注册: ${aliasId.substring(0, 12)}... -> ${targetId.substring(0, 12)}...`);
}

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

// ==================== 插件鉴权失效熔断 ====================
const _authBannedUntil = new Map<string, number>();
const _authFailStreak = new Map<string, number>();
const AUTH_BAN_TTL_MS = 5 * 60 * 1000;
const AUTH_BAN_THRESHOLD = 2;

function isAuthError(msg: string): boolean {
  return /API密钥|API\s*key|api[_\s-]?secret|401/i.test(msg);
}

export function isPluginAuthBanned(pluginId: string): boolean {
  const until = _authBannedUntil.get(pluginId);
  if (until === undefined) return false;
  if (Date.now() > until) {
    _authBannedUntil.delete(pluginId);
    _authFailStreak.set(pluginId, 0);
    return false;
  }
  return true;
}

function markAuthFailure(pluginId: string, msg: string): void {
  const streak = (_authFailStreak.get(pluginId) ?? 0) + 1;
  _authFailStreak.set(pluginId, streak);
  if (streak >= AUTH_BAN_THRESHOLD) {
    _authBannedUntil.set(pluginId, Date.now() + AUTH_BAN_TTL_MS);
    console.warn(`[plugin] ${pluginId} 鉴权连续失败 ${streak} 次，熔断 5 分钟: ${msg}`);
  }
}

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
  if (method === 'request' && isPluginAuthBanned(sandboxId)) {
    throw new Error(`音源鉴权失效已临时熔断（5 分钟后自动重试）: ${sandboxId}`);
  }

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
    const err = result.error || '方法调用失败';
    if (method === 'request' && isAuthError(err)) {
      markAuthFailure(sandboxId, err);
    }
    throw new Error(err);
  }
  if (method === 'request') _authFailStreak.set(sandboxId, 0);
  return result.data;
}

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

export function isSandboxReady(pluginId: string): boolean {
  const entry = _entries.get(resolveSandboxId(pluginId));
  return !!entry?.ready;
}

export function getSandboxInstance(pluginId: string): any | null {
  const entry = _entries.get(resolveSandboxId(pluginId));
  return entry?.instance || null;
}
