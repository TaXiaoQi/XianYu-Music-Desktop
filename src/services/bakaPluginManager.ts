/**
 * BakaPluginManager —— BakaMusic 系列插件独立管理器
 *
 * 基于 BakaMusic (https://github.com/Zencok/BakaMusic) 的插件系统设计，
 * 将所有 Baka/Toskysun 系列插件的操作独立为一个类，实现前后端机制分离：
 *
 * 架构：
 *   前端 BakaPluginManager (主线程)
 *     ├── 插件检测与生命周期管理
 *     ├── 音质回退映射 (newToLegacyQualityMap)
 *     ├── 歌词格式检测与构建
 *     ├── 评论获取
 *     └── 方法调用委托 → Worker 沙箱 (pluginSandboxManager)
 *
 *   Worker 沙箱 (pluginSandbox.worker.ts)
 *     ├── 插件代码隔离执行
 *     ├── env 环境构造 (getUserVariables, os, appVersion, lang)
 *     └── packages 注入 (axios, cheerio, crypto-js, dayjs 等)
 *
 *   Rust 后端
 *     ├── HTTP 请求代理 (pluginHttpRequest)
 *     ├── QMC2 音频解密 (qmc2.rs)
 *     └── 流式缓存播放 (stream_cache.rs)
 *
 * 支持的 Baka 插件方法（16 个，对齐 BakaMusic IPluginDefine）：
 *   search, getMediaSource, getMusicInfo, getLyric,
 *   getAlbumInfo, getMusicSheetInfo, getArtistWorks,
 *   getArtistInfo, importMusicSheet, importMusicItem,
 *   getTopLists, getTopListDetail, getRecommendSheetTags,
 *   getRecommendSheetsByTag, getMusicComments, getMusicDetailPageUrl
 */

import type {
  PluginSource,
  PluginSearchResult,
  PluginMusicInfo,
  PluginPlaylistSearchResult,
  QualityKey,
} from '../types';
import {
  QUALITY_META,
  ALL_QUALITY_KEYS,
  ALL_QUALITY_KEYS_DESC,
  BAKA_TO_LEGACY_QUALITY_MAP,
  normalizeQualityKey,
  resolveOnlinePlayQuality,
} from '../types';
import type { OnlineQualityFallbackBehavior } from '../types';
import { buildBakaMfLyricsRaw } from './bakaMfLyricsBuilder';
import { callSandboxMethod, isSandboxReady, getSandboxInstance, clearLastSandboxError, getLastSandboxError } from './pluginSandboxManager';
import {
  resetMediaItem,
  extractCoverUrl,
  extractArtist,
  stripHtmlTags,
  toPluginSearchResult,
  extractResultList,
  extractArtistAvatarUrl,
  qualityKeyToPluginString,
} from './pluginResultMappers';
import { isSongLevelError } from './lxPluginEngine';
import { normalizeMediaRequestHeaders, sanitizeMediaUrl } from '../utils/mediaUrl';
import { pluginHttpRequest, pluginApi } from './tauri/pluginApi';

let _logCallback: ((msg: string) => void) | null = null;

function log(msg: string) {
  try { if (_logCallback) { _logCallback(msg); } } catch { /* ignore */ }
}

/** 加载日志：直接输出到浏览器 console，便于前端排查插件目录（歌单/歌手/专辑）间歇加载问题 */
const catalogLog = (msg: string) => {
  console.log(`[CatalogLoad] ${msg}`);
  log(msg);
};

/** 汇总一次插件返回的结构，便于日志中人工判断返回了什么 */
const describeResultWrapper = (r: any): string => {
  if (!r || typeof r !== 'object') return `type=${typeof r}`;
  const keys = Object.keys(r).filter(k => k !== 'isEnd').join(',') || '空对象';
  let len = 0;
  try { len = extractResultList(r).length; } catch { /* ignore */ }
  return `keys=[${keys}] extractedLen=${len}`;
};

const firstStringField = (source: any, keys: string[]): string => {
  if (!source || typeof source !== 'object') {
    return '';
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
};

const normalizeHeaderMap = (headers: any): Record<string, string> => {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return {};
  }
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!key.trim()) continue;
    if (typeof value === 'string') {
      normalized[key] = value;
    } else if (value !== undefined && value !== null) {
      normalized[key] = String(value);
    }
  }
  return normalized;
};

const firstHeaderMap = (...candidates: any[]): Record<string, string> => {
  for (const candidate of candidates) {
    const normalized = normalizeHeaderMap(candidate);
    if (Object.keys(normalized).length > 0) {
      return normalized;
    }
  }
  return {};
};

// ==================== 类型定义 ====================

/** Baka 歌词格式（对齐 BakaMusic ILyric.LyricFormat） */
type BakaLyricFormat =
  | 'ttml' | 'lrc' | 'lrc-a2' | 'yrc' | 'qrc'
  | 'eslrc' | 'lyl' | 'lys' | 'lqe' | 'krc' | 'plain';

/** Baka 评论项（对齐 BakaMusic IComment.IComment） */
interface BakaComment {
  id?: string;
  nickName: string;
  avatar?: string;
  comment: string;
  like?: number;
  createAt?: number;
  location?: string;
  replies?: BakaComment[];
}

/** Baka 评论结果（对齐 BakaMusic IGetCommentResult） */
interface BakaCommentResult {
  isEnd?: boolean;
  data?: BakaComment[];
}

/** Baka 插件实例接口（对齐 BakaMusic IPlugin.IPluginInstance） */
interface IBakaPluginInstance {
  platform: string;
  version?: string;
  appVersion?: string;
  srcUrl?: string;
  author?: string;
  description?: string;
  cacheControl?: string;
  primaryKey?: string[];
  defaultSearchType?: string;
  supportedSearchType?: string[];
  userVariables?: any[];
  hints?: Record<string, string[]>;
  /** Baka 系列特有：12 档音质声明 */
  supportedQualities?: string[];

  search?: (query: string, page: number, type: string) => Promise<any>;
  getMediaSource?: (musicItem: any, quality: string) => Promise<any>;
  getMusicInfo?: (musicBase: any) => Promise<any>;
  getLyric?: (musicItem: any) => Promise<any>;
  getAlbumInfo?: (albumItem: any, page: number) => Promise<any>;
  getMusicSheetInfo?: (sheetItem: any, page: number) => Promise<any>;
  getArtistWorks?: (artistItem: any, page: number, type: string) => Promise<any>;
  getArtistInfo?: (artistItem: any) => Promise<any>;
  importMusicSheet?: (urlLike: string) => Promise<any>;
  importMusicItem?: (urlLike: string) => Promise<any>;
  getTopLists?: () => Promise<any>;
  getTopListDetail?: (topListItem: any, page: number) => Promise<any>;
  getRecommendSheetTags?: () => Promise<any>;
  getRecommendSheetsByTag?: (tag: any, page?: number) => Promise<any>;
  getMusicComments?: (musicItem: any, page?: number) => Promise<any>;
  getMusicDetailPageUrl?: (musicItem: any) => Promise<any>;
}

interface MediaSourceCacheEntry {
  expiresAt: number;
  value: PluginMusicInfo;
}

/** Baka 插件方法名列表（16 个，对齐 BakaMusic pluginMethodNames） */
const BAKA_PLUGIN_METHODS = [
  'search', 'getMediaSource', 'getMusicInfo', 'getLyric',
  'getAlbumInfo', 'getMusicSheetInfo', 'getArtistWorks',
  'getArtistInfo', 'importMusicSheet', 'importMusicItem',
  'getTopLists', 'getTopListDetail', 'getRecommendSheetTags',
  'getRecommendSheetsByTag', 'getMusicComments', 'getMusicDetailPageUrl',
] as const;

// ==================== 音质回退映射（对齐 BakaMusic newToLegacyQualityMap）====================

/**
 * 新音质键 → 旧插件兼容音质键映射
 *
 * Baka 插件可能使用 12 档新音质键（如 '320k', 'flac'），
 * 也可能使用旧版 MusicFree 的 4 档键（low/standard/high/super）。
 * 当新键请求失败时，回退到旧键重试。
 */
const newToLegacyQualityMap: Record<string, string> = BAKA_TO_LEGACY_QUALITY_MAP;

// Baka 音源通常需要向第三方接口换取临时直链。短时缓存可优化重复播放/切回同一首歌的等待，
// 同时避免长时间复用可能过期的 vkey/ekey。
const MEDIA_SOURCE_CACHE_TTL_MS = 3 * 60 * 1000;

function clonePluginMusicInfo(value: PluginMusicInfo): PluginMusicInfo {
  return {
    ...value,
    headers: value.headers ? { ...value.headers } : undefined,
  };
}

function getMediaItemStableId(item: PluginSearchResult, musicItem: any): string {
  const raw = item.rawData || {};
  const id = raw.songmid
    ?? raw.mid
    ?? raw.id
    ?? raw.songid
    ?? musicItem.songmid
    ?? musicItem.mid
    ?? musicItem.id
    ?? musicItem.songid
    ?? item.id
    ?? item.title;
  return String(id ?? '').trim();
}

function buildMediaSourceCacheKey(
  source: PluginSource,
  item: PluginSearchResult,
  musicItem: any,
  quality: QualityKey | 'standard' | 'high' | 'lossless',
  fallbackBehavior: OnlineQualityFallbackBehavior,
  availableQualities: QualityKey[] | null,
): string {
  const stableId = getMediaItemStableId(item, musicItem);
  const availableKey = availableQualities?.length
    ? [...availableQualities].sort((a, b) => QUALITY_META[a].rank - QUALITY_META[b].rank).join(',')
    : '';
  return [
    source.id,
    stableId,
    quality,
    fallbackBehavior,
    availableKey,
  ].join('|');
}

/**
 * 从插件返回的媒体 URL 参数中推断实际播放音质。
 *
 * 有些 Baka/MF 插件在请求高音质（如 master）时，会在插件内部自动降级，
 * 但仍返回一个可播放 URL，例如 `level=standard`。这种情况下不能继续把
 * 底部栏显示为 master，应以 URL 中的实际 level/quality 参数为准。
 */
function inferActualQualityFromMediaUrl(urlLike: string, fallback?: QualityKey): QualityKey | undefined {
  const legacyToQuality: Record<string, QualityKey> = {
    low: '128k',
    standard: '128k',
    high: '320k',
    exhigh: '320k',
    super: 'flac',
    lossless: 'flac',
  };

  try {
    const url = new URL(urlLike);
    const candidates = ['quality', 'level', 'br', 'bitrate', 'rate']
      .map(key => url.searchParams.get(key))
      .filter((value): value is string => !!value);

    for (const raw of candidates) {
      const cleaned = raw.trim().replace(/[,`'"\s]+$/g, '');
      const normalized = normalizeQualityKey(cleaned);
      if (normalized) return normalized;

      const legacy = legacyToQuality[cleaned.toLowerCase()];
      if (legacy) return legacy;
    }
  } catch {
    // ignore invalid URL
  }

  return fallback;
}

function normalizeSupportedQualities(raw: unknown): QualityKey[] | null {
  if (!Array.isArray(raw)) return null;
  const supported = raw
    .map(q => normalizeQualityKey(q))
    .filter((q): q is QualityKey => !!q);
  return supported.length > 0 ? Array.from(new Set(supported)) : null;
}

function extractOnlySupportedQuality(errMsg: string): QualityKey | undefined {
  const text = errMsg.toLowerCase();
  if (!/(仅支持|只支持|只可使用|only\s+supports?|support\s+only|supports?\s+only)/i.test(errMsg)) {
    return undefined;
  }

  for (const quality of ALL_QUALITY_KEYS_DESC) {
    if (text.includes(quality.toLowerCase())) return quality;
  }

  const legacyAliases: Record<string, QualityKey> = {
    standard: '128k',
    low: '128k',
    high: '320k',
    exhigh: '320k',
    super: 'flac',
    lossless: 'flac',
  };
  for (const [alias, quality] of Object.entries(legacyAliases)) {
    if (text.includes(alias)) return quality;
  }

  const bitrateMatch = text.match(/(?:^|[^\d])(\d{2,4})\s*k(?:bps)?(?:$|[^\d])/);
  if (bitrateMatch) {
    return normalizeQualityKey(`${bitrateMatch[1]}k`) ?? undefined;
  }

  return undefined;
}

function isFatalMediaSourceError(errMsg: string): boolean {
  return /解密\s*playauth\s*失败|decrypt\s*playauth\s*failed|playauth/i.test(errMsg);
}

function isKugouLikeSource(source: PluginSource, mediaItem: any): boolean {
  const text = [
    source.name,
    source.id,
    mediaItem?.platform,
    mediaItem?.source,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return text.includes('酷狗') || text.includes('kugou') || /\bkg\b/.test(text);
}

/**
 * 酷狗插件专用 URL 清洗器。
 *
 * 酷狗（含赞助版）插件返回的 URL 常被反引号包裹、尾部带逗号，
 * 且通用 sanitizeMediaUrl 在某些环境下可能无法正确剥离。
 * 此方法使用白名单策略：从 http(s):// 开始，从尾部逐字符检查，
 * 只保留 URL 合法字符，遇到任何非法字符即截断。
 */
function cleanKugouPluginUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '';

  // Step 1: 用 indexOf 定位 http(s):// 起点
  const httpsIdx = raw.indexOf('https://');
  const httpIdx = raw.indexOf('http://');
  let start: number;
  if (httpsIdx >= 0 && (httpIdx < 0 || httpsIdx <= httpIdx)) {
    start = httpsIdx;
  } else if (httpIdx >= 0) {
    start = httpIdx;
  } else {
    console.warn('[cleanKugouPluginUrl] 未找到 http(s)://:', {
      raw: raw.substring(0, 120),
      first10Codes: raw.substring(0, 10).split('').map(c => '0x' + c.charCodeAt(0).toString(16)).join(','),
    });
    return '';
  }

  // Step 2: 从起点截取到末尾
  let url = raw.substring(start);

  // Step 3: 白名单剥离尾部 —— 只保留 URL 合法字符
  // 合法：字母、数字、/:?&=_-.~#+%@
  while (url.length > 0) {
    const c = url.charCodeAt(url.length - 1);
    const isAllowed =
      (c >= 0x30 && c <= 0x39)  // 0-9
      || (c >= 0x41 && c <= 0x5a)  // A-Z
      || (c >= 0x61 && c <= 0x7a)  // a-z
      || c === 0x2f  // /
      || c === 0x3a  // :
      || c === 0x3f  // ?
      || c === 0x26  // &
      || c === 0x3d  // =
      || c === 0x5f  // _
      || c === 0x2d  // -
      || c === 0x2e  // .
      || c === 0x7e  // ~
      || c === 0x23  // #
      || c === 0x2b  // +
      || c === 0x25  // %
      || c === 0x40; // @
    if (isAllowed) break;
    url = url.substring(0, url.length - 1);
  }

  return url;
}

function getHeaderValue(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return '';
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value || '';
  }
  return '';
}

function isAudioLikeContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  return lower.startsWith('audio/')
    || lower.includes('application/octet-stream')
    || lower.includes('application/vnd.apple.mpegurl')
    || lower.includes('application/x-mpegurl');
}

function isTextLikeContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  return lower.includes('application/json')
    || lower.startsWith('text/')
    || lower.includes('application/xml')
    || lower.includes('application/javascript');
}

function isLikelyKugouProxyApiUrl(urlLike: string): boolean {
  try {
    const url = new URL(urlLike);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    return (
      host.includes('haitangw.cc')
      || path.includes('/kgqq/')
      || path.endsWith('/kg.php')
    ) && (
      path.endsWith('.php')
      || url.searchParams.has('type')
      || url.searchParams.has('level')
    );
  } catch {
    return false;
  }
}

function jsonValueHasPlayableUrl(value: unknown): boolean {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return /^https?:\/\//i.test(trimmed);
  }
  if (Array.isArray(value)) {
    return value.some(jsonValueHasPlayableUrl);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some(jsonValueHasPlayableUrl);
  }
  return false;
}

function responseBodyHasPlayableUrl(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  try {
    return jsonValueHasPlayableUrl(JSON.parse(trimmed));
  } catch {
    return /https?:\/\/[^\s"'<>}]+/i.test(trimmed);
  }
}

function responseBodyLooksLikeDefiniteError(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return false;
  try {
    const parsed = JSON.parse(trimmed);
    if (jsonValueHasPlayableUrl(parsed)) return false;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const code = record.code ?? record.status ?? record.errCode ?? record.errorCode;
      const msg = String(record.msg ?? record.message ?? record.error ?? '').toLowerCase();
      return code !== undefined || /error|fail|失败|无版权|付费|会员|不存在|为空/.test(msg);
    }
  } catch {
    // 非 JSON 交给调用方继续按 URL/文本判断。
  }
  return false;
}

function formatProxyErrorReason(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '代理接口返回空错误';
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const code = record.code ?? record.status ?? record.errCode ?? record.errorCode;
      const msg = record.msg ?? record.message ?? record.error;
      const parts = [
        '源站代理接口返回错误',
        code !== undefined ? `code=${String(code)}` : '',
        msg ? `msg=${String(msg)}` : '',
      ].filter(Boolean);
      return `${parts.join('，')}。请检查插件用户变量/Source API Key/卡密，或稍后重试该源站`;
    }
  } catch {
    // 非 JSON 直接截断展示。
  }
  return `源站代理接口返回错误：${trimmed.slice(0, 120)}`;
}

async function probeKugouProxyCandidate(
  url: string,
  headers: Record<string, string>,
): Promise<{ playable: boolean; reason?: string }> {
  try {
    const probeHeaders: Record<string, string> = { ...headers, Accept: '*/*' };
    if (!Object.keys(probeHeaders).some(key => key.toLowerCase() === 'range')) {
      probeHeaders.Range = 'bytes=0-4095';
    }
    const headResp = await pluginHttpRequest('HEAD', url, probeHeaders, undefined, 8, 3);
    if (headResp.status >= 400) {
      // 部分代理接口不支持 HEAD。此时不直接判失败，交给 GET 正文判断；
      // 如果 GET 也失败，才跳过该音质。
      const getResp = await pluginHttpRequest('GET', url, probeHeaders, undefined, 8, 3);
      if (getResp.status >= 400) {
        return { playable: false, reason: `GET HTTP ${getResp.status}` };
      }
      if (responseBodyHasPlayableUrl(getResp.body)) {
        return { playable: true };
      }
      if (responseBodyLooksLikeDefiniteError(getResp.body)) {
        return { playable: false, reason: formatProxyErrorReason(getResp.body) };
      }
      return { playable: true };
    }

    const headContentType = getHeaderValue(headResp.headers, 'content-type');
    if (isAudioLikeContentType(headContentType)) {
      return { playable: true };
    }

    if (!isTextLikeContentType(headContentType)) {
      return { playable: true };
    }

    const getResp = await pluginHttpRequest('GET', url, probeHeaders, undefined, 8, 3);
    if (getResp.status >= 400) {
      return { playable: false, reason: `GET HTTP ${getResp.status}` };
    }

    if (responseBodyHasPlayableUrl(getResp.body)) {
      return { playable: true };
    }
    if (responseBodyLooksLikeDefiniteError(getResp.body)) {
      return { playable: false, reason: formatProxyErrorReason(getResp.body) };
    }

    return { playable: true };
  } catch (error: any) {
    // 探测失败不应误杀候选 URL，保留 Rust 播放链路的最终提取/重试能力。
    return { playable: true, reason: error?.message || String(error || '') };
  }
}

function readQualityHash(mediaItem: any, qualityKey: QualityKey): string {
  const qualities = mediaItem?.qualities;
  const fromQuality = qualities?.[qualityKey]?.hash;
  if (typeof fromQuality === 'string' && fromQuality.trim()) return fromQuality.trim();

  switch (qualityKey) {
    case '320k':
      return String(mediaItem?.['320hash'] || '').trim();
    case 'flac':
      return String(mediaItem?.sqhash || mediaItem?.SQFileHash || '').trim();
    case 'flac24bit':
    case 'hires':
    case 'master':
    case 'vinyl':
    case 'dolby':
    case 'atmos':
    case 'atmos_plus':
      return String(
        mediaItem?.ResFileHash ||
        mediaItem?.origin_hash ||
        mediaItem?.sqhash ||
        mediaItem?.SQFileHash ||
        '',
      ).trim();
    default:
      return '';
  }
}

function adaptKugouMediaItemForQuality(mediaItem: any, qualityKey: QualityKey): any {
  const selectedHash = readQualityHash(mediaItem, qualityKey);
  if (!selectedHash) {
    return mediaItem;
  }

  const adapted = { ...mediaItem };

  if (qualityKey === '128k' || qualityKey === '192k' || qualityKey === 'mgg') {
    adapted.id = selectedHash;
    adapted.hash = adapted.id;
    adapted.sqhash = undefined;
    adapted.ResFileHash = undefined;
    return adapted;
  }

  if (qualityKey === '320k') {
    adapted.id = selectedHash;
    adapted.hash = selectedHash;
    adapted['320hash'] = selectedHash;
    adapted.sqhash = undefined;
    adapted.ResFileHash = undefined;
    return adapted;
  }

  adapted.id = selectedHash;
  adapted.hash = selectedHash;
  if (qualityKey === 'flac') {
    adapted.sqhash = selectedHash;
  } else {
    adapted.ResFileHash = selectedHash;
    adapted.sqhash = selectedHash;
  }
  return adapted;
}

function adaptMediaItemForPluginQuality(
  source: PluginSource,
  mediaItem: any,
  qualityKey: QualityKey,
): any {
  if (isKugouLikeSource(source, mediaItem)) {
    return adaptKugouMediaItemForQuality(mediaItem, qualityKey);
  }

  return mediaItem;
}

/**
 * Baka/Toskysun 插件的稳定识别锚点：声明 Baka 新音质能力。
 *
 * BakaMusic 插件 API 向下兼容 MusicFree，但 `supportedQualities` 使用
 * 96k/128k/320k/flac/hires/master 等原生音质键。不能要求插件一次声明完整
 * 12 档，否则只声明部分档位的 Baka 系插件会被误判成 MF，进而被传入
 * standard/high/lossless 导致“不支持音质”。
 */
const isBakaSupportedQualities = (raw: unknown): raw is string[] => {
  if (!Array.isArray(raw)) return false;

  const normalized = new Set(
    raw
      .map(q => normalizeQualityKey(q))
      .filter((q): q is QualityKey => !!q),
  );

  return ALL_QUALITY_KEYS.some(q => normalized.has(q));
};

/**
 * 检测插件实例（或沙箱元数据）是否实现了评论区 API `getMusicComments`。
 *
 * 这是最可靠的 Baka 特征：原版 MusicFree 及时迁酱系列插件都不实现该方法。
 * 沙箱元数据用 `_availableMethods` 数组声明实现的方法名；全局实例则可直接
 * 检查 `getMusicComments` 是否为函数。
 */
const hasCommentApi = (meta: any): boolean => {
  if (!meta) return false;
  if (Array.isArray(meta._availableMethods) && meta._availableMethods.includes('getMusicComments')) {
    return true;
  }
  return typeof meta.getMusicComments === 'function';
};

/**
 * 已知的 MusicFree 插件作者（小写）。
 *
 * 这些作者的插件虽然可能声明 Baka 风格的 supportedQualities，但本质是
 * 原版 MusicFree 插件，必须强制排除以免被能力检测误判为 Baka。
 * 例如「时迁酱」的 v7 系列音源。
 */
const NON_BAKA_PLUGIN_AUTHORS = ['时迁酱'];

// ==================== 歌词格式检测 ====================

/**
 * 根据歌词内容检测格式（对齐 BakaMusic getLyricFormat）
 *
 * Baka 插件可能返回多种歌词格式，优先级：
 * ttml > yrc > qrc > eslrc > lrc-a2 > lyl > lys > lqe > lrc > plain
 */
function detectLyricFormat(content: string): BakaLyricFormat {
  const trimmed = content.trim();
  if (!trimmed) return 'plain';

  // TTML: XML 格式
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<tt') || trimmed.includes('<tt ')) {
    return 'ttml';
  }

  // YRC: 网易云逐字格式，以 [开头的 JSON-like 结构
  if (trimmed.startsWith('{') && trimmed.includes('"content"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.lyric?.length || parsed?.content?.length) return 'yrc';
    } catch { /* not JSON */ }
  }

  // QRC: QQ 音乐逐字格式，包含 [ti:] 等标签 + 逐字时间戳
  if (/^\[(?:ti|ar|al|by|offset):/.test(trimmed) && /\[\d+,\d+\]/.test(trimmed)) {
    return 'qrc';
  }

  // ESLRC: 增强型 LRC 逐字格式
  if (/\[\d+:\d+\.\d+\]<\d+:\d+\.\d+>/.test(trimmed)) {
    return 'eslrc';
  }

  // KRC: 酷狗逐字格式，[行开始,行时长]字(字偏移,字时长)
  if (/^\[\d+,\d+].*\(-?\d+,-?\d+(?:,-?\d+)?\)/m.test(trimmed)) {
    return 'krc';
  }

  // LRC-A2 (ALRC): 高级 LRC 格式
  if (trimmed.includes('[ti:') && trimmed.includes('[al:')) {
    return 'lrc-a2';
  }

  // LYL: 自定义逐字格式
  if (/<\d+>/.test(trimmed) && /\[\d+:\d+\.\d+\]/.test(trimmed)) {
    return 'lyl';
  }

  // LYS: 另一种逐字格式
  if (/^\{.*"startTime".*"endTime".*\}/m.test(trimmed)) {
    return 'lys';
  }

  // LQE: 歌词质量增强格式
  if (trimmed.startsWith('[lqe:') || trimmed.includes('[lqe:')) {
    return 'lqe';
  }

  // 标准 LRC
  if (/\[\d+:\d+\.\d+\]/.test(trimmed) || /\[\d+:\d+\]/.test(trimmed)) {
    return 'lrc';
  }

  return 'plain';
}

// ==================== BakaPluginManager 类 ====================

/**
 * Baka 插件管理器（单例）
 *
 * 职责：
 *   1. 检测 Baka 插件（通过 supportedQualities 字段）
 *   2. 管理音质回退（newToLegacyQualityMap）
 *   3. 获取播放 URL（getMediaSource，带新→旧音质回退）
 *   4. 获取歌词（getLyric，支持所有 Baka 歌词格式）
 *   5. 获取评论（getMusicComments）
 *   6. 获取音乐信息（getMusicInfo）
 *   7. 搜索（search，支持 music/album/artist/sheet 类型）
 *   8. 其他 Baka 插件方法（getAlbumInfo, getArtistWorks 等）
 *
 * 所有方法调用通过 pluginSandboxManager 的 RPC 机制委托到 Worker 沙箱执行，
 * 主线程只负责编排逻辑和结果映射。
 */
class BakaPluginManagerClass {
  /** 已检测的 Baka 插件 ID 缓存 */
  private _bakaPluginCache = new Map<string, boolean>();
  /** Baka 播放直链短时缓存 */
  private _mediaSourceCache = new Map<string, MediaSourceCacheEntry>();
  /** 同一首歌同一音质的并发解析复用，避免重复请求音源接口 */
  private _mediaSourcePending = new Map<string, Promise<PluginMusicInfo | null>>();

  clearMediaSourceCache(pluginId?: string) {
    if (!pluginId) {
      this._mediaSourceCache.clear();
      this._mediaSourcePending.clear();
      return;
    }
    const prefix = `${pluginId}|`;
    for (const key of this._mediaSourceCache.keys()) {
      if (key.startsWith(prefix)) this._mediaSourceCache.delete(key);
    }
    for (const key of this._mediaSourcePending.keys()) {
      if (key.startsWith(prefix)) this._mediaSourcePending.delete(key);
    }
  }

  // ==================== 插件检测 ====================

  /**
   * 检测插件是否为 Baka/Toskysun 系列
   *
   * Baka 插件在实例上声明 `supportedQualities` 数组字段（可为完整或部分新音质键）。
   * 原版 MusicFree 插件无此字段，或仅走 standard/high/lossless。
   */
  async isBakaPlugin(source: PluginSource): Promise<boolean> {
    // 作者名判定优先于能力检测：部分 MusicFree 插件（如时迁酱系列）也声明了
    // Baka 风格的 supportedQualities，仅凭能力检测会误判，因此以作者归属为准。
    const author = (source.author || '').toLowerCase();

    // Toskysun 是 BakaMusic 的开发者，作者名匹配则强制判定为 Baka。
    if (author.includes('toskysun')) {
      this._bakaPluginCache.set(source.id, true);
      return true;
    }

    // 已知的 MusicFree 插件作者：强制排除，不走能力检测（避免误判为 Baka）。
    if (NON_BAKA_PLUGIN_AUTHORS.some(name => author.includes(name))) {
      this._bakaPluginCache.set(source.id, false);
      return false;
    }

    const cached = this._bakaPluginCache.get(source.id);
    // true 可以稳定缓存；false 可能是插件尚未加载完成时的临时误判，
    // 因此在沙箱就绪后允许重新检测一次，避免 Baka/Toskysun 插件误走 MF 三档兼容路径。
    if (cached === true) return true;
    if (cached === false && !isSandboxReady(source.id)) return false;

    const result = await this._detectBakaPlugin(source);
    this._bakaPluginCache.set(source.id, result);
    return result;
  }

  private async _detectBakaPlugin(source: PluginSource): Promise<boolean> {
    // 注：Toskysun 作者名的判定已在 isBakaPlugin 入口处理，此处专注运行时能力检测。

    // 从沙箱元数据检测
    if (isSandboxReady(source.id)) {
      const meta = getSandboxInstance(source.id);
      // getMusicComments（评论区 API）是最可靠的 Baka 特征：
      // 原版 MusicFree 及时迁酱系列插件都不实现该方法。
      if (hasCommentApi(meta)) return true;
      if (isBakaSupportedQualities(meta?.supportedQualities)) {
        return true;
      }
    }

    // 从全局实例缓存检测
    const _globalThis = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {} as any);
    const instances = _globalThis.__pluginInstances as Map<string, any> | undefined;
    if (instances) {
      const inst = instances.get(source.id);
      if (hasCommentApi(inst?.instance)) return true;
      if (isBakaSupportedQualities(inst?.instance?.supportedQualities)) {
        return true;
      }
    }
    return false;
  }

  /** 清除插件检测缓存（插件更新/卸载时调用） */
  clearCache(pluginId?: string): void {
    if (pluginId) {
      this._bakaPluginCache.delete(pluginId);
    } else {
      this._bakaPluginCache.clear();
    }
  }

  // ==================== 音质管理 ====================

  /**
   * 获取插件声明的支持音质列表
   *
   * Baka 插件使用 12 档新键值（如 '320k'、'flac'、'master'）。
   * 映射 '96k' → 'mgg' 以对齐本项目的 QualityKey 枚举。
   */
  async getSupportedQualities(source: PluginSource): Promise<QualityKey[] | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    const raw = inst.supportedQualities;
    if (Array.isArray(raw)) {
      const supported = raw
        .map(q => normalizeQualityKey(q))
        .filter((q): q is QualityKey => !!q);
      if (supported.length > 0) {
        return supported;
      }
    }
    return ['128k', '320k', 'flac'];
  }

  // ==================== 播放 URL 获取（核心方法）====================

  /**
   * 获取 Baka 插件播放 URL
   *
   * 与 MusicFree 插件完全分离，使用 12 档原生音质键值。
   * 内置 newToLegacyQualityMap 回退：新键失败时自动回退到旧键。
   *
   * @param source 插件源
   * @param item 搜索结果项
   * @param quality 目标音质
   * @param fallbackBehavior 回退行为
   * @param availableQualities 可用音质列表
   */
  async getMediaSource(
    source: PluginSource,
    item: PluginSearchResult,
    quality: QualityKey | 'standard' | 'high' | 'lossless' = '320k',
    fallbackBehavior: OnlineQualityFallbackBehavior = 'lower',
    availableQualities: QualityKey[] | null = null,
  ): Promise<PluginMusicInfo | null> {
    const musicItem = item.rawData
      ? resetMediaItem(item.rawData, source.name)
      : resetMediaItem(item, source.name);
    const cacheKey = buildMediaSourceCacheKey(source, item, musicItem, quality, fallbackBehavior, availableQualities);
    const now = Date.now();
    const isKugou = isKugouLikeSource(source, musicItem);
    const cached = this._mediaSourceCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      const cachedValue = clonePluginMusicInfo(cached.value);
      if (isKugou && cachedValue.url && isLikelyKugouProxyApiUrl(cachedValue.url)) {
        const probe = await probeKugouProxyCandidate(cachedValue.url, cachedValue.headers || {});
        if (probe.playable) {
          log(`[getMediaSource] 命中短时缓存: ${source.name}, id=${getMediaItemStableId(item, musicItem)}, quality=${quality}`);
          return cachedValue;
        }
        log(`[getMediaSource] 短时缓存中的酷狗代理URL已失效，删除缓存并重新解析: ${probe.reason || cachedValue.url}`);
        this._mediaSourceCache.delete(cacheKey);
      } else {
        log(`[getMediaSource] 命中短时缓存: ${source.name}, id=${getMediaItemStableId(item, musicItem)}, quality=${quality}`);
        return cachedValue;
      }
    }
    if (cached) {
      this._mediaSourceCache.delete(cacheKey);
    }

    const pending = this._mediaSourcePending.get(cacheKey);
    if (pending) {
      log(`[getMediaSource] 复用进行中的直链解析: ${source.name}, id=${getMediaItemStableId(item, musicItem)}, quality=${quality}`);
      const value = await pending;
      return value ? clonePluginMusicInfo(value) : null;
    }

    const pendingPromise = this._getMediaSourceUncached(source, item, quality, fallbackBehavior, availableQualities)
      .then((value) => {
        if (value?.url) {
          this._mediaSourceCache.set(cacheKey, {
            expiresAt: Date.now() + MEDIA_SOURCE_CACHE_TTL_MS,
            value: clonePluginMusicInfo(value),
          });
        }
        return value;
      })
      .finally(() => {
        this._mediaSourcePending.delete(cacheKey);
      });
    this._mediaSourcePending.set(cacheKey, pendingPromise);
    const value = await pendingPromise;
    return value ? clonePluginMusicInfo(value) : null;
  }

  private async _getMediaSourceUncached(
    source: PluginSource,
    item: PluginSearchResult,
    quality: QualityKey | 'standard' | 'high' | 'lossless' = '320k',
    fallbackBehavior: OnlineQualityFallbackBehavior = 'lower',
    availableQualities: QualityKey[] | null = null,
  ): Promise<PluginMusicInfo | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    if (typeof inst.getMediaSource !== 'function') {
      log(`[${source.name}] 无 getMediaSource 函数`);
      return null;
    }

    const musicItem = item.rawData
      ? resetMediaItem(item.rawData, source.name)
      : resetMediaItem(item, source.name);

    const isQualityKey = (q: string): q is QualityKey => q in QUALITY_META;

    // 构建音质尝试列表：始终使用 12 档原生键值
    const tryPairs: Array<{ pluginQ: string; qualityKey: QualityKey }> = [];

    const declaredAvailableQualities = normalizeSupportedQualities(inst.supportedQualities);
    const effectiveAvailableQualities = availableQualities?.length ? availableQualities : declaredAvailableQualities;

    if (isQualityKey(quality) && effectiveAvailableQualities && effectiveAvailableQualities.length > 0) {
      const resolvedKeys = resolveOnlinePlayQuality(quality, effectiveAvailableQualities, fallbackBehavior);
      for (const q of resolvedKeys) {
        tryPairs.push({ pluginQ: qualityKeyToPluginString(q), qualityKey: q });
      }
    } else if (isQualityKey(quality)) {
      if (fallbackBehavior === 'pause') {
        tryPairs.push({ pluginQ: qualityKeyToPluginString(quality), qualityKey: quality });
      } else if (fallbackBehavior === 'higher') {
        const startIdx = ALL_QUALITY_KEYS.indexOf(quality);
        if (startIdx !== -1) {
          for (let i = startIdx; i < ALL_QUALITY_KEYS.length; i++) {
            tryPairs.push({ pluginQ: qualityKeyToPluginString(ALL_QUALITY_KEYS[i]), qualityKey: ALL_QUALITY_KEYS[i] });
          }
        } else {
          tryPairs.push({ pluginQ: qualityKeyToPluginString(quality), qualityKey: quality });
        }
      } else {
        const startIdx = ALL_QUALITY_KEYS_DESC.indexOf(quality);
        if (startIdx !== -1) {
          for (let i = startIdx; i < ALL_QUALITY_KEYS_DESC.length; i++) {
            tryPairs.push({ pluginQ: qualityKeyToPluginString(ALL_QUALITY_KEYS_DESC[i]), qualityKey: ALL_QUALITY_KEYS_DESC[i] });
          }
        } else {
          tryPairs.push({ pluginQ: qualityKeyToPluginString(quality), qualityKey: quality });
        }
      }
    } else {
      tryPairs.push({ pluginQ: quality, qualityKey: '320k' });
    }

    log(`[getMediaSource] 调用 ${source.name}, id=${musicItem.id}, platform=${musicItem.platform}, tryQualities=${JSON.stringify(tryPairs.map(p => p.pluginQ))}`);
    (globalThis as any).__lastPluginError = '';

    let result: any = null;
    let lastError: any = null;
    let successPairIdx = -1;
    let songLevelErrorDetected = false;
    let nextPairIdxOverride: number | null = null;
    const attemptedPluginQualities = new Set<string>();
    const isKugou = isKugouLikeSource(source, musicItem);
    const shouldAcceptMediaResult = async (candidate: any, pairIdx: number, qualityLabel: string): Promise<boolean> => {
      const candidateRawUrl = typeof candidate?.url === 'string' ? candidate.url : '';
      if (!candidateRawUrl) return false;

      const candidateUrl = isKugou ? cleanKugouPluginUrl(candidateRawUrl) : sanitizeMediaUrl(candidateRawUrl);
      if (isKugou && candidateUrl && isLikelyKugouProxyApiUrl(candidateUrl)) {
        const candidateHeaders = normalizeMediaRequestHeaders(
          candidateUrl,
          firstHeaderMap(candidate.headers, candidate.header, candidate.requestHeaders),
        ) || {};
        const probe = await probeKugouProxyCandidate(candidateUrl, candidateHeaders);
        if (!probe.playable) {
          lastError = new Error(probe.reason || '代理接口未返回可播放地址');
          log(`[getMediaSource] quality=${qualityLabel} 返回的代理URL不可播放，继续下一档: ${probe.reason || candidateUrl}`);
          return false;
        }
      }

      successPairIdx = pairIdx;
      return true;
    };

    for (let pairIdx = 0; pairIdx < tryPairs.length; pairIdx++) {
      const q = tryPairs[pairIdx].pluginQ;
      const attemptMusicItem = adaptMediaItemForPluginQuality(source, musicItem, tryPairs[pairIdx].qualityKey);
      if (attemptedPluginQualities.has(q)) {
        log(`[getMediaSource] quality=${q} 已尝试过，跳过重复调用`);
        result = null;
        continue;
      }
      attemptedPluginQualities.add(q);

      try {
        clearLastSandboxError();
        result = await inst.getMediaSource(attemptMusicItem, q);
        if (result?.url) {
          if (await shouldAcceptMediaResult(result, pairIdx, q)) {
            break;
          }
          result = null;
        }

        const sandboxErr = getLastSandboxError();
        if (!result?.url && sandboxErr && isFatalMediaSourceError(sandboxErr)) {
          log(`[getMediaSource] 沙箱日志检测到致命错误，跳过剩余音质: ${sandboxErr}`);
          songLevelErrorDetected = true;
          break;
        }

        // 新键无结果，尝试旧键回退（对齐 BakaMusic newToLegacyQualityMap）。
        // 当用户选择"暂停/不回退"时，不再尝试旧键，避免绕过设置继续刷请求。
        const legacyQ = fallbackBehavior === 'pause' ? undefined : newToLegacyQualityMap[q];
        if (!result?.url && legacyQ && legacyQ !== q) {
          if (attemptedPluginQualities.has(legacyQ)) {
            log(`[getMediaSource] legacy quality=${legacyQ} 已尝试过，跳过重复回退`);
          } else {
            attemptedPluginQualities.add(legacyQ);
            log(`[getMediaSource] quality=${q} 无结果，回退到旧键: ${legacyQ}`);
            clearLastSandboxError();
            result = await inst.getMediaSource(attemptMusicItem, legacyQ);
            if (result?.url) {
              if (await shouldAcceptMediaResult(result, pairIdx, legacyQ)) {
                break;
              }
              result = null;
            }
            const legacySandboxErr = getLastSandboxError();
            if (!result?.url && legacySandboxErr && isFatalMediaSourceError(legacySandboxErr)) {
              log(`[getMediaSource] 沙箱日志检测到致命错误(legacy)，跳过剩余音质: ${legacySandboxErr}`);
              songLevelErrorDetected = true;
              break;
            }
          }
        }
      } catch (e: any) {
        lastError = e;
        const errMsg = e?.message || (typeof e === 'string' ? e : String(e || ''));
        log(`[getMediaSource] quality=${q} 异常: ${errMsg}`);
        if (isSongLevelError(errMsg) || isFatalMediaSourceError(errMsg)) {
          log(`[getMediaSource] 歌曲级/致命错误，跳过剩余音质: ${errMsg}`);
          songLevelErrorDetected = true;
          break;
        }
        const onlySupportedQuality = fallbackBehavior === 'pause' ? undefined : extractOnlySupportedQuality(errMsg);
        if (onlySupportedQuality) {
          let targetIdx = tryPairs.findIndex(pair => pair.qualityKey === onlySupportedQuality);
          if (targetIdx < 0) {
            targetIdx = tryPairs.length;
            tryPairs.push({
              pluginQ: qualityKeyToPluginString(onlySupportedQuality),
              qualityKey: onlySupportedQuality,
            });
          }
          if (targetIdx >= 0 && targetIdx !== pairIdx) {
            log(`[getMediaSource] 插件提示仅支持 ${onlySupportedQuality}，跳过中间音质直接尝试`);
            nextPairIdxOverride = targetIdx;
          } else {
            log(`[getMediaSource] 插件声明当前仅支持 ${onlySupportedQuality} 但仍失败，停止重复重试`);
          }
        }
      }
      if (songLevelErrorDetected) break;
      if (nextPairIdxOverride !== null) {
        pairIdx = nextPairIdxOverride - 1;
        nextPairIdxOverride = null;
        result = null;
        continue;
      }
      if (result?.url) break;
      log(`[getMediaSource] quality=${q} 未返回有效URL，尝试下一档`);
      result = null;
    }

    if (!result || typeof result !== 'object') {
      const errMsg = lastError ? `异常: ${lastError.message}` : (result === null ? '返回null' : `非对象(${typeof result})`);
      log(`[getMediaSource] ${source.name} 失败: ${errMsg}`);
      (globalThis as any).__lastPluginError = `[${source.name}] ${errMsg}`;
      return null;
    }

    const rawUrl = typeof result.url === 'string' ? result.url : '';

    // 酷狗插件专用 URL 清洗：白名单策略，比通用方法更激进
    let url: string;
    if (isKugou) {
      url = cleanKugouPluginUrl(rawUrl);
      // 如果专用方法失败，回退到通用方法
      if (!url || !/^https?:\/\//.test(url)) {
        console.warn('[BakaPluginManager] 酷狗专用清洗失败，回退到通用 sanitizeMediaUrl');
        url = sanitizeMediaUrl(rawUrl);
      }
    } else {
      url = sanitizeMediaUrl(rawUrl);
    }

    // 通用兜底：如果清洗后仍不以 http 开头，用 indexOf 强制提取
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      const idx1 = rawUrl.indexOf('https://');
      const idx2 = rawUrl.indexOf('http://');
      const idx = idx1 >= 0 ? idx1 : idx2;
      if (idx >= 0) {
        console.warn('[BakaPluginManager] 通用清洗未生效，indexOf 兜底提取:', {
          sanitized: url.slice(0, 120),
          firstChars: rawUrl.slice(0, 5).split('').map((c: string) => '0x' + c.charCodeAt(0).toString(16)).join(','),
          lastChars: rawUrl.slice(-5).split('').map((c: string) => '0x' + c.charCodeAt(0).toString(16)).join(','),
        });
        url = rawUrl.substring(idx);
        while (url.length > 0) {
          const c = url.charCodeAt(url.length - 1);
          if (c === 0x2c || c === 0x3b || c === 0x60 || c === 0x27 || c === 0x22 || c <= 0x20) {
            url = url.substring(0, url.length - 1);
          } else break;
        }
      }
    }
    const headers = normalizeMediaRequestHeaders(
      url,
      firstHeaderMap(result.headers, result.header, result.requestHeaders),
    ) || {};
    const ekey = firstStringField(result, ['ekey', 'eKey', 'encryptKey', 'encryptionKey', 'qmcKey', 'qmc2Key']);
    const cek = firstStringField(result, ['cek', 'cKey', 'contentKey', 'decryptKey', 'decryptionKey', 'cencKey']);
    const lyric = result.lyric || result.rawLrc || result.lrc || '';
    const ttml = result.ttml || '';
    const tlyric = result.tlyric || result.translation || '';
    const lxlyric = result.lxlyric || '';
    const yrc = result.yrc || '';
    const qrc = result.qrc || '';
    const eslrc = result.eslrc || '';
    const coverUrl = extractCoverUrl(result) || result.coverUrl || result.artwork || '';

    if (!url) {
      log(`[getMediaSource] ${source.name} 返回空URL, result=${JSON.stringify(result)?.substring(0, 200)}`);
      (globalThis as any).__lastPluginError = `[${source.name}] 返回空URL`;
      return null;
    }
    if (rawUrl && rawUrl !== url) {
      log(`[getMediaSource] 已清洗异常URL: ${rawUrl.substring(0, 120)} -> ${url.substring(0, 120)}`);
    }

    const requestedSuccessQuality = successPairIdx >= 0 ? tryPairs[successPairIdx].qualityKey : undefined;
    const resultQuality = normalizeQualityKey(result.quality);
    const actualQuality = resultQuality ?? inferActualQualityFromMediaUrl(url, requestedSuccessQuality);
    const lyricsRaw = (ttml || lyric || tlyric || lxlyric || yrc || qrc || eslrc)
      ? buildBakaMfLyricsRaw({ ttml, lyric, tlyric, lxlyric, yrc, qrc, eslrc })
      : '';

    const headerKeys = Object.keys(headers);
    log(`[getMediaSource] 成功: url=${url.substring(0, 100)}, headers=[${headerKeys.join(',')}], ekey=${ekey ? '有' : '无'}, cek=${cek ? '有' : '无'}, lyricLen=${lyric.length}, ttmlLen=${ttml.length}, actualQuality=${actualQuality}`);
    return {
      url,
      headers,
      ekey: ekey || undefined,
      cek: cek || undefined,
      lyric,
      ttml: ttml || undefined,
      tlyric,
      lxlyric,
      yrc,
      qrc,
      eslrc,
      lyricsRaw,
      coverUrl,
      actualQuality,
    };
  }

  // ==================== 歌词获取 ====================

  /**
   * 获取歌词（支持所有 Baka 歌词格式）
   *
   * Baka 插件 getLyric 返回 ILyricSource 对象，可能包含：
   *   - rawLrc / lrc / lyric: 标准歌词文本
   *   - translation / tlyric: 翻译歌词
   *   - romanization: 罗马音歌词
   *   - format: 歌词格式标识
   *   - yrc / qrc / lxlyric / eslrc: 逐字歌词
   *
   * 使用 Baka/MF 专用构建器构建 lyricsRaw 文本（优先级：yrc > qrc > eslrc > lxlyric > lyric）
   */
  async getLyric(
    source: PluginSource,
    item: PluginSearchResult,
  ): Promise<{ lyric: string; tlyric?: string; lxlyric?: string; yrc?: string; qrc?: string; eslrc?: string; ttml?: string; lyricsRaw?: string; format?: BakaLyricFormat } | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    try {
      if (typeof inst.getLyric !== 'function') {
        log(`[getLyric] ${source.name} 插件未实现 getLyric 方法`);
        return null;
      }

      const musicItem = item.rawData
        ? resetMediaItem(item.rawData, source.name)
        : resetMediaItem(item, source.name);

      const lrcSource = (await inst.getLyric(musicItem)?.catch((e: any) => {
        log(`[getLyric] ${source.name} 调用异常: ${e?.message ?? e}`);
        return null;
      })) || null;

      if (!lrcSource) {
        log(`[getLyric] ${source.name} 返回空结果`);
        return null;
      }

      // 兼容多种字段名
      const rawLrc = lrcSource.rawLrc || lrcSource.lyric || lrcSource.lrc || '';
      const ttml = lrcSource.ttml || '';
      const translation = lrcSource.translation || lrcSource.tlyric || lrcSource.translateLyric || '';
      const romanization = lrcSource.romanization || lrcSource.rlyric || '';
      const lxlyric = lrcSource.lxlyric || '';
      const yrc = lrcSource.yrc || '';
      const qrc = lrcSource.qrc || '';
      const eslrc = lrcSource.eslrc || '';

      // [诊断] 输出完整的歌词数据信息，帮助定位逐字歌词缺失问题
      log(`[getLyric] ${source.name} 原始返回字段: keys=[${Object.keys(lrcSource).join(',')}], format=${lrcSource.format ?? '(none)'}, rawLrcLen=${rawLrc.length}, ttmlLen=${ttml.length}, lxlyricLen=${lxlyric.length}, yrcLen=${yrc.length}, qrcLen=${qrc.length}, eslrcLen=${eslrc.length}`);
      if (rawLrc) log(`[getLyric] rawLrc 预览: ${rawLrc.substring(0, 200)}`);
      if (ttml) log(`[getLyric] ttml 预览: ${ttml.substring(0, 200)}`);
      if (lxlyric) log(`[getLyric] lxlyric 预览: ${lxlyric.substring(0, 200)}`);
      if (yrc) log(`[getLyric] yrc 预览: ${yrc.substring(0, 200)}`);
      if (qrc) log(`[getLyric] qrc 预览: ${qrc.substring(0, 200)}`);
      if (eslrc) log(`[getLyric] eslrc 预览: ${eslrc.substring(0, 200)}`);

      // 检测歌词格式
      let format: BakaLyricFormat | undefined;
      if (lrcSource.format) {
        format = lrcSource.format as BakaLyricFormat;
      } else if (ttml) {
        format = 'ttml';
      } else if (yrc) {
        format = 'yrc';
      } else if (qrc) {
        format = 'qrc';
      } else if (eslrc) {
        format = 'eslrc';
      } else if (lxlyric) {
        format = 'lrc-a2';
      } else if (rawLrc) {
        format = detectLyricFormat(rawLrc);
      }

      if (!rawLrc && !ttml && !lxlyric && !yrc && !qrc && !eslrc) {
        log(`[getLyric] ${source.name} rawLrc 为空, lrcSource keys: ${Object.keys(lrcSource).join(',')}`);
        return null;
      }

      const lyricsRaw = buildBakaMfLyricsRaw({
        ttml,
        lyric: rawLrc,
        tlyric: translation,
        rlyric: romanization,
        lxlyric,
        yrc,
        qrc,
        eslrc,
      });
      log(`[getLyric] ${source.name} 成功, rawLrc长度=${rawLrc.length}, ttml长度=${ttml.length}, lxlyric长度=${lxlyric.length}, yrc长度=${yrc.length}, qrc长度=${qrc.length}, format=${format}`);
      return { lyric: rawLrc, tlyric: translation, lxlyric, yrc, qrc, eslrc, ttml, lyricsRaw, format };
    } catch (e) {
      log(`获取歌词失败: ${source.name} ${e}`);
      return null;
    }
  }

  // ==================== 评论获取 ====================

  /**
   * 获取歌曲评论（对齐 BakaMusic getMusicComments）
   *
   * @param source 插件源
   * @param item 搜索结果项
   * @param page 页码（从 1 开始）
   * @returns 评论列表
   */
  async getMusicComments(
    source: PluginSource,
    item: PluginSearchResult,
    page: number = 1,
  ): Promise<BakaCommentResult | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    try {
      if (typeof inst.getMusicComments !== 'function') {
        log(`[getMusicComments] ${source.name} 插件未实现 getMusicComments 方法`);
        return null;
      }

      const musicItem = item.rawData
        ? resetMediaItem(item.rawData, source.name)
        : resetMediaItem(item, source.name);

      const result = (await inst.getMusicComments(musicItem, page)?.catch((e: any) => {
        log(`[getMusicComments] ${source.name} 调用异常: ${e?.message ?? e}`);
        return null;
      })) || null;

      if (!result) return null;

      // 兼容多种返回格式
      const comments: BakaComment[] = Array.isArray(result.data) ? result.data : (Array.isArray(result) ? result : []);
      const isEnd = result.isEnd ?? (comments.length === 0);

      log(`[getMusicComments] ${source.name} 成功, 获取 ${comments.length} 条评论, isEnd=${isEnd}`);
      return { isEnd, data: comments };
    } catch (e) {
      log(`获取评论失败: ${source.name} ${e}`);
      return null;
    }
  }

  // ==================== 获取封面 ====================

  async getCover(source: PluginSource, item: PluginSearchResult): Promise<string | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    // 网易云检测与专辑接口兜底（与 pluginEngine.pluginGetCover 的 tryNeteaseAlbumCover 一致）
    // 网易云搜索只回超大整数 pic 而无 picUrl/pic_str 时，getMusicInfo 也常拿不到封面，走专辑接口最稳
    const rawItem = item.rawData || item;
    const neteaseSource =
      (source.sources && source.sources.includes('wy')) ||
      /网易云|netease/i.test(source.name || '') ||
      !!rawItem?.al?.id ||
      !!rawItem?.al?.picId_str ||
      !!rawItem?.al?.pic;
    const tryNeteaseAlbumCover = async (): Promise<string | null> => {
      if (!neteaseSource) return null;
      const raw = item.rawData || item;
      const albumId = raw?.al?.id ?? raw?.album?.id ?? raw?.albumId;
      const songmid = String(item.platformId || raw?.id || raw?.songmid || '');
      if (!albumId || !songmid) return null;
      try {
        const cover = await pluginApi.getLxCover({
          songmid,
          source: 'wy',
          albumId: String(albumId),
          name: item.title,
          singer: item.artist,
          albumName: item.album,
        });
        return cover || null;
      } catch {
        return null;
      }
    };

    try {
      if (typeof inst.getMusicInfo === 'function') {
        const musicItem = item.rawData
          ? resetMediaItem(item.rawData, source.name)
          : resetMediaItem(item, source.name);
        const result = await inst.getMusicInfo(musicItem);
        const coverUrl = extractCoverUrl(result);
        if (coverUrl) return coverUrl;
      }
      // getMusicInfo 无封面时，网易云走专辑接口兜底（song/detail 常被限流）
      const albumCover = await tryNeteaseAlbumCover();
      if (albumCover) return albumCover;
      return item.coverUrl || null;
    } catch {
      const albumCover = await tryNeteaseAlbumCover();
      if (albumCover) return albumCover;
      return item.coverUrl || null;
    }
  }

  // ==================== 获取歌曲详情页 URL ====================

  /**
   * 获取歌曲分享/详情页 URL（对齐 BakaMusic getMusicDetailPageUrl）
   */
  async getMusicDetailPageUrl(source: PluginSource, item: PluginSearchResult): Promise<string | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    try {
      if (typeof inst.getMusicDetailPageUrl !== 'function') return null;
      const musicItem = item.rawData
        ? resetMediaItem(item.rawData, source.name)
        : resetMediaItem(item, source.name);
      const result = await inst.getMusicDetailPageUrl(musicItem);
      return typeof result === 'string' ? result : (result?.url || null);
    } catch {
      return null;
    }
  }

  // ==================== 搜索 ====================

  /**
   * 搜索音乐（Baka 插件可能未声明 'music' 但实际支持）
   */
  async searchMusic(
    source: PluginSource,
    keyword: string,
    page: number,
  ): Promise<PluginSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.search !== 'function') return [];

      const result = (await inst.search(keyword, page, 'music')) ?? {};
      const list = extractResultList(result);
      if (list.length === 0) return [];

      return list.map((item: any) => {
        resetMediaItem(item, source.name);
        return toPluginSearchResult(item, source);
      });
    } catch (e: any) {
      log(`[searchMusic] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  /** 搜索歌手 */
  async searchArtists(
    source: PluginSource,
    keyword: string,
    page: number,
  ): Promise<any[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.search !== 'function') return [];

      const result = (await inst.search(keyword, page, 'artist')) ?? {};
      const list = extractResultList(result);
      if (list.length === 0) return [];

      return list.map((item: any) => {
        resetMediaItem(item, source.name);
        return {
          id: item.id || item.artistId || item.singerId || '',
          name: stripHtmlTags(item.name || item.title || item.artist || ''),
          avatarUrl: extractArtistAvatarUrl(item),
          description: item.description || item.desc || '',
          songCount: item.songCount || item.musicCount || undefined,
          albumCount: item.albumCount || undefined,
          platform: item.platform || source.name,
          platformId: item.id || item.artistId || item.singerId || '',
          pluginId: source.id,
          rawData: item,
        };
      });
    } catch (e: any) {
      log(`[searchArtists] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  /** 搜索专辑 */
  async searchAlbums(
    source: PluginSource,
    keyword: string,
    page: number,
  ): Promise<any[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.search !== 'function') return [];

      const result = (await inst.search(keyword, page, 'album')) ?? {};
      const list = extractResultList(result);
      return list.map((item: any) => {
        resetMediaItem(item, source.name);
        return {
          id: item.id || item.albumId || '',
          name: stripHtmlTags(item.title || item.name || item.album || ''),
          artist: extractArtist(item),
          coverUrl: extractCoverUrl(item),
          description: item.description || item.desc || '',
          year: item.year || item.publishTime || undefined,
          songCount: item.songCount || item.musicCount || undefined,
          platform: item.platform || source.name,
          platformId: item.id || item.albumId || '',
          pluginId: source.id,
          rawData: item,
        };
      });
    } catch (e: any) {
      log(`[searchAlbums] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  /** 搜索歌单 */
  async searchPlaylists(
    source: PluginSource,
    keyword: string,
    page: number,
  ): Promise<PluginPlaylistSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.search !== 'function') return [];

      const result = (await inst.search(keyword, page, 'sheet')) ?? {};
      const list = extractResultList(result);
      return list.map((item: any) => {
        resetMediaItem(item, source.name);
        return {
          id: String(item.id || item.sheetId || ''),
          title: stripHtmlTags(item.title || item.name || ''),
          coverUrl: extractCoverUrl(item) || '',
          playCount: item.playCount || item.playcount || undefined,
          trackCount: item.trackCount || item.musicCount || undefined,
          artist: extractArtist(item),
          platform: item.platform || source.name,
          platformId: String(item.id || item.sheetId || ''),
          pluginId: source.id,
          rawData: item,
        };
      });
    } catch (e: any) {
      log(`[searchPlaylists] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  // ==================== 专辑/歌单/歌手详情 ====================

  /** 获取专辑歌曲 */
  async getAlbumSongs(source: PluginSource, albumItem: any, page: number = 1): Promise<PluginSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      // 优先使用 getAlbumInfo，落雪式增量退避反复尝试成功路径
      if (typeof inst.getAlbumInfo === 'function') {
        const getAlbumInfo = inst.getAlbumInfo;
        const albumLabel = `[${source.name}] getAlbumInfo album="${albumItem?.title || albumItem?.name || albumItem?.album || ''}"`;
        let list: any[] = [];
        try {
          const result = await retryWithBackoff(
            albumLabel,
            () => getAlbumInfo(albumItem, page),
            (r) => extractResultList(r).length === 0,
          );
          list = extractResultList(result);
        } catch (e: any) {
          log(`[getAlbumInfo] ${source.name} 多次尝试仍空/异常: ${e?.message || e}`);
        }
        if (list.length > 0) {
          return list.map((item: any) => {
            resetMediaItem(item, source.name);
            return toPluginSearchResult(item, source);
          });
        }
      }
      // 回退到搜索
      if (page === 1) {
        const albumName = albumItem.title || albumItem.name || albumItem.album || '';
        if (albumName) {
          catalogLog(`[${source.name}] getAlbumInfo 重试仍为空，回退搜索 "${albumName}"`);
          return this.searchMusic(source, albumName, 1);
        }
      }
      return [];
    } catch (e: any) {
      log(`[getAlbumSongs] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  /** 获取歌单详情 */
  async getPlaylistDetail(source: PluginSource, sheetItem: any, page: number = 1): Promise<PluginSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    const fetchDetail = async (): Promise<any> => {
      if (typeof inst.getMusicSheetInfo !== 'function') return {};
      return (await inst.getMusicSheetInfo(sheetItem, page)) ?? {};
    };

    const sheetLabel = `[${source.name}] getMusicSheetInfo sheet="${sheetItem?.title || sheetItem?.name || ''}"`;

    let list: any[] = [];
    try {
      const raw = await retryWithBackoff(
        sheetLabel,
        fetchDetail,
        (r) => extractResultList(r).length === 0,
      );
      list = extractResultList(raw);
    } catch (e: any) {
      log(`[getPlaylistDetail] ${source.name} getMusicSheetInfo 多次尝试仍空/异常: ${e?.message || e}`);
      list = [];
    }

    if (list.length > 0) {
      return list.map((item: any) => {
        resetMediaItem(item, source.name);
        return toPluginSearchResult(item, source);
      });
    }

    // 回退到搜索
    if (page === 1) {
      const sheetName = sheetItem.title || sheetItem.name || '';
      if (sheetName) {
        catalogLog(`${sheetLabel} 重试仍为空，回退搜索 "${sheetName}"`);
        return this.searchMusic(source, sheetName, 1);
      }
    }
    return [];
  }

  /** 获取歌手作品 */
  async getArtistWorks(source: PluginSource, artistItem: any, page: number = 1, type: string = 'music'): Promise<PluginSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.getArtistWorks === 'function') {
        const getArtistWorks = inst.getArtistWorks;
        const worksLabel = `[${source.name}] getArtistWorks(${type}) artist="${artistItem?.name || artistItem?.artist || ''}"`;
        let list: any[] = [];
        try {
          const result = await retryWithBackoff(
            worksLabel,
            () => getArtistWorks(artistItem, page, type),
            (r) => extractResultList(r).length === 0,
          );
          list = extractResultList(result);
        } catch (e: any) {
          log(`[getArtistWorks] ${source.name} 多次尝试仍空/异常: ${e?.message || e}`);
        }
        if (list.length > 0) {
          return list.map((item: any) => {
            resetMediaItem(item, source.name);
            return toPluginSearchResult(item, source);
          });
        }
      }
      // 回退到搜索
      if (page === 1) {
        const artistName = artistItem.name || artistItem.artist || '';
        if (artistName) {
          catalogLog(`[${source.name}] getArtistWorks 重试仍为空，回退搜索 "${artistName}"`);
          return this.searchMusic(source, artistName, 1);
        }
      }
      return [];
    } catch (e: any) {
      log(`[getArtistWorks] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  /** 获取歌手详情 */
  async getArtistInfo(source: PluginSource, artistItem: any): Promise<any | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    try {
      if (typeof inst.getArtistInfo !== 'function') return null;
      return (await inst.getArtistInfo(artistItem)?.catch(() => null)) || null;
    } catch {
      return null;
    }
  }

  // ==================== 榜单 ====================

  async getTopLists(source: PluginSource): Promise<any[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.getTopLists !== 'function') return [];
      const result = (await inst.getTopLists()) ?? [];
      return Array.isArray(result) ? result : (result?.data || []);
    } catch (e: any) {
      log(`[getTopLists] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  async getTopListDetail(source: PluginSource, topListItem: any, page: number = 1): Promise<PluginSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.getTopListDetail !== 'function') return [];
      const result = (await inst.getTopListDetail(topListItem, page)) ?? {};
      const list = result?.musicList || result?.data || result?.list || [];
      if (Array.isArray(list) && list.length > 0) {
        return list.map((item: any) => {
          resetMediaItem(item, source.name);
          return toPluginSearchResult(item, source);
        });
      }
      return [];
    } catch (e: any) {
      log(`[getTopListDetail] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  // ==================== 推荐歌单 ====================

  async getRecommendSheetTags(source: PluginSource): Promise<any | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    try {
      if (typeof inst.getRecommendSheetTags !== 'function') return null;
      return (await inst.getRecommendSheetTags()?.catch(() => null)) || null;
    } catch {
      return null;
    }
  }

  async getRecommendSheetsByTag(source: PluginSource, tag: any, page: number = 1): Promise<PluginPlaylistSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.getRecommendSheetsByTag !== 'function') return [];
      const result = (await inst.getRecommendSheetsByTag(tag, page)) ?? {};
      const list = extractResultList(result);
      return list.map((item: any) => {
        resetMediaItem(item, source.name);
        return {
          id: String(item.id || item.sheetId || ''),
          title: stripHtmlTags(item.title || item.name || ''),
          coverUrl: extractCoverUrl(item) || '',
          playCount: item.playCount || undefined,
          trackCount: item.trackCount || undefined,
          platform: item.platform || source.name,
          platformId: String(item.id || item.sheetId || ''),
          pluginId: source.id,
          rawData: item,
        };
      });
    } catch (e: any) {
      log(`[getRecommendSheetsByTag] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  // ==================== 导入 ====================

  async importMusicSheet(source: PluginSource, urlLike: string): Promise<PluginSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.importMusicSheet !== 'function') return [];
      const result = (await inst.importMusicSheet(urlLike)) ?? [];
      const list = Array.isArray(result) ? result : (result?.data || []);
      return list.map((item: any) => {
        resetMediaItem(item, source.name);
        return toPluginSearchResult(item, source);
      });
    } catch (e: any) {
      log(`[importMusicSheet] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  async importMusicItem(source: PluginSource, urlLike: string): Promise<PluginSearchResult | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    try {
      if (typeof inst.importMusicItem !== 'function') return null;
      const result = (await inst.importMusicItem(urlLike)) ?? null;
      if (!result) return null;
      resetMediaItem(result, source.name);
      return toPluginSearchResult(result, source);
    } catch (e: any) {
      log(`[importMusicItem] ${source.name} 失败: ${e?.message || e}`);
      return null;
    }
  }

  // ==================== 内部工具 ====================

  /**
   * 确保插件实例已加载，返回 Baka 插件实例接口
   *
   * 优先从沙箱获取（通过 RPC 代理），回退到全局实例缓存。
   */
  private async _ensureInstance(source: PluginSource): Promise<IBakaPluginInstance | null> {
    // 尝试从沙箱获取代理实例
    if (isSandboxReady(source.id)) {
      return this._createSandboxProxy(source.id);
    }

    // 回退到全局实例缓存（直接执行模式）
    const _globalThis = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {} as any);
    const instances = _globalThis.__pluginInstances as Map<string, { source: PluginSource; instance: any; script: string }> | undefined;
    if (instances) {
      const inst = instances.get(source.id);
      if (inst?.instance) {
        return inst.instance as IBakaPluginInstance;
      }
    }

    // 触发重新加载（通过 pluginEngine 的 ensurePluginInstance）
    log(`插件实例未缓存，需要重新加载: ${source.name} (${source.filePath})`);
    return null;
  }

  /**
   * 创建沙箱代理实例
   *
   * 当插件在沙箱中运行时，通过 RPC 调用方法。
   * 代理对象包含所有 Baka 插件方法（16 个），
   * 只为实际实现的方法创建代理函数。
   */
  private _createSandboxProxy(pluginId: string): IBakaPluginInstance {
    const meta = getSandboxInstance(pluginId) || {};

    // Worker 返回的 _availableMethods 包含插件实际实现的方法名列表
    const availableMethods: string[] = Array.isArray(meta._availableMethods)
      ? meta._availableMethods
      : [...BAKA_PLUGIN_METHODS];

    const proxy: any = {
      platform: meta.platform,
      version: meta.version,
      appVersion: meta.appVersion,
      srcUrl: meta.srcUrl,
      author: meta.author,
      description: meta.description,
      cacheControl: meta.cacheControl,
      primaryKey: meta.primaryKey,
      defaultSearchType: meta.defaultSearchType,
      supportedSearchType: meta.supportedSearchType,
      userVariables: meta.userVariables,
      hints: meta.hints,
      supportedQualities: meta.supportedQualities,
    };

    // 为所有 Baka 插件方法创建代理
    for (const method of BAKA_PLUGIN_METHODS) {
      if (availableMethods.includes(method)) {
        proxy[method] = async (...args: any[]) => {
          return callSandboxMethod(pluginId, method, args, method === 'getLyric' ? 8000 : 30000);
        };
      }
    }

    return proxy as IBakaPluginInstance;
  }
}

// ==================== 落雪式增量退避重试（与 pluginEngine.retryOnEmpty 一致） ====================

/**
 * 当插件接口偶发空返回/异常时，参考落雪(lx) 的加载方式：
 * 每次失败间隔递增（800/1600/2400...），最多 attempts 次（约 12s）才放弃并抛错。
 * 不做短固定间隔的快速限次重试。
 */
async function retryWithBackoff<T>(
  label: string,
  fn: () => Promise<any>,
  isEmpty: (val: any) => boolean,
  base: number = 800,
  attempts: number = 6,
): Promise<T> {
  let result: T | undefined;
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    const wait = base * i;
    try {
      result = (await fn()) as T;
      catalogLog(`${label} 第${i}次 → ${describeResultWrapper(result)}`);
      if (!isEmpty(result)) return result;
      if (i < attempts) {
        catalogLog(`${label} 第${i}次为空，${wait}ms后重试(共${attempts}次)`);
        await new Promise(resolve => setTimeout(resolve, wait));
      }
    } catch (e: any) {
      lastErr = e;
      catalogLog(`${label} 第${i}次异常: ${e?.message || e}`);
      if (i < attempts) {
        catalogLog(`${label} 异常后 ${wait}ms重试(共${attempts}次)`);
        await new Promise(resolve => setTimeout(resolve, wait));
      }
    }
  }
  if (result === undefined || isEmpty(result as any)) {
    throw lastErr ?? new Error(`${label} 多次尝试后仍为空`);
  }
  return result as T;
}

// ==================== 单例导出 ====================

export const BakaPluginManager = new BakaPluginManagerClass();
