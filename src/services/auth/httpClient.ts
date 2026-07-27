/**
 * 跨域 HTTP 请求适配器
 *
 * Tauri 环境下使用 @tauri-apps/plugin-http 的 fetch（请求从 Rust 侧发出，
 * 完全绕过浏览器的 CORS 限制与 preflight 预检），从而可携带自定义请求头
 * （X-Timestamp / X-Nonce / X-Sign）调用第三方 API。
 *
 * 非 Tauri 环境（如纯 `npm run dev` 浏览器调试）回退到全局 fetch，
 * 保持接口与标准 Fetch API 一致。
 */

import { isTauri } from '@tauri-apps/api/core';

let tauriFetch: typeof fetch | null = null;
let tauriFetchLoaded = false;

async function loadTauriFetch(): Promise<typeof fetch | null> {
  if (tauriFetchLoaded) return tauriFetch;
  tauriFetchLoaded = true;
  if (!isTauri()) return null;
  try {
    const mod = await import('@tauri-apps/plugin-http');
    tauriFetch = mod.fetch as typeof fetch;
  } catch {
    tauriFetch = null;
  }
  return tauriFetch;
}

/**
 * 与全局 fetch 签名一致的跨域请求函数，返回标准 Response。
 * 在 Tauri 中走 Rust（无 CORS）；在浏览器中回退全局 fetch。
 */
export async function crossOriginFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const fetchImpl = await loadTauriFetch();
  if (fetchImpl) {
    return fetchImpl(input, init);
  }
  return fetch(input, init);
}
