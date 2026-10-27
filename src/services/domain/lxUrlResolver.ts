
import type { QualityKey, Song } from '../../types';
import {
  normalizeQualityKey,
  qualityKeyToLxQuality,
} from '../../types';
import type { PluginSource } from '../../types';
import { getCachedLxSong } from './lxSongCache';
import type { LxSearchResultItem } from './lxMusicSdk';
import { lxPluginGetMusicUrl } from './lxPluginEngine';
import { lxPlugins } from './lxPluginEngineBase';
import { tauriInvoke } from '../tauri/invoke';
import { getStoredPlugins } from './pluginEngine';

// ==================== 协议解析 ====================

export interface LxPathInfo {
  source: string;
  songmid: string;
}

export function parseLxPath(path: string): LxPathInfo | null {
  if (!path || !path.startsWith('lx://')) return null;
  const parts = path.replace('lx://', '').split('/');
  const source = parts[0];
  const songmid = parts.slice(1).join('/');
  if (!source || !songmid) return null;
  return { source, songmid };
}

// ==================== 插件定位 ====================

// 声明支持该音源的插件优先，逐个尝试直到命中，
// 避免单个插件的第三方接口故障导致整体解析失败
function listLxPluginsForSource(lxSource: string): PluginSource[] {
  const lxPlugins = getStoredPlugins().filter(p => p.enabled && p.format === 'lx');
  if (lxPlugins.length === 0) return [];
  const matched = lxPlugins.filter(p => p.sources.includes(lxSource));
  if (matched.length === 0) return lxPlugins;
  return matched;
}

export function findLxPluginForSource(lxSource: string): PluginSource | null {
  return listLxPluginsForSource(lxSource)[0] ?? null;
}

/**
 * 读取 LX 插件在 sources 声明中为该音源声明的音质档位。
 * LX 协议标准仅 4 档，插件可用 qualitys 声明扩展档（hires/atmos/master 等），
 * 搜索结果 _types 只含标准档，声明需从运行时插件实例单独读取并归一为 QualityKey。
 */
export function getLxPluginDeclaredQualities(lxSource: string): QualityKey[] | null {
  for (const plugin of listLxPluginsForSource(lxSource)) {
    const state = lxPlugins.get(plugin.id);
    if (state?.status !== 'ready' || !state.initInfo?.sources) continue;
    const declared = (state.initInfo.sources as Record<string, { qualitys?: string[] }>)[lxSource]?.qualitys;
    if (!Array.isArray(declared)) continue;
    const keys = declared
      .map((q: unknown) => normalizeQualityKey(q))
      .filter((q): q is QualityKey => q !== null);
    if (keys.length > 0) return keys;
  }
  return null;
}

// ==================== songInfo 构造 ====================

export function resolveLxCachedInfo(
  song: Song,
  lxSource: string,
  songmid: string,
): LxSearchResultItem | null {
  const persistedInfo = song.rawData?.source === lxSource ? song.rawData : null;
  const cached = getCachedLxSong(lxSource, songmid) ?? persistedInfo;
  if (cached) return cached;

  const anySong = song as any;
  if (anySong._hash || anySong._types || anySong._copyrightId || anySong._strMediaMid) {
    return {
      name: song.name || '',
      singer: song.artist || '',
      albumName: song.album || '',
      albumId: anySong._albumId,
      albumMid: anySong._albumMid,
      songmid,
      source: lxSource as any,
      interval: '',
      img: null,
      types: [],
      _types: anySong._types,
      hash: anySong._hash,
      copyrightId: anySong._copyrightId,
      strMediaMid: anySong._strMediaMid,
      songId: anySong._songId,
    };
  }
  return null;
}

export function buildLxSongInfo(
  song: Song,
  songmid: string,
  lxSource: string,
  cachedInfo: LxSearchResultItem | null,
): Record<string, unknown> {
  const anySong = song as any;
  const normalizedTypes = normalizeLxTypes(cachedInfo?._types ?? anySong._types ?? anySong.rawData?._types);
  const hash = cachedInfo?.hash || anySong._hash || anySong.hash || anySong.rawData?.hash || (lxSource === 'kg' ? songmid : undefined);
  // kg 源透传分档 hash 原始字段（320hash/sqhash/ResFileHash 等），供分档选 hash 使用
  const kgRawHashes = lxSource === 'kg'
    ? collectKgRawHashes(cachedInfo, anySong.rawData, anySong)
    : {};

  return {
    songId: songmid,
    name: song.name,
    singer: song.artist,
    albumName: song.album,
    source: lxSource,
    songmid,
    hash,
    copyrightId: cachedInfo?.copyrightId || anySong._copyrightId || anySong.copyrightId || anySong.rawData?.copyrightId,
    strMediaMid: cachedInfo?.strMediaMid || anySong._strMediaMid || anySong.strMediaMid || anySong.rawData?.strMediaMid,
    albumId: cachedInfo?.albumId || anySong._albumId || anySong.albumId || anySong.rawData?.albumId,
    albumMid: cachedInfo?.albumMid || anySong._albumMid || anySong.albumMid || anySong.rawData?.albumMid,
    interval: cachedInfo?.interval || anySong.rawData?.interval,
    _types: normalizedTypes,
    types: cachedInfo?.types || anySong.rawData?.types,
    ...kgRawHashes,
  };
}

function normalizeLxTypes(
  raw: Record<string, { size?: string | null; hash?: string }> | undefined,
): Record<string, { size?: string | null; hash?: string }> | undefined {
  if (!raw || typeof raw !== 'object') return raw;
  const result: Record<string, { size?: string | null; hash?: string }> = { ...raw };
  for (const [key, value] of Object.entries(raw)) {
    const qualityKey = normalizeQualityKey(key);
    if (!qualityKey) continue;
    result[qualityKey] = value;
    result[qualityKeyToLxQuality(qualityKey)] = value;
  }
  return result;
}

// ==================== kg 分档 hash（对齐 bakaPluginManagerBase.readQualityHash） ====================

// kg 搜索结果顶层按档位命名的 hash 字段
const KG_HASH_FIELDS = ['320hash', 'sqhash', 'SQFileHash', 'ResFileHash', 'origin_hash'] as const;

function collectKgRawHashes(...candidates: unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Record<string, unknown>;
    for (const field of KG_HASH_FIELDS) {
      if (out[field]) continue;
      const value = record[field];
      if (typeof value === 'string' && value.trim()) out[field] = value.trim();
    }
    if (Object.keys(out).length === KG_HASH_FIELDS.length) break;
  }
  return out;
}

function readKgHashField(songInfo: Record<string, unknown>, field: string): string {
  const value = songInfo[field];
  return typeof value === 'string' ? value.trim() : '';
}

// 优先 _types 中该档位的 hash（搜索结果自带），否则按 baka 规则取顶层字段
function selectKgQualityHash(songInfo: Record<string, unknown>, quality: QualityKey): string {
  const types = songInfo?._types as Record<string, { hash?: string }> | undefined;
  const lxKey = qualityKeyToLxQuality(quality);
  for (const key of new Set([quality, lxKey])) {
    const perType = types?.[key]?.hash;
    if (typeof perType === 'string' && perType.trim()) return perType.trim();
  }

  switch (quality) {
    case '320k':
      return readKgHashField(songInfo, '320hash');
    case 'flac':
      return readKgHashField(songInfo, 'sqhash') || readKgHashField(songInfo, 'SQFileHash');
    case 'flac24bit':
    case 'hires':
    case 'master':
    case 'vinyl':
    case 'dolby':
    case 'atmos':
    case 'atmos_plus':
      return (
        readKgHashField(songInfo, 'ResFileHash') ||
        readKgHashField(songInfo, 'origin_hash') ||
        readKgHashField(songInfo, 'sqhash') ||
        readKgHashField(songInfo, 'SQFileHash')
      );
    default:
      // 128k/192k/mgg 走默认 hash，无需改写
      return '';
  }
}

// 写法对齐 bakaPluginManagerBase.adaptKugouMediaItemForQuality：
// 选中档 hash 同时写入 hash 与对应档位字段，并清掉更高档字段防止插件误选
function withKgQualityHash(
  songInfo: Record<string, unknown>,
  quality: QualityKey,
): Record<string, unknown> {
  const selected = selectKgQualityHash(songInfo, quality);
  if (!selected) return songInfo;

  const adapted: Record<string, unknown> = { ...songInfo, hash: selected };
  if (quality === '128k' || quality === '192k' || quality === 'mgg') {
    adapted.sqhash = undefined;
    adapted.ResFileHash = undefined;
    return adapted;
  }
  if (quality === '320k') {
    adapted['320hash'] = selected;
    adapted.sqhash = undefined;
    adapted.ResFileHash = undefined;
    return adapted;
  }
  if (quality === 'flac') {
    adapted.sqhash = selected;
    return adapted;
  }
  adapted.ResFileHash = selected;
  adapted.sqhash = selected;
  return adapted;
}

// ==================== 直链缓存（对齐移动端 plugin_engine.resolveLxUrl） ====================

const LX_URL_CACHE_TTL_MS = 10 * 60 * 1000;
const LX_URL_CACHE_MAX = 500;
const _lxUrlCache = new Map<
  string,
  {
    url: string;
    quality: QualityKey;
    headers?: Record<string, string> | null;
    cek?: string;
    expiresAt: number;
  }
>();

function buildLxUrlCacheKey(
  lxSource: string,
  songInfo: Record<string, unknown>,
  quality: QualityKey,
): string {
  const songId = String(songInfo?.songmid ?? songInfo?.hash ?? '');
  return `${lxSource}\u0001${songId}\u0001${quality}`;
}

function getLxUrlCacheHit(
  key: string,
): { url: string; quality: QualityKey; headers?: Record<string, string> | null; cek?: string } | null {
  const hit = _lxUrlCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    _lxUrlCache.delete(key);
    return null;
  }
  return { url: hit.url, quality: hit.quality, headers: hit.headers, cek: hit.cek };
}

function setLxUrlCache(
  key: string,
  url: string,
  quality: QualityKey,
  headers?: Record<string, string> | null,
  cek?: string,
): void {
  if (_lxUrlCache.size >= LX_URL_CACHE_MAX) {
    const now = Date.now();
    for (const [k, v] of _lxUrlCache) {
      if (v.expiresAt <= now) _lxUrlCache.delete(k);
    }
    while (_lxUrlCache.size >= LX_URL_CACHE_MAX) {
      const oldest = _lxUrlCache.keys().next().value;
      if (oldest === undefined) break;
      _lxUrlCache.delete(oldest);
    }
  }
  _lxUrlCache.set(key, {
    url,
    quality,
    headers,
    cek,
    expiresAt: Date.now() + LX_URL_CACHE_TTL_MS,
  });
}

export interface LxSingleQualityResolveResult {
  url: string;
  quality: QualityKey;
  // 汽水（qs）原生取流附带：取流 UA 头与 CENC 内容密钥（加密流需随 cek 交给播放器）
  headers?: Record<string, string> | null;
  cek?: string;
}

// ==================== 同歌并发/连发探测去重 ====================
const LX_URL_DEDUP_WINDOW_MS = 400;
const _dedupLxUrl = new Map<
  string,
  { at: number; p: Promise<LxSingleQualityResolveResult | null> }
>();

function buildLxUrlDedupKey(
  plugin: PluginSource,
  songInfo: Record<string, unknown>,
  quality: QualityKey,
): string {
  const songId = String(songInfo?.songmid ?? songInfo?.hash ?? '');
  // qs 原生取流不依赖插件，plugin 可能为空
  return `${plugin?.id ?? 'qs'}\u0001${songId}\u0001${quality}`;
}

export async function resolveLxUrlForSingleQuality(
  plugin: PluginSource,
  lxSource: string,
  songInfo: Record<string, unknown>,
  quality: QualityKey,
): Promise<LxSingleQualityResolveResult | null> {
  // kg 源按请求档位改写 hash（songmid 恒存在，缓存/去重 key 不受影响）
  const effectiveSongInfo = lxSource === 'kg' ? withKgQualityHash(songInfo, quality) : songInfo;
  const cacheKey = buildLxUrlCacheKey(lxSource, effectiveSongInfo, quality);
  const cached = getLxUrlCacheHit(cacheKey);
  if (cached) {
    return { url: cached.url, quality: cached.quality, headers: cached.headers, cek: cached.cek };
  }

  const dedupKey = buildLxUrlDedupKey(plugin, effectiveSongInfo, quality);
  const now = Date.now();
  const hit = _dedupLxUrl.get(dedupKey);
  if (hit && now - hit.at <= LX_URL_DEDUP_WINDOW_MS) {
    return hit.p;
  }
  if (hit) _dedupLxUrl.delete(dedupKey);

  const p = runResolveLxUrlForSingleQuality(plugin, lxSource, effectiveSongInfo, quality, cacheKey);
  _dedupLxUrl.set(dedupKey, { at: now, p });
  p.then(
    () => {
      setTimeout(() => {
        if (_dedupLxUrl.get(dedupKey)?.p === p) _dedupLxUrl.delete(dedupKey);
      }, LX_URL_DEDUP_WINDOW_MS);
    },
    () => {
      _dedupLxUrl.delete(dedupKey);
    },
  );
  return p;
}

async function runResolveLxUrlForSingleQuality(
  plugin: PluginSource,
  lxSource: string,
  songInfo: Record<string, unknown>,
  quality: QualityKey,
  cacheKey: string,
): Promise<LxSingleQualityResolveResult | null> {
  // 汽水原生取流：Rust track_v2 → 按品质选档 → PlayAuth→CEK（绕过 lx 源脚本，脚本仅回 url 无 cek 通道）
  if (lxSource === 'qs') {
    const trackId = String(songInfo?.songmid ?? '');
    if (!trackId) return null;
    const raw = await tauriInvoke('resolve_qs_play', {
      trackId,
      quality: qualityKeyToLxQuality(quality),
    });
    const url = raw?.url ?? '';
    if (!url || !/^https?:/.test(url)) return null;
    const reported = normalizeQualityKey(raw?.quality);
    const hitQuality = reported ?? quality;
    const headers = raw?.headers ?? null;
    const cek = raw?.cek || undefined;
    setLxUrlCache(cacheKey, url, hitQuality, headers, cek);
    return { url, quality: hitQuality, headers, cek };
  }

  const urlResult = await lxPluginGetMusicUrl(
    plugin,
    lxSource,
    songInfo,
    qualityKeyToLxQuality(quality),
  );
  const url = urlResult?.url;
  if (!url || !/^https?:/.test(url)) return null;
  const reported = normalizeQualityKey(urlResult?.type);
  const hitQuality = reported ?? quality;
  setLxUrlCache(cacheKey, url, hitQuality);
  return { url, quality: hitQuality };
}
