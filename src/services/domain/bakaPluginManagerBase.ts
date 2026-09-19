import type {
  PluginSource,
  PluginSearchResult,
  PluginMusicInfo,
  OnlineQualityFallbackBehavior,
  QualityKey,
} from '../../types';
import {
  QUALITY_META,
  ALL_QUALITY_KEYS,
  ALL_QUALITY_KEYS_DESC,
  BAKA_TO_LEGACY_QUALITY_MAP,
  normalizeQualityKey,
} from '../../types';
import {
  extractResultList,
} from './pluginResultMappers';
import { pluginHttpRequest } from '../tauri/pluginApi';

// ==================== 日志 ====================

let _logCallback: ((msg: string) => void) | null = null;

export function log(msg: string) {
  try { if (_logCallback) { _logCallback(msg); } } catch { /* ignore */ }
}

export const catalogLog = (msg: string) => {
  log(msg);
};

export const describeResultWrapper = (r: any): string => {
  if (!r || typeof r !== 'object') return `type=${typeof r}`;
  const keys = Object.keys(r).filter(k => k !== 'isEnd').join(',') || '空对象';
  let len = 0;
  try { len = extractResultList(r).length; } catch { /* ignore */ }
  return `keys=[${keys}] extractedLen=${len}`;
};

// ==================== 通用工具 ====================

export const firstStringField = (source: any, keys: string[]): string => {
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

export const normalizeHeaderMap = (headers: any): Record<string, string> => {
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

export const firstHeaderMap = (...candidates: any[]): Record<string, string> => {
  for (const candidate of candidates) {
    const normalized = normalizeHeaderMap(candidate);
    if (Object.keys(normalized).length > 0) {
      return normalized;
    }
  }
  return {};
};

// ==================== 类型定义 ====================

export type BakaLyricFormat =
  | 'ttml' | 'lrc' | 'lrc-a2' | 'yrc' | 'qrc'
  | 'eslrc' | 'lyl' | 'lys' | 'lqe' | 'krc' | 'plain';

export interface BakaComment {
  id?: string;
  nickName: string;
  avatar?: string;
  comment: string;
  like?: number;
  createAt?: number;
  location?: string;
  replies?: BakaComment[];
}

export interface BakaCommentResult {
  isEnd?: boolean;
  data?: BakaComment[];
}

export interface IBakaPluginInstance {
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

export interface MediaSourceCacheEntry {
  expiresAt: number;
  value: PluginMusicInfo;
}

export const BAKA_PLUGIN_METHODS = [
  'search', 'getMediaSource', 'getMusicInfo', 'getLyric',
  'getAlbumInfo', 'getMusicSheetInfo', 'getArtistWorks',
  'getArtistInfo', 'importMusicSheet', 'importMusicItem',
  'getTopLists', 'getTopListDetail', 'getRecommendSheetTags',
  'getRecommendSheetsByTag', 'getMusicComments', 'getMusicDetailPageUrl',
] as const;

// ==================== 音质回退映射（对齐 BakaMusic newToLegacyQualityMap）====================

export const newToLegacyQualityMap: Record<string, string> = BAKA_TO_LEGACY_QUALITY_MAP;

export const MEDIA_SOURCE_CACHE_TTL_MS = 3 * 60 * 1000;

export function clonePluginMusicInfo(value: PluginMusicInfo): PluginMusicInfo {
  return {
    ...value,
    headers: value.headers ? { ...value.headers } : undefined,
  };
}

export function getMediaItemStableId(item: PluginSearchResult, musicItem: any): string {
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

export function buildMediaSourceCacheKey(
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

export function inferActualQualityFromMediaUrl(urlLike: string, fallback?: QualityKey): QualityKey | undefined {
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

export function normalizeSupportedQualities(raw: unknown): QualityKey[] | null {
  if (!Array.isArray(raw)) return null;
  const supported = raw
    .map(q => normalizeQualityKey(q))
    .filter((q): q is QualityKey => !!q);
  return supported.length > 0 ? Array.from(new Set(supported)) : null;
}

export function extractOnlySupportedQuality(errMsg: string): QualityKey | undefined {
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

export function isFatalMediaSourceError(errMsg: string): boolean {
  // 401/鉴权失效（API密钥、卡密）为源级错误，逐档重试无意义，与 playauth 同级处理
  // 关键词与三端统一鉴权集一致（playauth 为本模块特有的源级错误）
  return /解密\s*playauth\s*失败|decrypt\s*playauth\s*failed|playauth|API密钥|API\s*key|api[_\s-]?secret|卡密|\b40[13]\b|鉴权失效已临时熔断/i.test(errMsg);
}

export function isKugouLikeSource(source: PluginSource, mediaItem: any): boolean {
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

export function isNeteaseLikeSource(source: PluginSource, mediaItem: any): boolean {
  const text = [
    source.name,
    source.id,
    mediaItem?.platform,
    mediaItem?.source,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return text.includes('网易') || text.includes('netease') || /\bwy\b/.test(text);
}

export function isNeteaseMusicPluginSource(source: PluginSource): boolean {
  return isNeteaseLikeSource(source, null);
}

export function isNeteaseOuterUrl(urlLike: string): boolean {
  try {
    const url = new URL(urlLike);
    return url.hostname.toLowerCase().endsWith('music.163.com')
      && url.pathname.toLowerCase().includes('/song/media/outer/url');
  } catch {
    return false;
  }
}

export function cleanKugouPluginUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '';

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

  let url = raw.substring(start);

  while (url.length > 0) {
    const c = url.charCodeAt(url.length - 1);
    const isAllowed =
      (c >= 0x30 && c <= 0x39)
      || (c >= 0x41 && c <= 0x5a)
      || (c >= 0x61 && c <= 0x7a)
      || c === 0x2f
      || c === 0x3a
      || c === 0x3f
      || c === 0x26
      || c === 0x3d
      || c === 0x5f
      || c === 0x2d
      || c === 0x2e
      || c === 0x7e
      || c === 0x23
      || c === 0x2b
      || c === 0x25
      || c === 0x40;
    if (isAllowed) break;
    url = url.substring(0, url.length - 1);
  }

  return url;
}

export function getHeaderValue(headers: Record<string, string> | undefined, name: string): string {
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

export function isLikelyKugouProxyApiUrl(urlLike: string): boolean {
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

export async function probeKugouProxyCandidate(
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
    return { playable: true, reason: error?.message || String(error || '') };
  }
}

export async function probeNeteaseOuterUrl(
  url: string,
): Promise<{ playable: boolean; reason?: string }> {
  const judge = (status: number, headers: Record<string, string> | undefined, finalUrl: string) => {
    if (status >= 400) {
      return { playable: false, reason: `HTTP ${status}` };
    }
    const contentType = getHeaderValue(headers, 'content-type');
    if (isAudioLikeContentType(contentType)) {
      return { playable: true };
    }
    if (contentType.includes('text/html')) {
      const finalPath = new URL(finalUrl).pathname.toLowerCase();
      if (finalPath.includes('/404')) {
        return { playable: false, reason: '版权受限（跳转 404 页）' };
      }
      return { playable: false, reason: `跳转到非音频内容 (${contentType})` };
    }
    return { playable: true };
  };
  try {
    let resp = await pluginHttpRequest('HEAD', url, { Accept: '*/*' }, undefined, 8, 3);
    if (resp.status === 405 || resp.status === 501) {
      resp = await pluginHttpRequest('GET', url, { Accept: '*/*', Range: 'bytes=0-4095' }, undefined, 8, 3);
    }
    return judge(resp.status, resp.headers, resp.url);
  } catch (error: any) {
    return { playable: true, reason: error?.message || String(error || '') };
  }
}

export function readQualityHash(mediaItem: any, qualityKey: QualityKey): string {
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

export function adaptKugouMediaItemForQuality(mediaItem: any, qualityKey: QualityKey): any {
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

export function adaptMediaItemForPluginQuality(
  source: PluginSource,
  mediaItem: any,
  qualityKey: QualityKey,
): any {
  if (isKugouLikeSource(source, mediaItem)) {
    return adaptKugouMediaItemForQuality(mediaItem, qualityKey);
  }

  return mediaItem;
}

// ==================== Baka 识别锚点 ====================

export const isBakaSupportedQualities = (raw: unknown): raw is string[] => {
  if (!Array.isArray(raw)) return false;

  const normalized = new Set(
    raw
      .map(q => normalizeQualityKey(q))
      .filter((q): q is QualityKey => !!q),
  );

  return ALL_QUALITY_KEYS.some(q => normalized.has(q));
};

export const hasCommentApi = (meta: any): boolean => {
  if (!meta) return false;
  if (Array.isArray(meta._availableMethods) && meta._availableMethods.includes('getMusicComments')) {
    return true;
  }
  return typeof meta.getMusicComments === 'function';
};

export const NON_BAKA_PLUGIN_AUTHORS = ['时迁酱'];

// ==================== 歌词格式检测 ====================

export function detectLyricFormat(content: string): BakaLyricFormat {
  const trimmed = content.trim();
  if (!trimmed) return 'plain';

  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<tt') || trimmed.includes('<tt ')) {
    return 'ttml';
  }

  if (trimmed.startsWith('{') && trimmed.includes('"content"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.lyric?.length || parsed?.content?.length) return 'yrc';
    } catch { /* not JSON */ }
  }

  if (/^\[(?:ti|ar|al|by|offset):/.test(trimmed) && /\[\d+,\d+\]/.test(trimmed)) {
    return 'qrc';
  }

  if (/\[\d+:\d+\.\d+\]<\d+:\d+\.\d+>/.test(trimmed)) {
    return 'eslrc';
  }

  if (/^\[\d+,\d+].*\(-?\d+,-?\d+(?:,-?\d+)?\)/m.test(trimmed)) {
    return 'krc';
  }

  if (trimmed.includes('[ti:') && trimmed.includes('[al:')) {
    return 'lrc-a2';
  }

  if (/<\d+>/.test(trimmed) && /\[\d+:\d+\.\d+\]/.test(trimmed)) {
    return 'lyl';
  }

  if (/^\{.*"startTime".*"endTime".*\}/m.test(trimmed)) {
    return 'lys';
  }

  if (trimmed.startsWith('[lqe:') || trimmed.includes('[lqe:')) {
    return 'lqe';
  }

  if (/\[\d+:\d+\.\d+\]/.test(trimmed) || /\[\d+:\d+\]/.test(trimmed)) {
    return 'lrc';
  }

  return 'plain';
}

// ==================== 落雪式增量退避重试（与 pluginEngine.retryOnEmpty 一致） ====================

export async function retryWithBackoff<T>(
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