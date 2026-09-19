import { pluginHttpRequest } from '../tauri/pluginApi';

export async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const response = await pluginHttpRequest('GET', url, { 'User-Agent': 'Mozilla/5.0' }, undefined, ms);
  return new Response(response.body || '', {
    status: response.status || 200,
    headers: response.headers,
  });
}
