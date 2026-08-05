/** 带超时的 fetch，避免插件脚本或订阅请求长期挂起。 */
export function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);

  return fetch(url, { signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}
