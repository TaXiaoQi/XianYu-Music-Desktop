
import { tauriInvoke } from './invoke';
import type {
  AlternativeSourceResultContract,
  LxUrlSongInfoContract,
  PluginHttpBinaryResponseContract,
  PluginHttpResponseContract,
} from './contracts';

// ============ API 接口 ============

export async function pluginHttpRequest(
  method: string,
  url: string,
  headers?: Record<string, string>,
  body?: string,
  timeout?: number,
  follow?: number,
): Promise<PluginHttpResponseContract> {
  return tauriInvoke('plugin_http_request', {
    method,
    url,
    headers: headers ?? null,
    body: body ?? null,
    timeout: timeout ?? null,
    follow: follow ?? null,
  });
}

export async function readPluginFile(path: string): Promise<string> {
  return tauriInvoke('read_plugin_file', { path });
}

export async function savePluginScript(id: string, script: string): Promise<string> {
  return tauriInvoke('save_plugin_script', { id, script });
}

export async function readFileBytes(path: string): Promise<Uint8Array> {
  const base64 = await tauriInvoke('read_file_bytes', { path });
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function readImageBase64(path: string): Promise<{ mime: string; base64: string }> {
  return tauriInvoke('read_image_base64', { path });
}

/**
 * 取插件脚本文本。
 *
 * 显式带上 WebView 自身的 User-Agent：部分音源站点按 UA 白名单放行，Rust 侧默认的
 * Chrome UA 会被判成「该 Key 不允许当前客户端（User-Agent 已被限制）」而 403，
 * 站点认得的恰是浏览器/WebView 的 UA。这样原生请求既绕开了 CORS，又保持与浏览器
 * 一致的客户端标识。
 */
async function fetchPluginUrl(url: string): Promise<string> {
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const resp = await tauriInvoke('plugin_http_request', {
    method: 'GET',
    url,
    headers: userAgent ? { 'User-Agent': userAgent } : null,
  });
  if (resp.status < 200 || resp.status >= 300) {
    // 带上响应体片段：站点的 403/4xx 往往在 body 里说明原因（如 User-Agent 校验、
    // 限流、key 失效），只报状态码会让这类失败无从排查。
    const detail = String(resp.body ?? '').trim().slice(0, 200);
    throw new Error(`HTTP ${resp.status}${detail ? ` ${detail}` : ''}`);
  }
  return resp.body;
}

async function proxyImage(url: string, referer?: string): Promise<string> {
  return tauriInvoke('proxy_image', { url, referer: referer ?? null });
}

async function pluginHttpRequestBinary(
  method: string,
  url: string,
  headers?: Record<string, string>,
  body?: string,
  timeout?: number,
  follow?: number,
): Promise<PluginHttpBinaryResponseContract> {
  return tauriInvoke('plugin_http_request_binary', {
    method,
    url,
    headers: headers ?? null,
    body: body ?? null,
    timeout: timeout ?? null,
    follow: follow ?? null,
  });
}

async function downloadAudioToTemp(
  url: string,
  headers?: Record<string, string>,
): Promise<string> {
  return tauriInvoke('download_audio_to_temp', { url, headers: headers ?? null });
}

async function downloadVideoToCache(
  url: string,
  headers?: Record<string, string>,
): Promise<string> {
  return tauriInvoke('download_video_to_cache', { url, headers: headers ?? null });
}

async function removeCachedBackgroundVideo(path: string): Promise<void> {
  return tauriInvoke('remove_cached_background_video', { path });
}

// MV 流式代理 URL：数据进歌曲的在线播放流缓存池（同 LRU 上限/清理），
// 代理侧已缓冲部分本地伺服、未命中回源透传。
async function mvProxyUrl(url: string, headers?: Record<string, string>): Promise<string> {
  return tauriInvoke('mv_proxy_url', { url, headers: headers ?? null });
}

async function getLxCover(songInfo: LxUrlSongInfoContract): Promise<string | null> {
  return tauriInvoke('get_lx_cover', { songInfo });
}

async function findAlternativeLxSource(
  songName: string,
  songArtist: string,
  songDuration: number,
  failedSources: string[],
): Promise<AlternativeSourceResultContract | null> {
  return tauriInvoke('find_alternative_lx_source', {
    songName,
    songArtist,
    songDuration,
    failedSources,
  });
}

export const pluginApi = {
  pluginHttpRequest,
  pluginHttpRequestBinary,
  readPluginFile,
  savePluginScript,
  readFileBytes,
  fetchPluginUrl,
  proxyImage,
  downloadAudioToTemp,
  downloadVideoToCache,
  removeCachedBackgroundVideo,
  mvProxyUrl,
  getLxCover,
  findAlternativeLxSource,
};
