/**
 * 插件 API 服务层
 *
 * 封装与 Tauri 后端插件系统的所有通信。
 *
 * ⚠️ 当前状态：后端插件系统尚未实现，所有调用会先尝试 invoke，
 * 失败后回退到 mock 数据，以便前端先行开发与联调。
 * 后端实现后，移除 MOCK_ENABLED 标志及 mock 函数即可。
 */

import { invoke } from '@tauri-apps/api/core';
import { tauriInvoke } from './invoke';
import type {
  AlternativeSourceResultContract,
  LxUrlSongInfoContract,
  PluginHttpBinaryResponseContract,
  PluginHttpResponseContract,
} from './contracts';
import type {
  PluginInfo,
  PluginSearchRequest,
  PluginSearchResponse,
  PluginTrack,
} from '../../types/plugin';

// ============ Mock 数据开关 ============
// 后端实现 plugin_search / get_installed_plugins 等 command 后，
// 将此值改为 false 或删除相关 mock 代码即可。
const MOCK_ENABLED = true;

// ============ Mock 数据 ============
const MOCK_PLUGINS: PluginInfo[] = [
  {
    id: 'xiaowo',
    name: '小蜗音乐',
    version: '1.0.0',
    author: 'XY Music',
    platform: 'xiaowo',
    description: '搜索并播放小蜗音乐资源',
    enabled: true,
    iconUrl: '',
  },
  {
    id: 'xiaogou',
    name: '小枸音乐',
    version: '1.0.0',
    author: 'XY Music',
    platform: 'xiaogou',
    description: '搜索并播放小枸音乐资源',
    enabled: true,
    iconUrl: '',
  },
  {
    id: 'xiaoqiu',
    name: '小秋音乐',
    version: '1.0.0',
    author: 'XY Music',
    platform: 'xiaoqiu',
    description: '搜索并播放小秋音乐资源',
    enabled: true,
    iconUrl: '',
  },
  {
    id: 'xiaoyun',
    name: '小芸音乐',
    version: '1.0.0',
    author: 'XY Music',
    platform: 'xiaoyun',
    description: '搜索并播放小芸音乐资源',
    enabled: true,
    iconUrl: '',
  },
  {
    id: 'xiaomi',
    name: '小蜜音乐',
    version: '1.0.0',
    author: 'XY Music',
    platform: 'xiaomi',
    description: '搜索并播放小蜜音乐资源',
    enabled: true,
    iconUrl: '',
  },
];

function mockSearch(request: PluginSearchRequest): Promise<PluginSearchResponse> {
  const { query, type, pluginId } = request;
  // 基于 query 生成稳定的 mock 数据
  const tracks: PluginTrack[] = type && type !== 'track' ? [] : Array.from({ length: 8 }).map((_, i) => ({
    id: `${pluginId}_track_${i}`,
    title: `${query} - 歌曲 ${i + 1}`,
    artist: `${query} 的演唱者 ${i + 1}`,
    artists: [`${query} 的演唱者 ${i + 1}`],
    album: `${query} 的专辑`,
    duration: 180 + i * 15,
    coverUrl: '',
    year: '2024',
    quality: i % 2 === 0 ? '无损' : '高品',
  }));

  const artists = type && type !== 'artist' ? [] : Array.from({ length: 4 }).map((_, i) => ({
    id: `${pluginId}_artist_${i}`,
    name: `${query} 相关艺术家 ${i + 1}`,
    avatarUrl: '',
    description: `${query} 相关的艺术家简介 ${i + 1}`,
    songCount: 20 + i * 5,
    albumCount: 3 + i,
  }));

  const albums = type && type !== 'album' ? [] : Array.from({ length: 4 }).map((_, i) => ({
    id: `${pluginId}_album_${i}`,
    name: `${query} 专辑 ${i + 1}`,
    artist: `${query} 演唱者 ${i + 1}`,
    coverUrl: '',
    year: '2023',
    songCount: 10 + i,
  }));

  const playlists = type && type !== 'playlist' ? [] : Array.from({ length: 4 }).map((_, i) => ({
    id: `${pluginId}_playlist_${i}`,
    name: `${query} 歌单 ${i + 1}`,
    creator: `用户 ${i + 1}`,
    coverUrl: '',
    description: `${query} 相关的歌单 ${i + 1}`,
    songCount: 15 + i * 3,
    playCount: 10000 * (i + 1),
  }));

  // 模拟网络延迟
  return new Promise(resolve => {
    setTimeout(() => resolve({ tracks, artists, albums, playlists }), 300);
  });
}

// ============ API 接口 ============

/**
 * 获取已安装的插件列表
 * 后端 command: get_installed_plugins -> PluginInfo[]
 */
async function getInstalledPlugins(): Promise<PluginInfo[]> {
  if (MOCK_ENABLED) {
    return [...MOCK_PLUGINS];
  }
  return invoke<PluginInfo[]>('get_installed_plugins');
}

/**
 * 搜索插件资源
 * 后端 command: plugin_search -> PluginSearchResponse
 */
async function pluginSearch(request: PluginSearchRequest): Promise<PluginSearchResponse> {
  if (MOCK_ENABLED) {
    return mockSearch(request);
  }
  return invoke<PluginSearchResponse>('plugin_search', { ...request });
}

/**
 * 设置插件启用状态
 * 后端 command: set_plugin_enabled
 */
async function setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
  if (MOCK_ENABLED) {
    return;
  }
  await invoke('set_plugin_enabled', { pluginId, enabled });
}

/**
 * 获取插件歌曲的可播放 URL（音源地址）
 * 后端 command: get_plugin_track_url -> string (streamUrl)
 *
 * 当 PluginTrack.streamUrl 为空时，前端需要二次调用此接口获取真实音源。
 */
async function getPluginTrackUrl(pluginId: string, trackId: string): Promise<string> {
  if (MOCK_ENABLED) {
    return `plugin://${pluginId}/stream/${trackId}`;
  }
  return invoke<string>('get_plugin_track_url', { pluginId, trackId });
}

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
  getInstalledPlugins,
  pluginSearch,
  setPluginEnabled,
  getPluginTrackUrl,
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
