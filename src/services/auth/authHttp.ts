import { authApi } from '../tauri/authApi';
import {
  getAuthToken,
  triggerAccountExpired,
} from './authSession';
import type { ApiEnvelope, SignedRequestOptions } from './authTypes';

/**
 * 账号认证服务 · 签名请求（HTTP 层）。
 * 封装 Rust `authed_request`（md5 签名在 Rust 侧完成），统一注入登录态 token，
 * 内置超时保护与登录态失效探测。供 authAccount / authProfile 复用。
 */

/** 默认外层超时（毫秒） */
const DEFAULT_OUTER_TIMEOUT_MS = 30_000;

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
export async function requestEnvelope<T>(
  action: string,
  body: Record<string, unknown>,
  fetchTimeoutMs?: number,
  skipToken = false,
): Promise<ApiEnvelope<T>> {
  const finalBody: Record<string, unknown> = { ...body };
  const cachedToken = getAuthToken();
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
export async function requestAction<T>(
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