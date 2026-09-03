import { pluginHttpRequest } from '../tauri/pluginApi';

/** 带超时的 fetch，避免插件脚本或订阅请求长期挂起。走 Rust 原生 HTTP 越过 CORS 跨域限制。
 * 不再回退浏览器 fetch：桌面端跨域请求必须统一走后端代理，浏览器 fetch 只会产生误导性的 CORS 错误。 */
export async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const response = await pluginHttpRequest('GET', url, { 'User-Agent': 'Mozilla/5.0' }, undefined, ms);
  return new Response(response.body || '', {
    status: response.status || 200,
    headers: response.headers,
  });
}
