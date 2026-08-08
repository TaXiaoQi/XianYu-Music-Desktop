import { pluginHttpRequest } from './tauri/pluginApi';

/** 带超时的 fetch，避免插件脚本或订阅请求长期挂起。 */
export async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);

  try {
    return await fetch(url, { signal: ctrl.signal });
  } catch (error) {
    if (ctrl.signal.aborted) {
      throw error;
    }

    const response = await pluginHttpRequest('GET', url, { Accept: '*/*' }, undefined, ms);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } finally {
    clearTimeout(timer);
  }
}
