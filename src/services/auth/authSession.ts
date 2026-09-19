import { authApi } from '../tauri/authApi';
import {
  DEFAULT_AUTH_BASE_URL,
  type AuthPayload,
  type AuthUser,
} from './authTypes';


const LEGACY_STORAGE_TOKEN_KEY = 'xy.auth.token';
const LEGACY_STORAGE_USER_KEY = 'xy.auth.user';
const LEGACY_STORAGE_BASE_URL_KEY = 'xy.auth.baseUrl';
const LEGACY_STORAGE_API_SECRET_KEY = 'xy.auth.apiSecret';

let cachedToken: string | null = null;
let cachedUser: AuthUser | null = null;
let cachedBaseUrl: string = DEFAULT_AUTH_BASE_URL;
let cachedApiSecret: string | null = null;
let keyringInitialized = false;


export function getAuthBaseUrl(): string {
  return cachedBaseUrl;
}

export async function setAuthBaseUrl(baseUrl: string): Promise<void> {
  const trimmed = (baseUrl || '').trim();
  cachedBaseUrl = trimmed || DEFAULT_AUTH_BASE_URL;
  await authApi.setAuthBaseUrl(cachedBaseUrl);
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

  try {
    cachedBaseUrl = await authApi.getAuthBaseUrl();
  } catch {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(LEGACY_STORAGE_BASE_URL_KEY) || DEFAULT_AUTH_BASE_URL;
      cachedBaseUrl = saved
        .replace('http://back.xymusic.cc', 'https://api.xianyumusic.cn')
        .replace('https://back.xymusic.cc', 'https://api.xianyumusic.cn');
    }
  }

  try {
    const secret = await authApi.getAuthApiSecret();
    cachedApiSecret = secret || null;
  } catch {
    if (typeof localStorage !== 'undefined') {
      cachedApiSecret = localStorage.getItem(LEGACY_STORAGE_API_SECRET_KEY) || null;
    }
  }

  if (!cachedToken && typeof localStorage !== 'undefined') {
    const oldToken = localStorage.getItem(LEGACY_STORAGE_TOKEN_KEY);
    const oldUserRaw = localStorage.getItem(LEGACY_STORAGE_USER_KEY);
    if (oldToken && oldUserRaw) {
      try {
        const oldUser = JSON.parse(oldUserRaw) as AuthUser;
        cachedToken = oldToken;
        cachedUser = oldUser;
        void authApi.saveAuthCredentials(oldToken, oldUser).catch(() => {
          /* 静默 */
        });
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
  void authApi.saveAuthCredentials(payload.token, payload.user).catch(() => {
    /* 静默失败 */
  });
}

export function clearAuth(): void {
  cachedToken = null;
  cachedUser = null;
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


let onAccountExpiredHandler: (() => void) | null = null;

export function onAccountExpired(handler: () => void): void {
  onAccountExpiredHandler = handler;
}

export function triggerAccountExpired(): void {
  onAccountExpiredHandler?.();
}


export async function logout(): Promise<void> {
  clearAuth();
}

export async function refreshSession(): Promise<AuthPayload | null> {
  const stored = getStoredAuth();
  if (!stored || !isAuthPayload(stored)) {
    clearAuth();
    return null;
  }
  return stored;
}