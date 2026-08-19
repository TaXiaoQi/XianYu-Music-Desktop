import { computed, ref } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';

import {
  getStoredPlugins,
  pluginGetVideoSource,
  type PluginVideoQuality,
  type PluginVideoSource,
} from '../services/pluginEngine';
import { pluginApi } from '../services/tauri/pluginApi';
import { useSettings } from '../features/settings/useSettings';
import type { PluginSearchResult, Song } from '../types';

const videoUrl = ref('');
const cachedVideoPath = ref('');
const sourceSongPath = ref('');
const loading = ref(false);
const error = ref('');
const availableQualities = ref<PluginVideoQuality[]>([]);
const activeQuality = ref('');
let requestVersion = 0;
let activeSong: Song | null = null;

/** 供“下载视频”使用的最后一次成功解析结果（原始直链 + 请求头） */
const lastResolvedSource = ref<Pick<PluginVideoSource, 'url' | 'headers' | 'backupUrls' | 'videoQuality' | 'codec' | 'height' | 'width'> | null>(null);

const BILIBILI_IDENTITY_PATTERN = /bilibili|哔哩哔哩|哔哩|b站/i;
const DEFAULT_MV_QUALITY = '720P';
const BILIBILI_720P_QUALITY_ID = 64;

/** B 站兜底解析支持的画质档位（未登录账号一般最高 1080P） */
const BILIBILI_QUALITY_PRESETS: Array<PluginVideoQuality & { qn: number }> = [
  { key: '360P', label: '360P 流畅', qn: 16 },
  { key: '480P', label: '480P 清晰', qn: 32 },
  { key: '720P', label: '720P 高清', qn: 64 },
  { key: '1080P', label: '1080P 全高清', qn: 80 },
];

const BILIBILI_QUALITY_ID_LABELS: Record<number, string> = {
  16: '360P',
  32: '480P',
  64: '720P',
  74: '720P60',
  80: '1080P',
  112: '1080P+',
  116: '1080P60',
  120: '4K',
};

function preferredMvQuality(): string {
  try {
    const configured = useSettings().settings.value.audio.mvDefaultQuality;
    if (configured) return configured;
  } catch {
    /* Pinia 未就绪（测试环境）时回退默认档 */
  }
  return DEFAULT_MV_QUALITY;
}

/**
 * 是否为插件在线歌曲（本地 / LX 无 MV 概念）。
 * 播放路径构造的 Song 不写 plugin_id（与音频解析一致），需回退 rawData.pluginId。
 */
function isMusicVideoSong(song: Song | null | undefined): boolean {
  if (!song || song.source_type !== 'plugin') return false;
  return !!song.plugin_id || !!nestedValue(song.rawData, 'pluginId');
}

/**
 * 合并插件 MV 返回的请求头与 UA（仅通用插件分支使用；B 站走 withBilibiliHeaders 强制补 Referer）
 */
function mergedPluginHeaders(videoSource: PluginVideoSource): Record<string, string> | undefined {
  const headers = { ...(videoSource.headers || {}) };
  if (videoSource.userAgent && !Object.keys(headers).some(key => key.toLowerCase() === 'user-agent')) {
    headers['User-Agent'] = videoSource.userAgent;
  }
  return Object.keys(headers).length ? headers : undefined;
}

/**
 * 当前歌曲是否可能支持 MV：
 * - 插件在线歌曲为前提
 * - B 站插件歌曲必然可解析（BV/AV 兜底）
 * - 其余 musicfree 插件歌曲：有对应插件且非 LX 即视为可能（真正是否提供见 start 的解析结果）
 */
export function supportsMusicVideo(song: Song | null | undefined): boolean {
  if (!isMusicVideoSong(song)) return false;
  if (isBilibiliPluginSong(song)) return true;
  const source = getStoredPlugins().find(
    plugin => plugin.id === (song!.plugin_id || String(nestedValue(song!.rawData, 'pluginId') || '')),
  );
  return !!source && source.format !== 'lx';
}

function nestedValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return record[key]
    ?? (record.rawData && typeof record.rawData === 'object'
      ? (record.rawData as Record<string, unknown>)[key]
      : undefined);
}

function firstString(...values: unknown[]): string {
  return values.find(value => typeof value === 'string' && value.trim())?.toString().trim() || '';
}

function extractBilibiliIdentity(song: Song): { bvid?: string; aid?: string; cid?: string } {
  const raw = song.rawData;
  const pathId = decodeURIComponent(song.path.split('/').pop() || '');
  const identityCandidates = [
    nestedValue(raw, 'bvid'),
    nestedValue(raw, 'id'),
    nestedValue(raw, 'aid'),
    pathId,
  ].map(value => String(value || ''));
  const identityText = identityCandidates.join(' ');
  const bvid = identityText.match(/BV[0-9A-Za-z]{10,}/i)?.[0];
  const aid = firstString(nestedValue(raw, 'aid'))
    || identityText.match(/(?:^|\W)av(\d+)(?:\W|$)/i)?.[1]
    || (!bvid ? identityCandidates.find(value => /^\d+$/.test(value)) : '');
  const cid = firstString(nestedValue(raw, 'cid'));
  return {
    ...(bvid ? { bvid } : {}),
    ...(aid ? { aid: aid.replace(/^av/i, '') } : {}),
    ...(cid ? { cid } : {}),
  };
}

function parseBilibiliResponse(responseBody: string, label: string): Record<string, any> {
  let payload: Record<string, any>;
  try {
    payload = JSON.parse(responseBody) as Record<string, any>;
  } catch {
    throw new Error(`${label}返回了无效数据`);
  }
  if (Number(payload.code) !== 0 || !payload.data) {
    throw new Error(`${label}失败${payload.message ? `：${payload.message}` : ''}`);
  }
  return payload.data as Record<string, any>;
}

function bilibiliQualityId(quality: string): number {
  return BILIBILI_QUALITY_PRESETS.find(preset => preset.key === quality)?.qn ?? BILIBILI_720P_QUALITY_ID;
}

/**
 * 旧版 Bilibili 插件只负责歌曲解析，没有 getMvSource 扩展。
 * 这里使用歌曲自身的 BV/AV 号补齐视频流，避免把“接口不存在”误报成插件损坏。
 */
async function resolveBilibiliVideoSource(song: Song, quality: string): Promise<PluginVideoSource | null> {
  const identity = extractBilibiliIdentity(song);
  if (!identity.bvid && !identity.aid) return null;

  const identityQuery = identity.bvid
    ? `bvid=${encodeURIComponent(identity.bvid)}`
    : `aid=${encodeURIComponent(identity.aid || '')}`;
  let cid = identity.cid;
  if (!cid) {
    const viewResponse = await pluginApi.pluginHttpRequest(
      'GET',
      `https://api.bilibili.com/x/web-interface/view?${identityQuery}`,
      { Referer: 'https://www.bilibili.com/' },
    );
    const viewData = parseBilibiliResponse(viewResponse.body, 'Bilibili 视频信息解析');
    cid = String(viewData.cid || viewData.pages?.[0]?.cid || '');
  }
  if (!cid) throw new Error('Bilibili 视频信息中缺少 CID');

  const qn = bilibiliQualityId(quality);
  const playResponse = await pluginApi.pluginHttpRequest(
    'GET',
    `https://api.bilibili.com/x/player/playurl?${identityQuery}&cid=${encodeURIComponent(cid)}&qn=${qn}&fnval=16&fourk=1`,
    { Referer: `https://www.bilibili.com/video/${identity.bvid || `av${identity.aid}`}` },
  );
  const playData = parseBilibiliResponse(playResponse.body, 'Bilibili 视频流解析');
  const dashVideos = Array.isArray(playData.dash?.video) ? playData.dash.video : [];
  const isAvc = (candidate: any) => String(candidate?.codecs || '').startsWith('avc1');
  const qualityId = (candidate: any) => Number(candidate?.id) || 0;
  const compatibleVideos = dashVideos
    .filter((candidate: any) => qualityId(candidate) <= qn)
    .sort((left: any, right: any) => qualityId(right) - qualityId(left));
  const video = dashVideos.find((candidate: any) => (
    qualityId(candidate) === qn && isAvc(candidate)
  ))
    || dashVideos.find((candidate: any) => qualityId(candidate) === qn)
    || compatibleVideos.find(isAvc)
    || compatibleVideos[0]
    || dashVideos.find(isAvc)
    || dashVideos[0];
  const directUrl = firstString(video?.baseUrl, video?.base_url, playData.durl?.[0]?.url);
  if (!directUrl) return null;

  const backupUrls = [
    ...(Array.isArray(video?.backupUrl) ? video.backupUrl : []),
    ...(Array.isArray(video?.backup_url) ? video.backup_url : []),
    ...(Array.isArray(playData.durl?.[0]?.backup_url) ? playData.durl[0].backup_url : []),
  ].filter((value): value is string => typeof value === 'string' && /^https?:\/\//i.test(value));

  return {
    url: directUrl,
    backupUrls,
    headers: { Referer: 'https://www.bilibili.com/' },
    videoQuality: BILIBILI_QUALITY_ID_LABELS[qualityId(video)] || quality,
    codec: firstString(video?.codecs),
    mimeType: firstString(video?.mimeType, video?.mime_type, 'video/mp4'),
    width: Number(video?.width) || undefined,
    height: Number(video?.height) || undefined,
    availableVideoQualities: BILIBILI_QUALITY_PRESETS.map(({ qn: _qn, ...preset }) => preset),
  };
}

export function isBilibiliPluginSong(song: Song | null | undefined): boolean {
  if (!song || !song.path.startsWith('plugin://')) return false;
  const raw = song.rawData;
  if (nestedValue(raw, 'bvid') || nestedValue(raw, 'aid')) return true;

  const identity = [
    song.path.split('/')[2],
    song.plugin_id,
    nestedValue(raw, 'platform'),
    nestedValue(raw, 'source'),
    nestedValue(raw, 'pluginId'),
  ].filter(Boolean).join(' ');
  return BILIBILI_IDENTITY_PATTERN.test(identity);
}

function toPluginSearchResult(song: Song): PluginSearchResult {
  const raw = song.rawData;
  if (raw && typeof raw === 'object' && 'pluginId' in raw && 'rawData' in raw) {
    return raw as PluginSearchResult;
  }

  const pathId = song.path.split('/').pop() || song.path;
  return {
    id: String(nestedValue(raw, 'id') || nestedValue(raw, 'bvid') || pathId),
    title: song.title || song.name,
    artist: song.artist || '',
    album: song.album || '',
    coverUrl: song.cover_thumb_path || '',
    duration: Math.max(0, Number(song.duration) || 0) * 1000,
    platform: String(nestedValue(raw, 'platform') || 'bilibili'),
    platformId: String(nestedValue(raw, 'id') || nestedValue(raw, 'bvid') || pathId),
    pluginId: song.plugin_id || String(nestedValue(raw, 'pluginId') || ''),
    rawData: raw || song,
  };
}

function withBilibiliHeaders(
  headers: Record<string, string> | undefined,
  userAgent: string | undefined,
): Record<string, string> {
  const merged = { ...(headers || {}) };
  const lowerKeys = new Set(Object.keys(merged).map(key => key.toLowerCase()));
  if (!lowerKeys.has('referer')) merged.Referer = 'https://www.bilibili.com/';
  if (!lowerKeys.has('origin')) merged.Origin = 'https://www.bilibili.com';
  if (userAgent && !lowerKeys.has('user-agent')) merged['User-Agent'] = userAgent;
  return merged;
}

async function removeCachedFile(path: string) {
  if (!path) return;
  await pluginApi.removeCachedBackgroundVideo(path).catch(() => {});
}

/** 解析 MV 视频源（不写缓存）：供播放 start 与下载 resolveDownloadSource 共用 */
async function resolveMvVideoSource(song: Song, quality: string): Promise<{
  videoSource: PluginVideoSource;
  headers: Record<string, string> | undefined;
}> {
  const isBili = isBilibiliPluginSong(song);
  const pluginId = song.plugin_id || String(nestedValue(song.rawData, 'pluginId') || '');
  const source = getStoredPlugins().find(plugin => plugin.id === pluginId);
  if (!source) {
    throw new Error('未找到当前歌曲对应的插件');
  }
  let resolved = await pluginGetVideoSource(source, toPluginSearchResult(song), quality);
  if (!resolved?.url && isBili) {
    resolved = await resolveBilibiliVideoSource(song, quality);
  }
  if (!resolved?.url) {
    throw new Error(isBili ? '未能解析当前 Bilibili 视频' : '当前歌曲的插件未提供 MV');
  }
  const headers = isBili
    ? withBilibiliHeaders(resolved.headers, resolved.userAgent)
    : mergedPluginHeaders(resolved);
  return { videoSource: resolved, headers };
}

export function useBilibiliVideoBackground() {
  const active = computed(() => Boolean(videoUrl.value && sourceSongPath.value));
  const requested = computed(() => Boolean(sourceSongPath.value));

  const stop = async () => {
    requestVersion += 1;
    const previousPath = cachedVideoPath.value;
    videoUrl.value = '';
    cachedVideoPath.value = '';
    sourceSongPath.value = '';
    loading.value = false;
    error.value = '';
    availableQualities.value = [];
    activeQuality.value = '';
    lastResolvedSource.value = null;
    activeSong = null;
    await removeCachedFile(previousPath);
  };

  const start = async (song: Song, quality?: string) => {
    const isBili = isBilibiliPluginSong(song);
    if (!isBili && !isMusicVideoSong(song)) {
      throw new Error('当前歌曲不支持 MV');
    }
    const targetQuality = quality?.trim() || preferredMvQuality();

    const previousPath = cachedVideoPath.value;
    const requestId = ++requestVersion;
    videoUrl.value = '';
    cachedVideoPath.value = '';
    sourceSongPath.value = song.path;
    loading.value = true;
    error.value = '';
    void removeCachedFile(previousPath);

    activeSong = song;

    let videoSource: PluginVideoSource;
    let headers: Record<string, string> | undefined;
    try {
      ({ videoSource, headers } = await resolveMvVideoSource(song, targetQuality));
    } catch (resolutionError) {
      if (requestId === requestVersion) {
        loading.value = false;
        sourceSongPath.value = '';
        error.value = resolutionError instanceof Error
          ? resolutionError.message
          : String(resolutionError);
      }
      throw resolutionError;
    }
    if (requestId !== requestVersion) return false;

    const candidates = [videoSource.url, ...(videoSource.backupUrls || [])];
    let downloadedPath = '';
    let lastDownloadError: unknown = null;
    for (const candidate of candidates) {
      try {
        downloadedPath = await pluginApi.downloadVideoToCache(candidate, headers);
        if (downloadedPath) break;
      } catch (downloadError) {
        lastDownloadError = downloadError;
      }
    }

    if (requestId !== requestVersion) {
      await removeCachedFile(downloadedPath);
      return false;
    }
    if (!downloadedPath) {
      loading.value = false;
      sourceSongPath.value = '';
      const message = lastDownloadError instanceof Error ? lastDownloadError.message : String(lastDownloadError || '');
      error.value = message;
      throw new Error(message ? `MV 加载失败：${message}` : 'MV 加载失败');
    }

    cachedVideoPath.value = downloadedPath;
    videoUrl.value = convertFileSrc(downloadedPath);
    loading.value = false;
    lastResolvedSource.value = {
      url: videoSource.url,
      headers,
      backupUrls: videoSource.backupUrls,
      videoQuality: videoSource.videoQuality || targetQuality,
      codec: videoSource.codec,
      height: videoSource.height,
      width: videoSource.width,
    };
    availableQualities.value = videoSource.availableVideoQualities?.length
      ? videoSource.availableVideoQualities
      : (isBili
        ? BILIBILI_QUALITY_PRESETS.map(({ qn: _qn, ...preset }) => preset)
        : [{ key: videoSource.videoQuality || targetQuality }]);
    activeQuality.value = videoSource.videoQuality || targetQuality;
    return true;
  };

  /** MV 播放中切换画质：以新档位重新解析并加载 */
  const setQuality = async (qualityKey: string) => {
    if (!requested.value || !activeSong) return false;
    if (qualityKey === activeQuality.value) return true;
    return start(activeSong, qualityKey);
  };

  /** 按指定画质解析下载用直链（不影响播放状态；同档位时优先复用当前解析结果） */
  const resolveDownloadSource = async (song: Song, quality: string) => {
    const last = lastResolvedSource.value;
    if (quality === activeQuality.value && last?.url) {
      return {
        url: last.url,
        headers: last.headers,
        backupUrls: last.backupUrls,
        videoQuality: last.videoQuality || quality,
      };
    }
    const { videoSource, headers } = await resolveMvVideoSource(song, quality);
    return {
      url: videoSource.url,
      headers,
      backupUrls: videoSource.backupUrls,
      videoQuality: videoSource.videoQuality || quality,
    };
  };

  const toggle = async (song: Song) => {
    if (requested.value) {
      await stop();
      return false;
    }
    return start(song);
  };

  return {
    active,
    requested,
    loading,
    error,
    videoUrl,
    sourceSongPath,
    availableQualities,
    activeQuality,
    lastResolvedSource,
    start,
    stop,
    toggle,
    setQuality,
    resolveDownloadSource,
  };
}
