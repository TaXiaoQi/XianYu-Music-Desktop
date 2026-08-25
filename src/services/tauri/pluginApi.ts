/**
 * 插件 API 服务层
 *
 * 封装与 Tauri 后端插件系统的所有通信。
 */

import { tauriInvoke } from './invoke';
import type {
  AlternativeSourceResultContract,
  LxUrlSongInfoContract,
  PluginHttpBinaryResponseContract,
  PluginHttpResponseContract,
} from './contracts';

// ============ API 接口 ============

/**
 * 通用 HTTP 请求 —— 通过 Tauri 后端代理发起网络请求，绕过 CORS
 * 后端 command: plugin_http_request
 */
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

/**
 * 读取本地插件 JS 文件内容
 * 后端 command: read_plugin_file
 */
export async function readPluginFile(path: string): Promise<string> {
  return tauriInvoke('read_plugin_file', { path });
}

/**
 * 将插件脚本保存到应用数据目录，返回保存后的完整路径
 * 后端 command: save_plugin_script
 */
export async function savePluginScript(id: string, script: string): Promise<string> {
  return tauriInvoke('save_plugin_script', { id, script });
}

/**
 * 读取本地文件二进制内容（base64 → Uint8Array）
 * 后端 command: read_file_bytes
 */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  const base64 = await tauriInvoke('read_file_bytes', { path });
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * 读取本地图片文件为 base64（分享本地歌曲封面上传用）
 * 后端 command: read_image_base64
 */
export async function readImageBase64(path: string): Promise<{ mime: string; base64: string }> {
  return tauriInvoke('read_image_base64', { path });
}

/**
 * 通过后端 HTTP 代理获取远程插件脚本
 * 用于 ensurePluginInstance 加载远程 URL 插件
 */
async function fetchPluginUrl(url: string): Promise<string> {
  const resp = await tauriInvoke('plugin_http_request', { method: 'GET', url });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`HTTP ${resp.status}`);
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

/**
 * 下载网络音频到临时文件（用于 B站 m4s 等需要 Referer 头的直链）
 * 后端 command: download_audio_to_temp
 */
async function downloadAudioToTemp(
  url: string,
  headers?: Record<string, string>,
): Promise<string> {
  return tauriInvoke('download_audio_to_temp', { url, headers: headers ?? null });
}

/**
 * 下载网络视频到应用缓存目录，供 WebView 通过 asset 协议播放（背景视频）
 * 后端 command: download_video_to_cache
 */
async function downloadVideoToCache(
  url: string,
  headers?: Record<string, string>,
): Promise<string> {
  return tauriInvoke('download_video_to_cache', { url, headers: headers ?? null });
}

/**
 * 清理本功能在应用缓存中创建的背景视频文件
 * 后端 command: remove_cached_background_video
 */
async function removeCachedBackgroundVideo(path: string): Promise<void> {
  return tauriInvoke('remove_cached_background_video', { path });
}

/**
 * 获取落雪歌曲封面
 * 后端 command: get_lx_cover -> string | null
 */
async function getLxCover(songInfo: LxUrlSongInfoContract): Promise<string | null> {
  return tauriInvoke('get_lx_cover', { songInfo });
}

/**
 * 按音质候选列表解析落雪歌曲直链（带降级）
 * 后端 command: resolve_lx_with_quality_fallback
 */
async function resolveLxWithQualityFallback(
  songInfo: LxUrlSongInfoContract,
  qualities: string[],
) {
  return tauriInvoke('resolve_lx_with_quality_fallback', { songInfo, qualities });
}

/**
 * 查找替代的落雪音源
 * 后端 command: find_alternative_lx_source
 */
async function findAlternativeLxSource(
  songName: string,
  songArtist: string,
  songDuration: number,
  failedSources: string[],
  qualities: string[],
): Promise<AlternativeSourceResultContract | null> {
  return tauriInvoke('find_alternative_lx_source', {
    songName,
    songArtist,
    songDuration,
    failedSources,
    qualities,
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
  getLxCover,
  resolveLxWithQualityFallback,
  findAlternativeLxSource,
};
