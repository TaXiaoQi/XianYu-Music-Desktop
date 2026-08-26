import { pluginHttpRequest } from '../tauri/pluginApi';
import { assertSafeOutboundUrl } from '../../utils/urlGuard';

/** 带超时的 fetch，避免插件脚本或订阅请求长期挂起。优先走 Rust 原生 HTTP 越过 CORS 跨域限制。 */
export async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  try {
    const response = await pluginHttpRequest('GET', url, { 'User-Agent': 'Mozilla/5.0' }, undefined, ms);
    return new Response(response.body || '', {
      status: response.status || 200,
      headers: response.headers,
    });
  } catch {
    assertSafeOutboundUrl(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
