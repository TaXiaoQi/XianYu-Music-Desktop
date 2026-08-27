import { authApi } from '../tauri/authApi';
import {
  DEFAULT_AUTH_BASE_URL,
  type AuthPayload,
  type AuthUser,
} from './authTypes';

/**
 * 账号认证服务 · 会话/凭证（核心状态层）。
 * 持有 baseUrl、apiSecret、token、user 的内存缓存与持久化（Rust keyring）管理，
 * 以及登录态失效回调。被 authHttp（签名请求）依赖，authAccount / authProfile 复用。
 */

// ─── localStorage 兼容键（仅用于迁移） ──────────────────
const LEGACY_STORAGE_TOKEN_KEY = 'xy.auth.token';
const LEGACY_STORAGE_USER_KEY = 'xy.auth.user';
const LEGACY_STORAGE_BASE_URL_KEY = 'xy.auth.baseUrl';
const LEGACY_STORAGE_API_SECRET_KEY = 'xy.auth.apiSecret';

// ─── 内存缓存（同步读取，由 initAuthFromKeyring 填充） ────
let cachedToken: string | null = null;
let cachedUser: AuthUser | null = null;
let cachedBaseUrl: string = DEFAULT_AUTH_BASE_URL;
// 空值表示使用 Rust 侧默认密钥（默认密钥不暴露给前端）
let cachedApiSecret: string | null = null;
let keyringInitialized = false;

// ═══════════════════════════════════════════════════════
//  Base URL 管理
// ═══════════════════════════════════════════════════════

export function getAuthBaseUrl(): string {
  return cachedBaseUrl;
}

export async function setAuthBaseUrl(baseUrl: string): Promise<void> {
  const trimmed = (baseUrl || '').trim();
  cachedBaseUrl = trimmed || DEFAULT_AUTH_BASE_URL;
  // 持久化到 Rust（文件），确保后续签名请求读取到最新配置
  await authApi.setAuthBaseUrl(cachedBaseUrl);
  // 清理旧 localStorage
  if (typeof localStorage !== 'undefined') {
    if (trimmed && trimmed !== DEFAULT_AUTH_BASE_URL) {
      localStorage.setItem(LEGACY_STORAGE_BASE_URL_KEY, cachedBaseUrl);
    } else {
      localStorage.removeItem(LEGACY_STORAGE_BASE_URL_KEY);
    }
  }
}

export function getAuthApiSecret(): string | null {
  return cachedApiSecret;
}

export async function setAuthApiSecret(apiSecret: string): Promise<void> {
  const trimmed = (apiSecret || '').trim();
  cachedApiSecret = trimmed || null;
  await authApi.setAuthApiSecret(trimmed);
  if (typeof localStorage !== 'undefined') {
    if (trimmed) {
      localStorage.setItem(LEGACY_STORAGE_API_SECRET_KEY, trimmed);
    } else {
      localStorage.removeItem(LEGACY_STORAGE_API_SECRET_KEY);
    }
  }
}

// ═══════════════════════════════════════════════════════
//  凭证管理（keyring + 内存缓存）
// ═══════════════════════════════════════════════════════

/**
 * 从 Rust keyring 加载认证凭证到内存缓存。
 * 如果 keyring 为空但 localStorage 有旧数据，自动迁移到 keyring。
 * 应在应用启动时调用一次（authStore.restoreSession 内）。
 */
export async function initAuthFromKeyring(): Promise<void> {
  if (keyringInitialized) return;
  keyringInitialized = true;

  try {
    const result = await authApi.getAuthCredentials();
    if (result && result.token) {
      cachedToken = result.token;
      cachedUser = result.user as AuthUser;
    }
  } catch {
    /* Rust 命令不可用（非 Tauri 环境），静默 */
  }

  // 加载 base_url
  try {
    cachedBaseUrl = await authApi.getAuthBaseUrl();
  } catch {
    // 回退到 localStorage
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(LEGACY_STORAGE_BASE_URL_KEY) || DEFAULT_AUTH_BASE_URL;
      // 迁移：将旧版 back.xymusic.cc 迁移到 api.xianyumusic.cn 并升级为 https
      cachedBaseUrl = saved
        .replace('http://back.xymusic.cc', 'https://api.xianyumusic.cn')
        .replace('https://back.xymusic.cc', 'https://api.xianyumusic.cn');
    }
  }

  // 加载 API 签名密钥（Rust 返回空串表示使用默认密钥）
  try {
    const secret = await authApi.getAuthApiSecret();
    cachedApiSecret = secret || null;
  } catch {
    if (typeof localStorage !== 'undefined') {
      cachedApiSecret = localStorage.getItem(LEGACY_STORAGE_API_SECRET_KEY) || null;
    }
  }

  // 迁移：keyring 为空但 localStorage 有旧数据
  if (!cachedToken && typeof localStorage !== 'undefined') {
    const oldToken = localStorage.getItem(LEGACY_STORAGE_TOKEN_KEY);
    const oldUserRaw = localStorage.getItem(LEGACY_STORAGE_USER_KEY);
    if (oldToken && oldUserRaw) {
      try {
        const oldUser = JSON.parse(oldUserRaw) as AuthUser;
        cachedToken = oldToken;
        cachedUser = oldUser;
        // 迁移到 keyring（fire-and-forget）
        void authApi.saveAuthCredentials(oldToken, oldUser).catch(() => {
          /* 静默 */
        });
        // 清理旧 localStorage
        localStorage.removeItem(LEGACY_STORAGE_TOKEN_KEY);
        localStorage.removeItem(LEGACY_STORAGE_USER_KEY);
      } catch {
        /* 旧数据损坏，忽略 */
      }
    }
  }
}

export function getStoredAuth(): AuthPayload | null {
  if (!cachedToken || !cachedUser) return null;
  return { token: cachedToken, user: cachedUser };
}

export function getAuthToken(): string | null {
  return cachedToken;
}

export function getStoredUser(): AuthUser | null {
  return cachedUser;
}

export function saveAuth(payload: AuthPayload): void {
  cachedToken = payload.token;
  cachedUser = payload.user;
  // 持久化到 keyring（fire-and-forget）
  void authApi.saveAuthCredentials(payload.token, payload.user).catch(() => {
    /* 静默失败 */
  });
}

export function clearAuth(): void {
  cachedToken = null;
  cachedUser = null;
  // 清除 keyring（fire-and-forget）
  void authApi.clearAuthCredentials().catch(() => {
    /* 静默失败 */
  });
}

export function isAuthPayload(value: unknown): value is AuthPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<AuthPayload>;
  return (
    typeof payload.token === 'string' &&
    !!payload.token &&
    !!payload.user &&
    typeof payload.user === 'object'
  );
}

// ═══════════════════════════════════════════════════════
//  登录态失效回调
// ═══════════════════════════════════════════════════════

/**
 * 登录态失效（token 被服务端判定为无效/过期/属主不符）时触发，
 * 由 UI 层（authStore）注册回调，用于自动登出并回到登录页。
 * 避免存量用户在 keyring 残留旧 token 时反复用失效 token 刷屏报错。
 */
let onAccountExpiredHandler: (() => void) | null = null;

export function onAccountExpired(handler: () => void): void {
  onAccountExpiredHandler = handler;
}

export function triggerAccountExpired(): void {
  onAccountExpiredHandler?.();
}

// ═══════════════════════════════════════════════════════
//  会话生命周期
// ═══════════════════════════════════════════════════════

/**
 * 退出登录。XY Music API 文档未提供服务端登出接口，
 * token 无过期时间，因此仅清理本地凭证。
 */
export async function logout(): Promise<void> {
  clearAuth();
}

/**
 * 恢复登录会话。token 无过期时间，直接返回内存缓存的凭证；
 * 若无凭证返回 null。
 */
export async function refreshSession(): Promise<AuthPayload | null> {
  const stored = getStoredAuth();
  if (!stored || !isAuthPayload(stored)) {
    clearAuth();
    return null;
  }
  return stored;
}