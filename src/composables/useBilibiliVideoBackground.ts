import { computed, ref } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';

import {
  getStoredPlugins,
  pluginGetVideoSource,
  type PluginVideoQuality,
  type PluginVideoSource,
} from '../services/domain/pluginEngine';
import { pluginApi } from '../services/tauri/pluginApi';
import {
  analyzeMvAudioSync,
  analyzeMvAudioSyncLocal,
} from '../services/domain/mvAutoSync';
import { usePlaybackStore } from '../features/playback/store';
import { useSettings } from '../features/settings/useSettings';
import type { PluginSearchResult, Song } from '../types';

const videoUrl = ref('');
const cachedVideoPath = ref('');
const sourceSongPath = ref('');
const loading = ref(false);
// 加载阶段：'resolve'=解析地址，'download'=下载视频（与移动端 phase 对齐）。
const phase = ref<'' | 'resolve' | 'download'>('');
const error = ref('');
const availableQualities = ref<PluginVideoQuality[]>([]);
const activeQuality = ref('');
const syncOffsetSec = ref(0);
const syncOffsetCache = new Map<string, number>();
// 音频是否已交给 MV 自带音轨（true 时组件会取消视频静音并把歌曲音量淡出）。
const audioTakenOver = ref(false);
let requestVersion = 0;
let activeSong: Song | null = null;

const lastResolvedSource = ref<Pick<PluginVideoSource, 'url' | 'headers' | 'backupUrls' | 'videoQuality' | 'codec' | 'height' | 'width'> | null>(null);

const BILIBILI_IDENTITY_PATTERN = /bilibili|哔哩哔哩|哔哩|b站/i;
const DEFAULT_MV_QUALITY = '720P';
const BILIBILI_720P_QUALITY_ID = 64;

const MV_QUALITY_LADDER = ['4K', '1080P', '720P', '480P', '360P'];
function mvQualityLadder(quality: string): string[] {
  const idx = MV_QUALITY_LADDER.indexOf(quality);
  const start = idx < 0 ? 2 : idx;
  return MV_QUALITY_LADDER.slice(start, start + 3);
}

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

function isMusicVideoSong(song: Song | null | undefined): boolean {
  if (!song || song.source_type !== 'plugin') return false;
  return !!song.plugin_id || !!nestedValue(song.rawData, 'pluginId');
}

/// 把初始化/下载异常压成一句短原因（与移动端 _shortMvError 一致）。
export function shortMvError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('timeout') || raw.includes('超时')) return '网络超时';
  if (s.includes('403') || s.includes('forbidden')) return '链接无权限（403）';
  if (s.includes('404') || s.includes('not found')) return '链接已失效（404）';
  if (s.includes('network') || s.includes('socket') || raw.includes('连接')) {
    return '网络连接失败';
  }
  if (s.includes('codec') || s.includes('format') || s.includes('decoder')) {
    return '画面格式不支持';
  }
  const t = raw.trim();
  return t.length > 24 ? `${t.slice(0, 24)}…` : t;
}

function mergedPluginHeaders(videoSource: PluginVideoSource): Record<string, string> | undefined {
  const headers = { ...(videoSource.headers || {}) };
  if (videoSource.userAgent && !Object.keys(headers).some(key => key.toLowerCase() === 'user-agent')) {
    headers['User-Agent'] = videoSource.userAgent;
  }
  return Object.keys(headers).length ? headers : undefined;
}

/// 歌曲的 MV 可用性探测缓存（pluginId|path → 是否真能解析出 MV）。
/// 插件机制下有无 MV 只有解析那一刻才知道；起播后静默探测一次，
/// 结果决定 MV 入口显隐（会话级，刷新后清空重探）。
const mvProbeResults = new Map<string, boolean>();
const mvProbeVersion = ref(0);

function mvProbeKey(song: Song): string {
  const pluginId = song.plugin_id || String(nestedValue(song.rawData, 'pluginId') || '');
  if (!pluginId) return '';
  return `${pluginId}|${song.path}`;
}

/// 起播后静默探测：这首歌的插件是否真能解析出 MV。
/// 「插件明确无结果」写 false；网络/鉴权等异常不写缓存（下次重探），
/// 避免瞬时故障造成假阴性把有 MV 的歌错误隐藏。
export async function probeMvFor(song: Song): Promise<void> {
  const key = mvProbeKey(song);
  if (!key || mvProbeResults.has(key)) return;
  try {
    const { videoSource } = await resolveMvVideoSource(song, preferredMvQuality());
    mvProbeResults.set(key, !!videoSource?.url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e || '');
    if (msg.includes('均无结果') || msg.includes('无 MV') || msg.includes('不支持')) {
      mvProbeResults.set(key, false);
    }
  }
  mvProbeVersion.value++;
}

/// 队列批量探测：逐个错开，避让音质预探测带宽。
export async function probeQueueMvs(songs: (Song | null | undefined)[]): Promise<void> {
  let first = true;
  for (const s of songs) {
    if (!s) continue;
    const key = mvProbeKey(s);
    if (!key || mvProbeResults.has(key)) continue;
    if (!first) await new Promise(r => setTimeout(r, 900));
    first = false;
    await probeMvFor(s);
  }
}

export function supportsMusicVideo(song: Song | null | undefined): boolean {
  if (!isMusicVideoSong(song)) return false;
  // 只认真实解析结论：探测确认可解析才显示入口。
  // 未探测到结果的歌先不显示（起播批次探测完成后有 MV 的会自动出现），
  // 避免任何静态字段猜测造成「有 MV 的不显示、显示的没有 MV」。
  const key = mvProbeKey(song!);
  if (!key) return false;
  void mvProbeVersion.value; // 建立响应依赖：探测完成后入口自动刷新
  return mvProbeResults.get(key) === true;
}

/// 探测结论三态：true/false=已探测，undefined=尚未探测。
/// MV 开启中切歌用这个判断：只有「明确无 MV」才停 MV，未探测的交给
/// start 内部解析自行验证，避免探测未完成时误停正在播放的 MV。
export function mvProbeVerdict(song: Song | null | undefined): boolean | undefined {
  if (!isMusicVideoSong(song)) return false;
  const key = mvProbeKey(song!);
  if (!key) return false;
  void mvProbeVersion.value;
  return mvProbeResults.get(key);
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

const KUGOU_IDENTITY_PATTERN = /kugou|酷狗/i;
const KUGOU_MV_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36';

const KUGOU_MV_LEVELS = [
  { key: 'le', quality: '480P', height: 480 },
  { key: 'sd', quality: '720P', height: 720 },
  { key: 'hd', quality: '1080P', height: 1080 },
  { key: 'sq', quality: '1080P', height: 1080 },
  { key: 'rq', quality: '4K', height: 2160 },
];

function isKugouPluginSong(song: Song | null | undefined): boolean {
  if (!song) return false;
  const raw = song.rawData;
  const identity = [
    song.path.split('/')[2],
    song.plugin_id,
    nestedValue(raw, 'platform'),
    nestedValue(raw, 'source'),
    nestedValue(raw, 'pluginId'),
  ].filter(Boolean).join(' ');
  return KUGOU_IDENTITY_PATTERN.test(identity);
}

function extractKugouMvHash(song: Song): string {
  const raw = song.rawData;
  const mvValue = nestedValue(raw, 'mvHash') ?? nestedValue(raw, 'mv') ?? nestedValue(raw, 'mvdata');
  let hash = '';
  if (typeof mvValue === 'string') {
    hash = mvValue;
  } else if (Array.isArray(mvValue)) {
    hash = String((mvValue[0] as Record<string, unknown> | undefined)?.hash || '');
  } else if (mvValue && typeof mvValue === 'object') {
    const record = mvValue as Record<string, unknown>;
    hash = String(record.hash || record.mvHash || '');
  }
  hash = hash.trim();
  return /^[a-f\d]{32}$/i.test(hash) ? hash.toLowerCase() : '';
}

interface KugouMvEntry {
  level: (typeof KUGOU_MV_LEVELS)[number];
  stream: Record<string, any>;
}

function getKugouMvStreams(mvdata: unknown): KugouMvEntry[] {
  if (!mvdata || typeof mvdata !== 'object') return [];
  const data = mvdata as Record<string, any>;
  const streamSize = (stream: Record<string, any>) => Number(stream.filesize || stream.fileSize || stream.size || 0);
  const byQuality = new Map<string, KugouMvEntry>();
  for (const level of KUGOU_MV_LEVELS) {
    const stream = data[level.key];
    if (!stream?.downurl) continue;
    const previous = byQuality.get(level.quality);
    if (!previous || streamSize(stream) >= streamSize(previous.stream)) {
      byQuality.set(level.quality, { level, stream });
    }
  }
  return [...byQuality.values()];
}

function pickKugouMvStream(entries: KugouMvEntry[], quality: string): KugouMvEntry | null {
  if (!entries.length) return null;
  const value = String(quality || '1080P').toLowerCase();
  const target = value === '4k' ? 2160 : (Number(value.replace(/p$/, '')) || 1080);
  return entries.find(({ level }) => level.height === target)
    || entries.filter(({ level }) => level.height <= target).pop()
    || entries[0];
}

async function resolveKugouMvSource(mvHash: string, quality: string): Promise<PluginVideoSource | null> {
  const response = await pluginApi.pluginHttpRequest(
    'GET',
    `https://m.kugou.com/app/i/mv.php?cmd=100&ext=mp4&hash=${encodeURIComponent(mvHash)}`,
    { 'User-Agent': KUGOU_MV_UA, Referer: 'https://www.kugou.com/' },
    undefined,
    20000,
  );
  if (response.status < 200 || response.status >= 300) return null;
  let payload: Record<string, any>;
  try {
    payload = JSON.parse(response.body) as Record<string, any>;
  } catch {
    return null;
  }
  if (Number(payload.status) !== 1) return null;

  const entries = getKugouMvStreams(payload.mvdata);
  const selected = pickKugouMvStream(entries, quality);
  const url = firstString(selected?.stream?.downurl);
  if (!selected || !/^https?:\/\//i.test(url)) return null;

  const backupValue = selected.stream.backupdownurl || selected.stream.backupDownUrl || selected.stream.backupurl;
  const backupUrls = (Array.isArray(backupValue) ? backupValue : [backupValue])
    .filter((value): value is string => typeof value === 'string' && /^https?:\/\//i.test(value))
    .slice(0, 4);
  const durationMs = Number(selected.stream.timelength || payload.timelength) || 0;
  return {
    url,
    backupUrls,
    headers: { Referer: 'https://www.kugou.com/', 'User-Agent': KUGOU_MV_UA },
    userAgent: KUGOU_MV_UA,
    videoQuality: selected.level.quality,
    mimeType: 'video/mp4',
    codec: firstString(selected.stream.codec, selected.stream.codecs) || undefined,
    duration: durationMs > 0 ? Math.round(durationMs / 1000) : undefined,
    height: selected.level.height,
    availableVideoQualities: entries.map(({ level, stream }) => ({
      key: level.quality,
      label: level.quality,
      height: level.height,
      bitrate: Number(stream.bitrate) || undefined,
      size: Number(stream.filesize || stream.fileSize || stream.size) || undefined,
      codec: firstString(stream.codec, stream.codecs) || undefined,
    })),
  };
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
  let resolved: PluginVideoSource | null = null;
  for (const q of mvQualityLadder(quality)) {
    resolved = await pluginGetVideoSource(source, toPluginSearchResult(song), q);
    if (resolved?.url) break;
  }
  if (!resolved?.url && !isBili && isKugouPluginSong(song)) {
    const mvHash = extractKugouMvHash(song);
    if (mvHash) {
      resolved = await resolveKugouMvSource(mvHash, quality);
    }
  }
  if (!resolved?.url && isBili) {
    resolved = await resolveBilibiliVideoSource(song, quality);
  }
  if (!resolved?.url) {
    throw new Error(isBili ? '未能解析当前 Bilibili 视频' : '未能解析当前歌曲的 MV');
  }
  const headers = isBili
    ? withBilibiliHeaders(resolved.headers, resolved.userAgent)
    : mergedPluginHeaders(resolved);
  return { videoSource: resolved, headers };
}

async function runSyncAnalysis(song: Song, isBili: boolean, requestId: number): Promise<void> {
  // 已有可信偏移（历史匹配缓存）→ 直接接管音频，无需重复分析。
  const cached = syncOffsetCache.get(song.path);
  if (cached !== undefined) {
    syncOffsetSec.value = cached;
    audioTakenOver.value = true;
    return;
  }
  let audioUrl: string | null = null;
  try {
    audioUrl = usePlaybackStore().currentPlayingAudioUrl;
  } catch {
    return;
  }
  if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) return;

  try {
    const songPosSec = usePlaybackStore().currentTime || 0;
    // 局部滑动匹配：以当前播放位置为锚，容忍 MV 片头/花絮导致的对齐错位。
    let estimate = await analyzeMvAudioSyncLocal(
      videoUrl.value,
      audioUrl,
      songPosSec,
      song.remote_headers,
    );
    // 局部匹配失败时，非 B 站源回退到经典全局互相关（兼容旧行为）。
    if (!estimate && !isBili) {
      estimate = await analyzeMvAudioSync(videoUrl.value, audioUrl, song.remote_headers);
    }
    if (requestId !== requestVersion || sourceSongPath.value !== song.path) return;
    if (estimate) {
      syncOffsetSec.value = estimate.offsetSec;
      syncOffsetCache.set(song.path, estimate.offsetSec);
      // 可信对齐命中 → 整首歌改用 MV 自带音轨。
      audioTakenOver.value = true;
    } else {
      syncOffsetSec.value = 0;
      syncOffsetCache.set(song.path, 0);
      audioTakenOver.value = false;
      console.warn(`[MV自动对齐] ${song.name}: 未得出可信偏移，保持 0（本次不校正内容错位，也不接管音频）`);
    }
  } catch (e) {
    console.warn('[MV自动对齐] 分析失败，保持 0 偏移:', e);
  }
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
    phase.value = '';
    availableQualities.value = [];
    activeQuality.value = '';
    syncOffsetSec.value = 0;
    audioTakenOver.value = false;
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
    // 开关/切歌/切画质重开时，若已接管音频先还原歌曲通道。
    if (audioTakenOver.value) audioTakenOver.value = false;
    videoUrl.value = '';
    cachedVideoPath.value = '';
    sourceSongPath.value = song.path;
    loading.value = true;
    phase.value = 'resolve';
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
        phase.value = '';
        sourceSongPath.value = '';
        error.value = resolutionError instanceof Error
          ? shortMvError(resolutionError.message)
          : String(resolutionError);
      }
      throw resolutionError;
    }
    if (requestId !== requestVersion) return false;

    phase.value = 'download';
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
      phase.value = '';
      sourceSongPath.value = '';
      const message = lastDownloadError instanceof Error ? lastDownloadError.message : String(lastDownloadError || '');
      error.value = message ? shortMvError(message) : '';
      throw new Error(message ? `MV 加载失败：${shortMvError(message)}` : 'MV 加载失败');
    }

    cachedVideoPath.value = downloadedPath;
    videoUrl.value = convertFileSrc(downloadedPath);
    loading.value = false;
    phase.value = '';
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
    syncOffsetSec.value = syncOffsetCache.get(song.path) ?? 0;
    void runSyncAnalysis(song, isBili, requestId);
    return true;
  };

  const setQuality = async (qualityKey: string) => {
    if (!requested.value || !activeSong) return false;
    if (qualityKey === activeQuality.value) return true;
    return start(activeSong, qualityKey);
  };

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
    phase,
    error,
    videoUrl,
    sourceSongPath,
    availableQualities,
    activeQuality,
    lastResolvedSource,
    syncOffsetSec,
    audioTakenOver,
    start,
    stop,
    toggle,
    setQuality,
    resolveDownloadSource,
  };
}
