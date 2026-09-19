
import type { QualityKey, Song } from '../../types';
import {
  normalizeQualityKey,
  qualityKeyToLxQuality,
  resolveOnlinePlayQuality,
} from '../../types';
import type { PluginSource } from '../../types';
import { getCachedLxSong } from './lxSongCache';
import type { LxSearchResultItem } from './lxMusicSdk';
import { ensureLxPluginInstance, lxPluginGetMusicUrl } from './lxPluginEngine';
import { isSongLevelError } from './lxPluginEngine';
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

export function isLxPath(path: string): boolean {
  return !!path && path.startsWith('lx://');
}

// ==================== 插件定位 ====================

export function findLxPluginForSource(lxSource: string): PluginSource | null {
  const lxPlugins = getStoredPlugins().filter(p => p.enabled && p.format === 'lx');
  if (lxPlugins.length === 0) return null;
  const matched = lxPlugins.find(p => p.sources.includes(lxSource));
  return matched ?? lxPlugins[0];
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

// ==================== URL 解析 ====================

export interface LxUrlResolveResult {
  url: string;
  quality: QualityKey;
  source: 'plugin';
}

// ==================== 直链缓存（对齐移动端 plugin_engine.resolveLxUrl） ====================

const LX_URL_CACHE_TTL_MS = 10 * 60 * 1000;
const LX_URL_CACHE_MAX = 500;
const _lxUrlCache = new Map<
  string,
  { url: string; quality: QualityKey; expiresAt: number }
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
): { url: string; quality: QualityKey } | null {
  const hit = _lxUrlCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    _lxUrlCache.delete(key);
    return null;
  }
  return { url: hit.url, quality: hit.quality };
}

function setLxUrlCache(key: string, url: string, quality: QualityKey): void {
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
    expiresAt: Date.now() + LX_URL_CACHE_TTL_MS,
  });
}

export async function resolveLxUrlViaPlugin(
  plugin: PluginSource,
  lxSource: string,
  songInfo: Record<string, unknown>,
  qualities: QualityKey[],
): Promise<LxUrlResolveResult | null> {
  await ensureLxPluginInstance(plugin);

  for (const quality of qualities) {
    const cacheKey = buildLxUrlCacheKey(lxSource, songInfo, quality);
    const cached = getLxUrlCacheHit(cacheKey);
    if (cached) {
      return { url: cached.url, quality: cached.quality, source: 'plugin' };
    }
    try {
      const pluginQuality = qualityKeyToLxQuality(quality);
      const urlResult = await lxPluginGetMusicUrl(
        plugin,
        lxSource,
        songInfo,
        pluginQuality,
      );
      const musicUrl = urlResult?.url;
      if (musicUrl && /^https?:/.test(musicUrl)) {
        const reported = normalizeQualityKey(urlResult?.type);
        const hitQuality = reported ?? quality;
        setLxUrlCache(cacheKey, musicUrl, hitQuality);
        return { url: musicUrl, quality: hitQuality, source: 'plugin' };
      }
    } catch (urlErr) {
      const isSongLevel =
        (urlErr instanceof Error && urlErr.name === 'LxSongLevelError') ||
        isSongLevelError(urlErr instanceof Error ? urlErr.message : String(urlErr));
      if (isSongLevel) {
        const errMsg = urlErr instanceof Error ? urlErr.message : String(urlErr);
        console.warn(`[LXUrlResolver] 歌曲级别错误，跳过剩余音质: ${errMsg}`);
        break;
      }
    }
  }
  return null;
}

export interface LxSingleQualityResolveResult {
  url: string;
  quality: QualityKey;
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
  return `${plugin.id}\u0001${songId}\u0001${quality}`;
}

export async function resolveLxUrlForSingleQuality(
  plugin: PluginSource,
  lxSource: string,
  songInfo: Record<string, unknown>,
  quality: QualityKey,
): Promise<LxSingleQualityResolveResult | null> {
  const cacheKey = buildLxUrlCacheKey(lxSource, songInfo, quality);
  const cached = getLxUrlCacheHit(cacheKey);
  if (cached) {
    return { url: cached.url, quality: cached.quality };
  }

  const dedupKey = buildLxUrlDedupKey(plugin, songInfo, quality);
  const now = Date.now();
  const hit = _dedupLxUrl.get(dedupKey);
  if (hit && now - hit.at <= LX_URL_DEDUP_WINDOW_MS) {
    return hit.p;
  }
  if (hit) _dedupLxUrl.delete(dedupKey);

  const p = runResolveLxUrlForSingleQuality(plugin, lxSource, songInfo, quality, cacheKey);
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

export async function resolveLxUrl(
  song: Song,
  lxSource: string,
  songmid: string,
  requestedQuality: QualityKey,
  fallbackBehavior: 'lower' | 'higher' | 'pause',
  availableQualities: QualityKey[] | null,
): Promise<LxUrlResolveResult | null> {
  const tryQualities = resolveOnlinePlayQuality(
    requestedQuality,
    availableQualities,
    fallbackBehavior,
  );
  if (tryQualities.length === 0) return null;

  const cachedInfo = resolveLxCachedInfo(song, lxSource, songmid);
  const matchedPlugin = findLxPluginForSource(lxSource);
  if (!matchedPlugin || !cachedInfo) return null;

  const songInfo = buildLxSongInfo(song, songmid, lxSource, cachedInfo);
  return resolveLxUrlViaPlugin(matchedPlugin, lxSource, songInfo, tryQualities);
}
