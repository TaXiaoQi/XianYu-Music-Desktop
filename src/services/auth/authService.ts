/**
 * 账号认证服务
 *
 * 适配「弦予音乐 APP」邮箱注册登录 API（见 邮箱注册登录API调用文档.md）。
 * - 基地址：https://api.xianyumusic.cn/api
 * - 端点风格：POST /api/?action=<接口名>
 * - 所有接口需 MD5 签名：sign = md5(timestamp + nonce + body + api_secret)
 *   （签名在 Rust 侧完成，密钥不暴露给前端）
 * - 统一响应：{ code: 200, msg, data }，code === 200 视为成功
 *
 * 仅保留账号相关能力（登录/注册/验证码/找回密码/修改密码/资料/头像）。
 *
 * [迁移说明] 签名 + HTTP 请求已迁移到 Rust `authed_request` 命令，
 * token 存储迁移到 OS keyring（由 Rust `save_auth_credentials` / `get_auth_credentials` 管理）。
 * 前端通过 `initAuthFromKeyring()` 在启动时从 keyring 加载凭证到内存缓存，
 * `getStoredAuth()` / `getAuthToken()` 同步读取内存缓存。
 */

import { authApi } from '../tauri/authApi';
import { getDeviceId } from '../domain/usageStats';

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
export type VerifyCodeType = 'register' | 'login' | 'reset_password' | 'delete_account' | 'change_password' | 'bind';

export type HumanCaptcha = {
  captcha_id: string;
  question: string;
  expire_seconds?: number;
};

export type HumanCaptchaProvider = 'turnstile' | 'hcaptcha' | 'off' | string;

export type HumanCaptchaConfig = {
  enabled: boolean;
  provider: HumanCaptchaProvider;
  siteKey: string;
};

export type UserAgreement = {
  title: string;
  content: string;
};

export type HumanCaptchaPayload = {
  captchaId?: string;
  captchaAnswer?: string;
  captchaToken?: string;
  provider?: HumanCaptchaProvider;
};

export type ProfileStats = {
  favorite_count: number;
  playlist_count: number;
  starred_count?: number;
  history_count?: number;
  listening_count?: number;
  revision?: number;
  updated_at?: string | null;
};

export type ProfileAuditStatus = 'pending' | 'rejected' | 'none';

export type ProfileChangeLimitStatus = {
  status: ProfileAuditStatus;
  todayBlocked: boolean;
  blockMessage: string;
};

/** 默认后端地址：测试构建与正式构建统一指向弦予音乐 API */
export const DEFAULT_AUTH_BASE_URL = 'https://api.xianyumusic.cn/api';

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

/** 后端统一响应：code 200 成功，其他为失败（HTTP 状态码同步设置） */
type ApiEnvelope<T> = {
  code: number;
  msg: string;
  data: T;
};

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

function getStoredUser(): AuthUser | null {
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

// ═══════════════════════════════════════════════════════
//  签名请求（Rust authed_request）
// ═══════════════════════════════════════════════════════

/** signedRequest 的可选参数 */
export type SignedRequestOptions = {
  /** fetch 超时时间（毫秒），默认 25s。大文件上传等场景可设更长 */
  fetchTimeoutMs?: number;
  /** signedRequest 外层 Promise.race 超时时间（毫秒），默认 30s */
  timeoutMs?: number;
  /** 跳过自动注入登录 token（查看他人公开数据等场景，避免属主校验误判为登录过期） */
  skipToken?: boolean;
};

/** 默认外层超时（毫秒） */
const DEFAULT_OUTER_TIMEOUT_MS = 30_000;

/**
 * 登录态失效（token 被服务端判定为无效/过期/属主不符）时触发，
 * 由 UI 层（authStore）注册回调，用于自动登出并回到登录页。
 * 避免存量用户在 keyring 残留旧 token 时反复用失效 token 刷屏报错。
 */
let onAccountExpiredHandler: (() => void) | null = null;

export function onAccountExpired(handler: () => void): void {
  onAccountExpiredHandler = handler;
}

function triggerAccountExpired(): void {
  onAccountExpiredHandler?.();
}

/** 服务端在硬模式下统一返回的 token 失效文案 */
const SESSION_EXPIRED_MSG_RE = /登录状态已失效|登录已过期|登录状态与账号不匹配/;

/** 判定一次账号请求的响应是否表示「登录态失效，需重新登录」 */
function isSessionExpiredEnvelope(payload: ApiEnvelope<unknown>): boolean {
  return payload.code === 401 && SESSION_EXPIRED_MSG_RE.test(payload?.msg ?? '');
}

/**
 * 发起带签名的 POST 请求，返回完整响应信封。
 * 签名在 Rust 侧完成（md5(timestamp + nonce + body + api_secret)）。
 * 已登录时自动注入登录态 token，供服务端 dispatch 层做用户资源属主校验。
 */
async function requestEnvelope<T>(
  action: string,
  body: Record<string, unknown>,
  fetchTimeoutMs?: number,
  skipToken = false,
): Promise<ApiEnvelope<T>> {
  const finalBody: Record<string, unknown> = { ...body };
  if (!skipToken && cachedToken && !('token' in finalBody)) {
    finalBody.token = cachedToken;
  }
  const payload = await authApi.authedRequest(action, finalBody, fetchTimeoutMs);
  // skipToken 请求（查看他人公开数据）的 401 不代表当前用户登录过期，
  // 硬模式下无 token 请求会被服务端拒绝，误判会触发自动登出
  if (!skipToken && isSessionExpiredEnvelope(payload)) {
    // 登录态已失效：触发自动登出，UI 回到登录页让用户重新登录
    triggerAccountExpired();
  }
  return payload as unknown as ApiEnvelope<T>;
}

/** 调用接口并校验 code === 200，返回 data */
async function requestAction<T>(
  action: string,
  body: Record<string, unknown>,
  fetchTimeoutMs?: number,
  skipToken = false,
): Promise<T> {
  const payload = await requestEnvelope<T>(action, body, fetchTimeoutMs, skipToken);
  if (Number(payload.code) !== 200) {
    throw new Error(payload.msg || `请求失败（code ${payload.code}）`);
  }
  return payload.data ?? ({} as T);
}

/**
 * 导出带签名的 API 请求方法，供歌单同步等模块复用。
 * 签名在 Rust 侧完成，前端只需传 action + body。
 * 内置超时保护，避免网络挂起导致同步卡死。
 */
export async function signedRequest<T>(
  action: string,
  body: Record<string, unknown>,
  options?: SignedRequestOptions,
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_OUTER_TIMEOUT_MS;
  const fetchTimeoutMs = options?.fetchTimeoutMs;
  const skipToken = options?.skipToken === true;

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`请求超时（${timeoutMs / 1000}s），action=${action}`));
    }, timeoutMs);
  });

  return Promise.race([
    requestAction<T>(action, body, fetchTimeoutMs, skipToken),
    timeoutPromise,
  ]);
}

// ═══════════════════════════════════════════════════════
//  账号 API 封装
// ═══════════════════════════════════════════════════════

function withCaptcha(body: Record<string, unknown>, captcha: HumanCaptchaPayload): Record<string, unknown> {
  if (captcha.captchaToken) {
    return {
      ...body,
      captcha_token: captcha.captchaToken,
      turnstile_token: captcha.captchaToken,
      captcha_provider: captcha.provider || '',
    };
  }
  return {
    ...body,
    captcha_id: captcha.captchaId || '',
    captcha_answer: captcha.captchaAnswer || '',
  };
}

/** 人机验证配置缓存有效期：配置极少变动，缓存可避免每次弹验证题都先请求一次配置 */
const CAPTCHA_CONFIG_CACHE_MS = 10 * 60 * 1000;
let cachedCaptchaConfig: { value: HumanCaptchaConfig; fetchedAt: number } | null = null;

/**
 * 获取新版人机验证配置（10 分钟本地缓存）。
 * 启用 Turnstile / hCaptcha 时，客户端弹窗直接渲染第三方组件；未启用时回退旧算术题。
 * 远程服务器 RTT 较高，缓存命中时验证题弹窗可少一次网络往返。
 */
export async function getHumanCaptchaConfig(): Promise<HumanCaptchaConfig> {
  if (cachedCaptchaConfig && Date.now() - cachedCaptchaConfig.fetchedAt < CAPTCHA_CONFIG_CACHE_MS) {
    return cachedCaptchaConfig.value;
  }
  try {
    const data = await requestAction<Record<string, unknown>>('email_get_captcha_config', {});
    const value: HumanCaptchaConfig = {
      enabled: Boolean(data.enabled) && Boolean(data.site_key),
      provider: String(data.provider || 'off'),
      siteKey: String(data.site_key || ''),
    };
    cachedCaptchaConfig = { value, fetchedAt: Date.now() };
    return value;
  } catch {
    // 请求失败时回退旧缓存（若有），避免网络抖动时误降级为算术题
    if (cachedCaptchaConfig) {
      return cachedCaptchaConfig.value;
    }
    return {
      enabled: false,
      provider: 'off',
      siteKey: '',
    };
  }
}

export async function getUserAgreement(): Promise<UserAgreement> {
  const data = await requestAction<Record<string, unknown>>('get_user_agreement', {});
  return {
    title: String(data.title || '弦予音乐用户协议'),
    content: String(data.content || ''),
  };
}

/**
 * 获取一次性人机验证码题目。
 * 当前服务端实现为简单数学题，提交登录/注册/验证码发送/找回密码时一并校验。
 */
export async function getHumanCaptcha(): Promise<HumanCaptcha> {
  const data = await requestAction<Record<string, unknown>>('get_captcha', {
    purpose: 'auth',
  });
  return {
    captcha_id: String(data.captcha_id ?? ''),
    question: String(data.question ?? ''),
    expire_seconds: Number(data.expire_seconds ?? 0) || undefined,
  };
}

/**
 * 预校验人机验证码。
 * 此接口只确认答案是否正确，不消费验证码；后续真实登录/注册/发码请求仍会再次校验并消费。
 */
export async function verifyHumanCaptcha(captcha: HumanCaptchaPayload): Promise<void> {
  if (captcha.captchaToken) return;
  await requestAction<Record<string, unknown>>('verify_captcha', {
    purpose: 'auth',
    captcha_id: captcha.captchaId || '',
    captcha_answer: captcha.captchaAnswer || '',
  });
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
 * 弦予号登录（参考微信号设计：弦予号是唯一登录标识）
 * POST /api/?action=user_login
 */
export async function login(
  ciyuanxiId: string,
  password: string,
  captcha: HumanCaptchaPayload,
): Promise<AuthPayload> {
  try {
    const data = await requestAction<Record<string, unknown>>('user_login', withCaptcha({
      ciyuanxi_id: ciyuanxiId,
      password,
      device_id: getDeviceId(),
    }, captcha));
    if (!data.token) throw new Error('登录响应无效');
    const payload: AuthPayload = { token: String(data.token), user: mapUser(data) };
    saveAuth(payload);
    return payload;
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '登录失败'), { cause: error });
  }
}

/**
 * 用户注册（弦予号必填，昵称可选留空则服务端默认"弦予+号"；注册成功后自动登录获取会话）。
 * POST /api/?action=register
 */
export async function register(
  ciyuanxiId: string,
  nickname: string,
  password: string,
  email: string,
  code: string,
  captcha: HumanCaptchaPayload,
): Promise<AuthPayload> {
  try {
    const data = await requestAction<Record<string, unknown>>('register', withCaptcha({
      ciyuanxi_id: ciyuanxiId.trim(),
      nickname,
      password,
      email,
      verify_code: code,
      device_id: getDeviceId(),
    }, captcha));
    if (!data.token) throw new Error('注册响应无效');
    const payload: AuthPayload = { token: String(data.token), user: mapUser(data) };
    saveAuth(payload);
    return payload;
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '注册失败'), { cause: error });
  }
}

/**
 * 修改弦予号（参考微信号设计：可修改但每月仅限一次）。
 * 需当前弦予号 + 登录密码校验。
 * POST /api/?action=update_ciyuanxi_id
 */
export async function updateCiyuanxiId(
  oldCiyuanxiId: string,
  newCiyuanxiId: string,
  password: string,
): Promise<{ message: string; ciyuanxi_id: string }> {
  try {
    const data = await requestAction<{ ciyuanxi_id?: string }>('update_ciyuanxi_id', {
      ciyuanxi_id: oldCiyuanxiId,
      new_ciyuanxi_id: newCiyuanxiId,
      password,
    });
    return {
      message: '弦予号修改成功',
      ciyuanxi_id: String(data.ciyuanxi_id ?? newCiyuanxiId),
    };
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '弦予号修改失败'), { cause: error });
  }
}

/**
 * 绑定邮箱（通过 type='bind' 的邮箱验证码）
 * POST /api/?action=bind_email
 */
export async function bindEmail(
  ciyuanxiId: string,
  email: string,
  verifyCode: string,
): Promise<{ message: string; email: string }> {
  try {
    const data = await requestAction<{ email?: string }>('bind_email', {
      ciyuanxi_id: ciyuanxiId,
      email,
      verify_code: verifyCode,
    });
    return { message: '邮箱绑定成功', email: String(data.email ?? email) };
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '邮箱绑定失败'), { cause: error });
  }
}

/**
 * 发送邮箱验证码（注册 / 登录 / 找回密码 / 绑定邮箱等场景，通过 type 区分）
 * POST /api/?action=send_verify_code
 */
export async function sendEmailCode(
  email: string,
  type: VerifyCodeType = 'register',
  captcha: HumanCaptchaPayload,
  ciyuanxiId?: string,
): Promise<{ success: true; message: string }> {
  try {
    const payload = await requestEnvelope<Record<string, unknown>>('send_verify_code', withCaptcha({
      email,
      type,
      ...(ciyuanxiId ? { ciyuanxi_id: ciyuanxiId } : {}),
    }, captcha));
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
  captcha: HumanCaptchaPayload,
): Promise<{ message: string }> {
  try {
    const payload = await requestEnvelope<Record<string, unknown>>('reset_password', withCaptcha({
      email,
      verify_code: verifyCode,
      new_password: newPassword,
    }, captcha));
    if (Number(payload.code) !== 200) {
      throw new Error(payload.msg || '重置密码失败');
    }
    return { message: payload.msg || '密码修改成功' };
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '重置密码失败'), { cause: error });
  }
}

/**
 * 预验证注销凭据（密码 + 邮箱验证码）。
 * 仅校验凭据是否正确，不执行实际注销。
 * 用于二级确认弹窗弹出时提前验证，减少用户点击确认后的等待时间。
 */
export async function preVerifyDeleteAccount(
  verifyCode: string,
  password: string,
): Promise<{ message: string }> {
  const current = getStoredUser();
  if (!current?.ciyuanxi_id || !current.email) {
    throw new Error('未获取到当前账号信息，请重新登录');
  }
  if (!password) {
    throw new Error('请输入登录密码');
  }
  if (!verifyCode) {
    throw new Error('请输入邮箱验证码');
  }

  try {
    const payload = await requestEnvelope<Record<string, unknown>>('preverify_delete_account', {
      ciyuanxi_id: current.ciyuanxi_id,
      email: current.email,
      verify_code: verifyCode,
      password,
    });
    if (Number(payload.code) !== 200) {
      throw new Error(payload.msg || '凭据验证失败');
    }
    return { message: payload.msg || '验证通过' };
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '凭据验证失败'), { cause: error });
  }
}

/**
 * 注销当前账号。
 * 需要当前账号登录密码 + 注册邮箱收到的 delete_account 验证码，双重验证。
 */
export async function deleteAccount(
  verifyCode: string,
  password: string,
): Promise<{ message: string }> {
  const current = getStoredUser();
  if (!current?.ciyuanxi_id || !current.email) {
    throw new Error('未获取到当前账号信息，请重新登录');
  }
  if (!password) {
    throw new Error('请输入登录密码');
  }

  try {
    const payload = await requestEnvelope<Record<string, unknown>>('delete_account', {
      ciyuanxi_id: current.ciyuanxi_id,
      email: current.email,
      verify_code: verifyCode,
      password,
    });
    if (Number(payload.code) !== 200) {
      throw new Error(payload.msg || '注销账号失败');
    }
    clearAuth();
    return { message: payload.msg || '账号已注销' };
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '注销账号失败'), { cause: error });
  }
}

/**
 * 修改密码（需登录，使用弦予号 + 旧密码验证）
 * POST /api/?action=change_password
 */
export async function changePassword(
  oldPassword: string,
  newPassword: string,
  code: string,
): Promise<{ message: string }> {
  const user = getStoredUser();
  const ciyuanxiId = user?.ciyuanxi_id;
  if (!ciyuanxiId) throw new Error('未获取到弦予号，无法修改密码，请重新登录');

  try {
    const payload = await requestEnvelope<Record<string, unknown>>('change_password', {
      ciyuanxi_id: ciyuanxiId,
      old_password: oldPassword,
      new_password: newPassword,
      code,
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
  const token = getAuthToken();
  const current = getStoredUser();
  if (!token || !current) return null;

  try {
    const data = await requestAction<Record<string, unknown>>(
      'get_user_info',
      {
        ciyuanxi_id: current.ciyuanxi_id ?? current.id,
      },
      15_000,
    );
    const user = mapUser(data);
    // 更新内存缓存，保证后续读取一致
    saveAuth({ token, user });
    return {
      user,
      stats: {
        favorite_count: Number(data.favorite_count ?? 0),
        playlist_count: Number(data.playlist_count ?? 0),
      },
    };
  } catch (error) {
    console.warn('[getProfile] 获取用户信息失败:', error);
    return null;
  }
}

/**
 * 更新个人资料（昵称）。
 * 改名走审核流程，失败时透传服务端提示。
 */
export async function updateProfile(
  nickname: string,
  avatar?: string,
): Promise<{ user: AuthUser; nicknamePending?: boolean }> {
  const token = getAuthToken();
  const current = getStoredUser();
  if (!token || !current) throw new Error('未登录');

  try {
    const data = await requestAction<{ user?: AuthUser; avatar?: string; nickname_pending?: boolean; status?: string }>('update_profile', {
      token,
      ciyuanxi_id: current.ciyuanxi_id || '',
      username: nickname,
      nickname,
      avatar: avatar || '',
    });

    // 改名走审核流程：后端不会更新 username，前端也保持旧值
    // nickname_pending=true 表示改名申请已提交待审核
    const nicknamePending = data.nickname_pending === true || data.status === 'pending';
    const nextUser: AuthUser = data.user ?? {
      ...current,
      avatar: avatar ?? current.avatar,
    };
    // 不在本地更新 username/nickname（需审核通过后才更新）
    saveAuth({ token, user: nextUser });
    return { user: nextUser, nicknamePending };
  } catch (error) {
    throw new Error(getAuthErrorMessage(error, '保存失败'), { cause: error });
  }
}

/**
 * 查询当前用户改名审核状态。
 * 返回 'pending'（审核中）/ 'rejected'（未通过）/ 'none'（无待处理）
 */
export async function getNicknameStatus(): Promise<'pending' | 'rejected' | 'none'> {
  const current = getStoredUser();
  if (!current) return 'none';

  try {
    const data = await requestAction<{ status: string }>(
      'get_nickname_status',
      {
        ciyuanxi_id: current.ciyuanxi_id ?? current.id,
      },
      15_000,
    );
    const status = data.status ?? 'none';
    if (status === 'pending' || status === 'rejected') return status;
    return 'none';
  } catch (error) {
    console.warn('[getNicknameStatus] 查询失败:', error);
    return 'none';
  }
}

export async function getNicknameChangeLimitStatus(): Promise<ProfileChangeLimitStatus> {
  const current = getStoredUser();
  if (!current) return { status: 'none', todayBlocked: false, blockMessage: '' };

  try {
    const data = await requestAction<{ status: string; today_blocked?: boolean; block_message?: string }>(
      'get_nickname_status',
      {
        ciyuanxi_id: current.ciyuanxi_id ?? current.id,
      },
      15_000,
    );
    const rawStatus = data.status ?? 'none';
    const status: ProfileAuditStatus = rawStatus === 'pending' || rawStatus === 'rejected' ? rawStatus : 'none';
    return {
      status,
      todayBlocked: data.today_blocked === true,
      blockMessage: String(data.block_message || ''),
    };
  } catch (error) {
    console.warn('[getNicknameChangeLimitStatus] 查询失败:', error);
    return { status: 'none', todayBlocked: false, blockMessage: '' };
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
        let canvas: HTMLCanvasElement | null = null;
        try {
          let width = img.width;
          let height = img.height;
          if (width > maxWidth) {
            height = Math.round(height * (maxWidth / width));
            width = maxWidth;
          }
          canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas 上下文不可用'));
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } finally {
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
          img.onload = null;
          img.onerror = null;
          img.src = '';
        }
      };
      img.onerror = () => {
        img.onload = null;
        img.onerror = null;
        img.src = '';
        reject(new Error('图片加载失败'));
      };
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

/**
 * 上传头像。使用 Canvas 压缩后以 base64 JSON 方式提交（兼容 Tauri HTTP 插件）。
 * POST /api/?action=upload_avatar
 *
 * 上传后进入审核流程（和壁纸一样），头像不会立即生效，
 * 需管理员审核通过后才更新到 app_users.avatar_url。
 * 因此本函数不再更新本地 authStore 中的 avatar。
 */
export async function uploadAvatar(
  file: Blob,
): Promise<{ status: 'pending' }> {
  const token = getAuthToken();
  const current = getStoredUser();
  if (!token || !current) throw new Error('未登录');

  // 前端压缩：256px 宽度，JPEG 质量 75%
  const avatarData = await compressImageToDataUrl(file, 256, 0.75);

  try {
    // 头像上传首次请求可能触发建表/ALTER TABLE，需要更长超时
    const TIMEOUT_MS = 60_000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`请求超时（${TIMEOUT_MS / 1000}s），action=upload_avatar`));
      }, TIMEOUT_MS);
    });

    await Promise.race([
      requestAction<{ status?: string }>(
        'upload_avatar',
        {
          ciyuanxi_id: current.ciyuanxi_id ?? current.id,
          avatar_data: avatarData,
        },
        55_000, // fetch 超时 55s，留 5s 给外层
      ),
      timeoutPromise,
    ]);

    return { status: 'pending' };
  } catch (error) {
    console.error('[uploadAvatar] 上传失败:', error);
    throw new Error(getAuthErrorMessage(error, '头像上传失败'), { cause: error });
  }
}

/**
 * POST /api/?action=get_avatar_status
 *
 * 查询当前用户头像审核状态。
 * - 'pending'：审核中
 * - 'rejected'：审核未通过
 * - 'none'：无待处理记录（头像已生效或从未上传）
 */
export async function getAvatarStatus(): Promise<'pending' | 'rejected' | 'none'> {
  const current = getStoredUser();
  if (!current) return 'none';

  try {
    const data = await requestAction<{ status: string }>(
      'get_avatar_status',
      {
        ciyuanxi_id: current.ciyuanxi_id ?? current.id,
      },
      15_000,
    );
    const status = data.status ?? 'none';
    if (status === 'pending' || status === 'rejected') return status;
    return 'none';
  } catch (error) {
    console.warn('[getAvatarStatus] 查询失败:', error);
    return 'none';
  }
}

export async function getAvatarChangeLimitStatus(): Promise<ProfileChangeLimitStatus> {
  const current = getStoredUser();
  if (!current) return { status: 'none', todayBlocked: false, blockMessage: '' };

  try {
    const data = await requestAction<{ status: string; today_blocked?: boolean; block_message?: string }>(
      'get_avatar_status',
      {
        ciyuanxi_id: current.ciyuanxi_id ?? current.id,
      },
      15_000,
    );
    const rawStatus = data.status ?? 'none';
    const status: ProfileAuditStatus = rawStatus === 'pending' || rawStatus === 'rejected' ? rawStatus : 'none';
    return {
      status,
      todayBlocked: data.today_blocked === true,
      blockMessage: String(data.block_message || ''),
    };
  } catch (error) {
    console.warn('[getAvatarChangeLimitStatus] 查询失败:', error);
    return { status: 'none', todayBlocked: false, blockMessage: '' };
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

/**
 * 检查当前用户账号/设备是否被封禁。
 * 调用服务器 check_ban_status 接口，传入 ciyuanxi_id 和 device_id。
 * 返回 { banned, type, reason }，若被封禁则同步清空本地凭证。
 */
export async function checkBanStatus(): Promise<{ banned: boolean; type: 'account' | 'device'; reason: string; ciyuanxiId: string; nickname: string }> {
  const current = getStoredUser();
  if (!current) return { banned: false, type: 'account', reason: '', ciyuanxiId: '', nickname: '' };
  try {
    const data = await requestAction<{ banned: boolean; type?: string; reason?: string }>(
      'check_ban_status',
      {
        ciyuanxi_id: current.ciyuanxi_id ?? current.id,
        device_id: getDeviceId(),
      },
      15_000,
    );
    return {
      banned: data.banned === true,
      type: (data.type as 'account' | 'device') || 'account',
      reason: data.reason || '',
      ciyuanxiId: current.ciyuanxi_id ?? current.id,
      nickname: current.nickname || '',
    };
  } catch {
    return { banned: false, type: 'account', reason: '', ciyuanxiId: '', nickname: '' };
  }
}
