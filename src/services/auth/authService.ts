/**
 * 账号认证服务
 *
 * 移植自 BakaMusic 的 src/renderer/services/auth.ts，
 * 使用原生 fetch 替代 axios，保留同样的接口契约。
 * 仅保留账号相关能力（登录/注册/资料/密码/头像），不包含云同步。
 */

export type AuthUser = {
  id: string;
  username: string;
  nickname: string;
  email: string;
  avatar?: string | null;
};

export type AuthPayload = {
  token: string;
  user: AuthUser;
};

export type AuthMode = 'login' | 'register';

export type ProfileStats = {
  favorite_count: number;
  playlist_count: number;
  starred_count?: number;
  history_count?: number;
  listening_count?: number;
  revision?: number;
  updated_at?: string | null;
};

const STORAGE_TOKEN_KEY = 'xy.auth.token';
const STORAGE_USER_KEY = 'xy.auth.user';
const STORAGE_BASE_URL_KEY = 'xy.auth.baseUrl';

/** 默认后端地址，沿用 BakaMusic；用户可在设置中覆盖 */
export const DEFAULT_AUTH_BASE_URL = 'https://music.moranblog.cn/api';

let currentBaseUrl: string =
  (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_BASE_URL_KEY)) ||
  DEFAULT_AUTH_BASE_URL;

export function getAuthBaseUrl(): string {
  return currentBaseUrl;
}

export function setAuthBaseUrl(baseUrl: string): void {
  const trimmed = (baseUrl || '').trim();
  currentBaseUrl = trimmed || DEFAULT_AUTH_BASE_URL;
  if (typeof localStorage !== 'undefined') {
    if (trimmed && trimmed !== DEFAULT_AUTH_BASE_URL) {
      localStorage.setItem(STORAGE_BASE_URL_KEY, currentBaseUrl);
    } else {
      localStorage.removeItem(STORAGE_BASE_URL_KEY);
    }
  }
}

/** 后端统一响应：code 1 成功，0 失败（HTTP 仍为 200） */
type ApiEnvelope<T> = {
  code: number;
  message: string;
  data: T;
};

export function getStoredAuth(): AuthPayload | null {
  if (typeof localStorage === 'undefined') return null;
  const token = localStorage.getItem(STORAGE_TOKEN_KEY);
  const userRaw = localStorage.getItem(STORAGE_USER_KEY);
  if (!token || !userRaw) return null;

  try {
    return { token, user: JSON.parse(userRaw) as AuthUser };
  } catch {
    clearAuth();
    return null;
  }
}

export function getAuthToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(STORAGE_TOKEN_KEY);
}

export function saveAuth(payload: AuthPayload): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_TOKEN_KEY, payload.token);
  localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(payload.user));
}

export function clearAuth(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_TOKEN_KEY);
  localStorage.removeItem(STORAGE_USER_KEY);
}

function isAuthPayload(value: unknown): value is AuthPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<AuthPayload>;
  return (
    typeof payload.token === 'string' &&
    !!payload.token &&
    !!payload.user &&
    typeof payload.user === 'object'
  );
}

async function requestAuthEnvelope<T>(
  path: string,
  body: Record<string, unknown>,
  init?: RequestInit,
): Promise<ApiEnvelope<T>> {
  const url = `${currentBaseUrl}${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...init,
  });

  if (!response.ok) {
    throw new Error(`请求失败（HTTP ${response.status}）`);
  }

  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!payload || Number(payload.code) !== 1) {
    throw new Error(payload?.message || '请求失败');
  }
  return payload;
}

async function requestAuth<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const payload = await requestAuthEnvelope<T>(path, body);
  return (payload.data ?? {}) as T;
}

function getAuthErrorMessage(error: unknown, fallback = '请求失败'): string {
  if (!error) return fallback;
  if (typeof error === 'string' && error.trim()) return error;

  const anyError = error as {
    message?: string;
    response?: { status?: number };
  };

  if (typeof anyError.message === 'string' && anyError.message.trim()) {
    if (anyError.message.includes('Failed to fetch')) {
      return '网络异常，请检查服务器地址或网络连接';
    }
    if (anyError.message.includes('timeout')) return '请求超时，请稍后重试';
    return anyError.message;
  }
  return fallback;
}

export async function login(username: string, password: string): Promise<AuthPayload> {
  try {
    const result = await requestAuth<AuthPayload>('/login', { username, password });
    if (!isAuthPayload(result)) throw new Error('登录响应无效');
    saveAuth(result);
    return result;
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '登录失败'));
  }
}

export async function register(
  username: string,
  password: string,
  email: string,
  code: string,
): Promise<AuthPayload> {
  try {
    const result = await requestAuth<AuthPayload>('/register', {
      username,
      password,
      email,
      code,
    });
    if (!isAuthPayload(result)) throw new Error('注册响应无效');
    saveAuth(result);
    return result;
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '注册失败'));
  }
}

export async function sendEmailCode(email: string): Promise<{ success: true; message: string }> {
  try {
    const payload = await requestAuthEnvelope<Record<string, unknown>>('/send_code', { email });
    return { success: true, message: payload.message || '验证码已发送到邮箱' };
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '验证码发送失败'));
  }
}

export async function getProfile(): Promise<{
  user: AuthUser;
  stats: ProfileStats;
} | null> {
  const token = getAuthToken();
  if (!token) return null;

  try {
    return await requestAuth<{ user: AuthUser; stats: ProfileStats }>('/profile', { token });
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '获取资料失败'));
  }
}

export async function updateProfile(
  nickname: string,
  avatar?: string,
): Promise<{ user: AuthUser }> {
  const token = getAuthToken();
  if (!token) throw new Error('未登录');

  try {
    const result = await requestAuth<{ user: AuthUser }>('/update_profile', {
      token,
      nickname,
      avatar: avatar || '',
    });
    if (result?.user) saveAuth({ token, user: result.user });
    return result;
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '保存资料失败'));
  }
}

export async function uploadAvatar(
  file: Blob,
  fileName = 'avatar.jpg',
): Promise<{ user: AuthUser; avatar?: string }> {
  const token = getAuthToken();
  if (!token) throw new Error('未登录');

  const form = new FormData();
  form.append('token', token);
  form.append('avatar', file, fileName);

  try {
    const response = await fetch(`${currentBaseUrl}/upload_avatar`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) throw new Error(`上传失败（HTTP ${response.status}）`);
    const payload = (await response.json()) as ApiEnvelope<{ user: AuthUser; avatar?: string }>;
    if (!payload || Number(payload.code) !== 1) {
      throw new Error(payload?.message || '头像上传失败');
    }
    if (payload.data?.user) saveAuth({ token, user: payload.data.user });
    return payload.data;
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '头像上传失败'));
  }
}

export async function changePassword(
  oldPassword: string,
  newPassword: string,
  confirmPassword: string,
): Promise<{ message: string }> {
  const token = getAuthToken();
  if (!token) throw new Error('未登录');

  try {
    return await requestAuth<{ message: string }>('/change_password', {
      token,
      old_password: oldPassword,
      new_password: newPassword,
      confirm_password: confirmPassword,
    });
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '修改密码失败'));
  }
}

export async function logout(): Promise<void> {
  const token = getAuthToken();
  clearAuth();
  if (!token) return;

  try {
    await fetch(`${currentBaseUrl}/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch {
    // 退出登录失败不阻塞前端清理
  }
}

export async function refreshSession(): Promise<AuthPayload | null> {
  const token = getAuthToken();
  if (!token) return null;

  try {
    const result = await requestAuth<AuthPayload>('/me', { token });
    if (!isAuthPayload(result)) {
      clearAuth();
      return null;
    }
    saveAuth(result);
    return result;
  } catch {
    clearAuth();
    return null;
  }
}
