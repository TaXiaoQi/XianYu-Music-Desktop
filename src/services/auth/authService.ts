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

/** 读取响应体的超时时间（毫秒），防止 response.json()/text() 在 Tauri 中挂起 */
const RESPONSE_BODY_TIMEOUT_MS = 15_000;

/** 带超时的响应体读取：先用 text() 读取再手动 JSON.parse，避免 Tauri 的 response.json() 挂起 */
async function readResponseBody(response: Response, action: string): Promise<string> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`响应体读取超时（${RESPONSE_BODY_TIMEOUT_MS / 1000}s），action=${action}`));
    }, RESPONSE_BODY_TIMEOUT_MS);
  });

  const text = await Promise.race([
    response.text(),
    timeoutPromise,
  ]);
  return text;
}

/** fetch 本身的超时时间（毫秒），比 signedRequest 的 30s 短，确保 fetch 被正确中止 */
const FETCH_TIMEOUT_MS = 25_000;

/** 发起带签名的 POST 请求，返回完整响应信封 */
async function requestEnvelope<T>(
  action: string,
  body: Record<string, unknown>,
  fetchTimeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<ApiEnvelope<T>> {
  const raw = JSON.stringify(body);
  const headers = buildSignedHeaders(raw);
  const url = `${currentBaseUrl}/?action=${action}`;
  const bodySize = raw.length;
  console.log(`[signedRequest] → POST ${url} (action=${action}, bodyLen=${bodySize})`);

  const startTime = Date.now();
  let response: Response;
  try {
    // 使用 AbortController 给 fetch 本身加超时，防止 Tauri HTTP 插件的连接挂起
    // 导致后续请求受连接池污染影响（如 404、连接复用错误等）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), fetchTimeoutMs);
    try {
      response = await crossOriginFetch(url, { method: 'POST', headers, body: raw, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (fetchError) {
    const elapsed = Date.now() - startTime;
    // Tauri HTTP 插件的 abort 不一定抛 DOMException，可能抛普通 Error 且 message 为 "Request canceled"
    const fetchMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    const isAbort = (fetchError instanceof DOMException && fetchError.name === 'AbortError')
      || /cancel|abort/i.test(fetchMsg);
    const errMsg = isAbort
      ? `请求超时（${fetchTimeoutMs / 1000}s），action=${action}`
      : `网络请求失败（action=${action}, ${elapsed}ms）: ${fetchMsg}`;
    console.error(`[signedRequest] ✗ fetch 异常 action=${action}, elapsed=${elapsed}ms, isAbort=${isAbort}, error=`, fetchError);
    throw new Error(errMsg, { cause: fetchError });
  }

  const fetchElapsed = Date.now() - startTime;
  console.log(`[signedRequest] ← HTTP ${response.status} (action=${action}, fetchElapsed=${fetchElapsed}ms)`);

  // 用 text() + JSON.parse 替代 response.json()，避免 Tauri HTTP 插件的流式解析挂起
  let payload: ApiEnvelope<T> | null = null;
  let rawText = '';
  try {
    rawText = await readResponseBody(response, action);
    payload = JSON.parse(rawText) as ApiEnvelope<T>;
  } catch (parseError) {
    const totalElapsed = Date.now() - startTime;
    const errStr = parseError instanceof Error ? parseError.message : String(parseError);
    console.error(`[signedRequest] ✗ 响应体读取/解析失败, action=${action}, status=${response.status}, elapsed=${totalElapsed}ms, error=${errStr}`);
    console.error(`[signedRequest] 响应体前500字符:`, rawText.substring(0, 500));
    // 检测宝塔 WAF / nginx 错误页面（HTTP 200 但返回 HTML）
    if (rawText.includes('宝塔WAF') || rawText.includes('缓冲区溢出')) {
      throw new Error(`服务器WAF拦截（action=${action}, HTTP ${response.status}）: 请求体过大，触发Nginx缓冲区溢出`, { cause: parseError });
    }
    // 对非 200 HTTP 状态码返回更明确的错误，包含 HTTP 状态码信息
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}（action=${action}）: 服务器返回非 JSON 响应`, { cause: parseError });
    }
    throw new Error(`响应解析失败（action=${action}, HTTP ${response.status}）: ${errStr}`, { cause: parseError });
  }

  const totalElapsed = Date.now() - startTime;
  console.log(`[signedRequest] code=${payload.code}, msg="${payload.msg ?? ''}", totalElapsed=${totalElapsed}ms, action=${action}`);
  if (payload.code !== 200) {
    console.warn(`[signedRequest] ⚠ 接口返回非200: action=${action}, code=${payload.code}, msg="${payload.msg}"`);
  }
  return payload;
}

/** 调用接口并校验 code === 200，返回 data */
async function requestAction<T>(
  action: string,
  body: Record<string, unknown>,
  fetchTimeoutMs?: number,
): Promise<T> {
  const payload = await requestEnvelope<T>(action, body, fetchTimeoutMs);
  if (Number(payload.code) !== 200) {
    throw new Error(payload.msg || `请求失败（code ${payload.code}）`);
  }
  return payload.data ?? ({} as T);
}

/** signedRequest 的可选参数 */
export type SignedRequestOptions = {
  /** fetch 超时时间（毫秒），默认 25s。大文件上传等场景可设更长 */
  fetchTimeoutMs?: number;
  /** signedRequest 外层 Promise.race 超时时间（毫秒），默认 30s */
  timeoutMs?: number;
};

/**
 * 导出带签名的 API 请求方法，供歌单同步等模块复用。
 * 与 authService 内部使用相同的签名算法和基地址。
 * 内置超时保护，避免网络挂起导致同步卡死。
 * 可通过 options 自定义超时时间（如大文件分块上传需更长超时）。
 */
export async function signedRequest<T>(
  action: string,
  body: Record<string, unknown>,
  options?: SignedRequestOptions,
): Promise<T> {
  const TIMEOUT_MS = options?.timeoutMs ?? 30_000; // 默认 30 秒超时
  const fetchTimeoutMs = options?.fetchTimeoutMs; // 默认使用 requestEnvelope 内部的 FETCH_TIMEOUT_MS

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`请求超时（${TIMEOUT_MS / 1000}s），action=${action}`));
    }, TIMEOUT_MS);
  });

  return Promise.race([
    requestAction<T>(action, body, fetchTimeoutMs),
    timeoutPromise,
  ]);
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
    throw new Error(getAuthErrorMessage(error, '登录失败'), { cause: error });
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
    throw new Error(getAuthErrorMessage(error, '验证码登录失败'), { cause: error });
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
    throw new Error(getAuthErrorMessage(error, '注册失败'), { cause: error });
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
    throw new Error(getAuthErrorMessage(error, '验证码发送失败'), { cause: error });
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
    throw new Error(getAuthErrorMessage(error, '重置密码失败'), { cause: error });
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
    throw new Error(getAuthErrorMessage(error, '修改密码失败'), { cause: error });
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
 * 使用 Canvas 压缩图片为 base64 data URL。
 * Tauri HTTP 插件不支持 FormData 文件上传，因此改为 base64 JSON 方式。
 */
function compressImageToDataUrl(
  file: Blob,
  maxWidth = 256,
  quality = 0.75,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 上下文不可用'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

/**
 * 上传头像。使用 Canvas 压缩后以 base64 JSON 方式提交（兼容 Tauri HTTP 插件）。
 * POST /api/?action=upload_avatar
 */
export async function uploadAvatar(
  file: Blob,
): Promise<{ user: AuthUser; avatar?: string }> {
  const token = getAuthToken();
  const current = getStoredUser();
  if (!token || !current) throw new Error('未登录');

  console.log('[uploadAvatar] 开始压缩图片, size=', file.size, 'type=', file.type);
  // 前端压缩：256px 宽度，JPEG 质量 75%
  const avatarData = await compressImageToDataUrl(file, 256, 0.75);
  console.log('[uploadAvatar] 压缩完成, base64 长度=', avatarData.length);

  try {
    // 头像上传首次请求可能触发 ALTER TABLE（varchar→LONGTEXT），需要更长超时
    const TIMEOUT_MS = 60_000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`请求超时（${TIMEOUT_MS / 1000}s），action=upload_avatar`));
      }, TIMEOUT_MS);
    });

    const data = await Promise.race([
      requestAction<{ avatar_url?: string; avatar?: string }>(
        'upload_avatar',
        {
          ciyuanxi_id: current.ciyuanxi_id ?? current.id,
          avatar_data: avatarData,
        },
        55_000, // fetch 超时 55s，留 5s 给外层
      ),
      timeoutPromise,
    ]);

    const avatarUrl = data.avatar ?? data.avatar_url ?? '';
    const nextUser: AuthUser = {
      ...current,
      avatar: avatarUrl || current.avatar,
    };
    saveAuth({ token, user: nextUser });
    console.log('[uploadAvatar] 上传成功, avatar 长度=', avatarUrl.length);
    return { user: nextUser, avatar: avatarUrl };
  } catch (error) {
    console.error('[uploadAvatar] 上传失败:', error);
    throw new Error(getAuthErrorMessage(error, '头像上传失败'), { cause: error });
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
