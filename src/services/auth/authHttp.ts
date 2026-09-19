import { authApi } from '../tauri/authApi';
import {
  getAuthToken,
  triggerAccountExpired,
} from './authSession';
import type { ApiEnvelope, SignedRequestOptions } from './authTypes';


const DEFAULT_OUTER_TIMEOUT_MS = 30_000;

const SESSION_EXPIRED_MSG_RE = /登录状态已失效|登录已过期|登录状态与账号不匹配/;

function isSessionExpiredEnvelope(payload: ApiEnvelope<unknown>): boolean {
  return payload.code === 401 && SESSION_EXPIRED_MSG_RE.test(payload?.msg ?? '');
}

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
  if (!skipToken && isSessionExpiredEnvelope(payload)) {
    triggerAccountExpired();
  }
  return payload as unknown as ApiEnvelope<T>;
}

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