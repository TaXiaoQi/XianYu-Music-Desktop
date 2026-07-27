/**
 * 账号认证服务
 *
 * 适配「弦予音乐 APP」邮箱注册登录 API（见 邮箱注册登录API调用文档.md）。
 * - 基地址：https://xymusic.zh2026.cn/api
 * - 端点风格：POST /api/?action=<接口名>
 * - 所有接口需 MD5 签名：sign = md5(timestamp + nonce + body + api_secret)
 * - 统一响应：{ code: 200, msg, data }，code === 200 视为成功
 *
 * 仅保留账号相关能力（登录/注册/验证码/找回密码/修改密码/资料/头像）。
 */

import { md5 } from './md5';
import { crossOriginFetch } from './httpClient';

export type AuthUser = {
  id: string;
  username: string;
  nickname: string;
  email: string;
  avatar?: string | null;
  /** 弦予号（12 位数字），用于修改密码等接口 */
  ciyuanxi_id?: string;
  /** 角色：空字符串=普通用户，admin/super_admin=管理员 */
  role?: string;
};

export type AuthPayload = {
  token: string;
  user: AuthUser;
};

/** 登录/注册/找回密码三种模式（找回密码为新增） */
export type AuthMode = 'login' | 'register' | 'forgot';

/** 验证码场景类型，必须与后续接口匹配 */
export type VerifyCodeType = 'register' | 'login' | 'reset_password';

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

/** 默认后端地址：弦予音乐 API */
export const DEFAULT_AUTH_BASE_URL = 'https://xymusic.zh2026.cn/api';

/** API 签名密钥（来自文档，编译进客户端） */
const API_SECRET = 'bf027fedb4d1b4f969c10495f12f17042bf0de02de128200';

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

/** 后端统一响应：code 200 成功，其他为失败（HTTP 状态码同步设置） */
type ApiEnvelope<T> = {
  code: number;
  msg: string;
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

function getStoredUser(): AuthUser | null {
  if (typeof localStorage === 'undefined') return null;
  const userRaw = localStorage.getItem(STORAGE_USER_KEY);
  if (!userRaw) return null;
  try {
    return JSON.parse(userRaw) as AuthUser;
  } catch {
    return null;
  }
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

/** 生成随机 nonce（6-32 位十六进制字符串） */
function generateNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  }
  return (Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 32);
}

/** 计算签名并返回带签名的请求头 */
function buildSignedHeaders(body: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = generateNonce();
  const sign = md5(timestamp + nonce + body + API_SECRET);
  return {
    'Content-Type': 'application/json',
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Sign': sign,
  };
}

/** 发起带签名的 POST 请求，返回完整响应信封 */
async function requestEnvelope<T>(
  action: string,
  body: Record<string, unknown>,
): Promise<ApiEnvelope<T>> {
  const raw = JSON.stringify(body);
  const headers = buildSignedHeaders(raw);
  const url = `${currentBaseUrl}/?action=${action}`;
  const response = await crossOriginFetch(url, { method: 'POST', headers, body: raw });

  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    // 响应非 JSON（如 HTML 错误页）
  }

  if (!payload) {
    throw new Error(`请求失败（HTTP ${response.status}）`);
  }
  return payload;
}

/** 调用接口并校验 code === 200，返回 data */
async function requestAction<T>(
  action: string,
  body: Record<string, unknown>,
): Promise<T> {
  const payload = await requestEnvelope<T>(action, body);
  if (Number(payload.code) !== 200) {
    throw new Error(payload.msg || `请求失败（code ${payload.code}）`);
  }
  return payload.data ?? ({} as T);
}

/** 将登录接口返回的 data 映射为前端统一的 AuthUser */
function mapUser(data: Record<string, unknown>): AuthUser {
  const raw = data as Partial<{
    user_id: string | number;
    id: string | number;
    username: string;
    nickname: string;
    email: string;
    avatar_url: string | null;
    avatar: string | null;
    ciyuanxi_id: string | number;
    role: string;
  }>;
  return {
    id: String(raw.user_id ?? raw.id ?? ''),
    username: raw.username ?? '',
    nickname: raw.nickname || raw.username || '',
    email: raw.email ?? '',
    avatar: raw.avatar_url ?? raw.avatar ?? '',
    ciyuanxi_id: raw.ciyuanxi_id != null ? String(raw.ciyuanxi_id) : undefined,
    role: raw.role ?? '',
  };
}

function getAuthErrorMessage(error: unknown, fallback = '请求失败'): string {
  if (!error) return fallback;
  if (typeof error === 'string' && error.trim()) return error;

  const anyError = error as { message?: string };

  if (typeof anyError.message === 'string' && anyError.message.trim()) {
    if (anyError.message.includes('Failed to fetch')) {
      return '网络异常，请检查服务器地址或网络连接';
    }
    if (anyError.message.includes('timeout')) return '请求超时，请稍后重试';
    return anyError.message;
  }
  return fallback;
}

/**
 * 密码登录（支持用户名 / 邮箱 / 弦予号三种凭据，同一个输入框即可）
 * POST /api/?action=user_login
 */
export async function login(username: string, password: string): Promise<AuthPayload> {
  try {
    const data = await requestAction<Record<string, unknown>>('user_login', {
      username,
      password,
    });
    if (!data.token) throw new Error('登录响应无效');
    const payload: AuthPayload = { token: String(data.token), user: mapUser(data) };
    saveAuth(payload);
    return payload;
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '登录失败'));
  }
}

/**
 * 验证码登录（免密，仅凭邮箱 + 验证码）
 * POST /api/?action=login_by_code
 */
export async function loginByCode(email: string, verifyCode: string): Promise<AuthPayload> {
  try {
    const data = await requestAction<Record<string, unknown>>('login_by_code', {
      email,
      verify_code: verifyCode,
    });
    if (!data.token) throw new Error('登录响应无效');
    const payload: AuthPayload = { token: String(data.token), user: mapUser(data) };
    saveAuth(payload);
    return payload;
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '验证码登录失败'));
  }
}

/**
 * 用户注册。注册接口不返回 token，因此注册成功后自动调用登录以获取会话。
 * POST /api/?action=register
 */
export async function register(
  username: string,
  password: string,
  email: string,
  code: string,
): Promise<AuthPayload> {
  try {
    await requestAction('register', {
      username,
      password,
      email,
      verify_code: code,
    });
    try {
      return await login(username, password);
    } catch {
      throw new Error('注册成功，但自动登录失败，请手动登录');
    }
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '注册失败'));
  }
}

/**
 * 发送邮箱验证码（注册 / 登录 / 找回密码三种场景，通过 type 区分）
 * POST /api/?action=send_verify_code
 */
export async function sendEmailCode(
  email: string,
  type: VerifyCodeType = 'register',
): Promise<{ success: true; message: string }> {
  try {
    const payload = await requestEnvelope<Record<string, unknown>>('send_verify_code', {
      email,
      type,
    });
    if (Number(payload.code) !== 200) {
      throw new Error(payload.msg || '验证码发送失败');
    }
    return { success: true, message: payload.msg || '验证码已发送到邮箱' };
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '验证码发送失败'));
  }
}

/**
 * 找回密码（重置密码）
 * POST /api/?action=reset_password
 */
export async function resetPassword(
  email: string,
  verifyCode: string,
  newPassword: string,
): Promise<{ message: string }> {
  try {
    const payload = await requestEnvelope<Record<string, unknown>>('reset_password', {
      email,
      verify_code: verifyCode,
      new_password: newPassword,
    });
    if (Number(payload.code) !== 200) {
      throw new Error(payload.msg || '重置密码失败');
    }
    return { message: payload.msg || '密码修改成功' };
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '重置密码失败'));
  }
}

/**
 * 修改密码（需登录，使用弦予号 + 旧密码验证）
 * POST /api/?action=change_password
 */
export async function changePassword(
  oldPassword: string,
  newPassword: string,
): Promise<{ message: string }> {
  const user = getStoredUser();
  const ciyuanxiId = user?.ciyuanxi_id;
  if (!ciyuanxiId) throw new Error('未获取到弦予号，无法修改密码，请重新登录');

  try {
    const payload = await requestEnvelope<Record<string, unknown>>('change_password', {
      ciyuanxi_id: ciyuanxiId,
      old_password: oldPassword,
      new_password: newPassword,
    });
    if (Number(payload.code) !== 200) {
      throw new Error(payload.msg || '修改密码失败');
    }
    return { message: payload.msg || '密码修改成功' };
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '修改密码失败'));
  }
}

/**
 * 获取个人资料与统计。
 * 当前 XY Music API 文档未提供独立的资料接口，登录响应已含用户信息，
 * 此处返回 null（统计展示为占位符），后续可接入正式接口。
 */
export async function getProfile(): Promise<{
  user: AuthUser;
  stats: ProfileStats;
} | null> {
  return null;
}

/**
 * 更新个人资料（昵称）。当前 API 未提供独立接口，
 * 失败时回退为本地更新，保证界面可用。
 */
export async function updateProfile(
  nickname: string,
  avatar?: string,
): Promise<{ user: AuthUser }> {
  const token = getAuthToken();
  const current = getStoredUser();
  if (!token || !current) throw new Error('未登录');

  try {
    const data = await requestAction<{ user?: AuthUser; avatar?: string }>('update_profile', {
      token,
      nickname,
      avatar: avatar || '',
    });
    const nextUser: AuthUser = data.user ?? {
      ...current,
      nickname: nickname || current.nickname,
      avatar: avatar ?? current.avatar,
    };
    saveAuth({ token, user: nextUser });
    return { user: nextUser };
  } catch {
    // 接口暂不可用，回退为本地更新
    const nextUser: AuthUser = {
      ...current,
      nickname: nickname || current.nickname,
      avatar: avatar ?? current.avatar,
    };
    saveAuth({ token, user: nextUser });
    return { user: nextUser };
  }
}

/**
 * 上传头像。该接口为白名单接口（无需签名），使用 FormData 提交。
 * POST /api/?action=upload_avatar
 */
export async function uploadAvatar(
  file: Blob,
  fileName = 'avatar.jpg',
): Promise<{ user: AuthUser; avatar?: string }> {
  const token = getAuthToken();
  const current = getStoredUser();
  if (!token || !current) throw new Error('未登录');

  const form = new FormData();
  form.append('token', token);
  form.append('avatar', file, fileName);

  try {
    const response = await crossOriginFetch(`${currentBaseUrl}/?action=upload_avatar`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) throw new Error(`上传失败（HTTP ${response.status}）`);
    const payload = (await response.json()) as ApiEnvelope<{ user?: AuthUser; avatar?: string }>;
    if (!payload || Number(payload.code) !== 200) {
      throw new Error(payload?.msg || '头像上传失败');
    }
    const data = payload.data ?? {};
    const nextUser: AuthUser = data.user ?? {
      ...current,
      avatar: data.avatar ?? current.avatar,
    };
    saveAuth({ token, user: nextUser });
    return { user: nextUser, avatar: data.avatar };
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '头像上传失败'));
  }
}

/**
 * 退出登录。XY Music API 文档未提供服务端登出接口，
 * token 无过期时间，因此仅清理本地凭证。
 */
export async function logout(): Promise<void> {
  clearAuth();
}

/**
 * 恢复登录会话。token 无过期时间，直接返回本地存储的凭证；
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
