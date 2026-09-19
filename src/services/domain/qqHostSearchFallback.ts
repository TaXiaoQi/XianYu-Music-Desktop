import { lxGetAlbumSongs, lxSearch, txBatchTrackInterval, txSearchAlbumsRaw } from './lxMusicSdk';
import { dispatchFallbackModule, dispatchFallbackModuleSync } from '../fallbackModules/registry';
import type { LxSearchResult, LxSearchResultItem } from './lxMusicSdk';
import { resetMediaItem, toPluginSearchResult } from './pluginResultMappers';
import type { PluginAlbumResult } from './pluginEngine';
import type { PluginSearchResult, PluginSource } from '../../types';

const QQ_PLATFORM_PATTERN = /qq/i;

export function isQqMusicPluginSource(source: PluginSource, platform?: string): boolean {
  return dispatchFallbackModuleSync('plugin_fallback', 'isQqMusicPluginSource', { source, platform },
    () => isQqMusicPluginSourceBuiltin(source, platform));
}

function isQqMusicPluginSourceBuiltin(source: PluginSource, platform?: string): boolean {
  const haystack = `${source?.name || ''}|${platform || ''}`;
  return QQ_PLATFORM_PATTERN.test(haystack);
}

const QQ_PLUGIN_QUALITY_KEYS = ['128k', '320k', 'flac', 'hires'] as const;

export function lxItemToQqMusicFreeItem(item: LxSearchResultItem): Record<string, any> {
  const qualities: Record<string, { size?: string }> = {};
  for (const key of QQ_PLUGIN_QUALITY_KEYS) {
    const type = item._types?.[key];
    if (type) qualities[key] = { size: type.size ?? undefined };
  }
  return {
    id: String(item.songId ?? item.songmid ?? ''),
    songmid: item.songmid,
    title: item.name,
    artist: item.singer,
    album: item.albumName,
    albumid: item.albumId,
    albummid: item.albumMid || item.albumId,
    artwork: item.img || undefined,
    interval: item.interval,
    qualities,
    _hostQqFallback: true,
  };
}

export async function qqHostSearchFallback(
  source: PluginSource,
  keyword: string,
  page: number,
  limit = 30,
): Promise<PluginSearchResult[]> {
  return dispatchFallbackModule('plugin_fallback', 'hostSearchFallback', { source, keyword, page, limit },
    () => qqHostSearchFallbackBuiltin(source, keyword, page, limit));
}

async function qqHostSearchFallbackBuiltin(
  source: PluginSource,
  keyword: string,
  page: number,
  limit = 30,
): Promise<PluginSearchResult[]> {
  try {
    const result: LxSearchResult = await lxSearch('tx', keyword, page, limit);
    if (!result?.list?.length) return [];
    return result.list.map(item => {
      const musicFreeItem = resetMediaItem(lxItemToQqMusicFreeItem(item), source.name);
      return toPluginSearchResult(musicFreeItem, source);
    });
  } catch {
    return [];
  }
}

export function qqRawAlbumToMusicFreeItem(album: Record<string, any>): Record<string, any> {
  const albumMid = album.albumMID || album.album_mid || '';
  return {
    id: album.albumID || album.albumid,
    albumMID: albumMid,
    title: album.albumName || album.album_name,
    artwork: album.albumPic || (albumMid ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${albumMid}.jpg` : undefined),
    date: album.publicTime || album.pub_time,
    singerID: album.singerID || album.singer_id,
    artist: album.singerName || album.singer_name,
    singerMID: album.singerMID || album.singer_mid,
    description: album.desc,
  };
}

export async function qqHostAlbumSearchFallback(
  source: PluginSource,
  keyword: string,
  page = 1,
  limit = 30,
): Promise<PluginAlbumResult[]> {
  return dispatchFallbackModule('plugin_fallback', 'hostAlbumSearchFallback', { source, keyword, page, limit },
    () => qqHostAlbumSearchFallbackBuiltin(source, keyword, page, limit));
}

async function qqHostAlbumSearchFallbackBuiltin(
  source: PluginSource,
  keyword: string,
  page = 1,
  limit = 30,
): Promise<PluginAlbumResult[]> {
  try {
    const rawAlbums = await txSearchAlbumsRaw(keyword, page, limit);
    if (!rawAlbums.length) return [];
    return rawAlbums.map(album => {
      const item = qqRawAlbumToMusicFreeItem(album);
      resetMediaItem(item, source.name);
      return {
        id: String(item.id ?? ''),
        name: String(item.title ?? ''),
        artist: String(item.artist ?? ''),
        coverUrl: String(item.artwork ?? ''),
        description: item.description ? String(item.description) : '',
        year: item.date ? String(item.date) : undefined,
        platform: source.name,
        platformId: String(item.id ?? ''),
        pluginId: source.id,
        rawData: item,
      };
    });
  } catch {
    return [];
  }
}

export async function qqHostAlbumSongsFallback(
  source: PluginSource,
  albumMid: string,
  page = 1,
  limit = 30,
): Promise<PluginSearchResult[]> {
  return dispatchFallbackModule('plugin_fallback', 'hostAlbumSongsFallback', { source, albumMid, page, limit },
    () => qqHostAlbumSongsFallbackBuiltin(source, albumMid, page, limit));
}

async function qqHostAlbumSongsFallbackBuiltin(
  source: PluginSource,
  albumMid: string,
  page = 1,
  limit = 30,
): Promise<PluginSearchResult[]> {
  try {
    const list = await lxGetAlbumSongs('tx', { id: albumMid, name: '' }, page, limit);
    if (!list?.length) return [];
    return list.map(item => {
      const musicFreeItem = resetMediaItem(lxItemToQqMusicFreeItem(item), source.name);
      return toPluginSearchResult(musicFreeItem, source);
    });
  } catch {
    return [];
  }
}

const QQ_TRIAL_URL_RE = /\/RS0\d[A-Za-z0-9]{8,}\.(mp3|m4a|flac)(?:[?#]|$)/i;
export function isQqTrialMediaUrl(url: string | undefined | null): boolean {
  return dispatchFallbackModuleSync('plugin_fallback', 'isQqTrialMediaUrl', { url },
    () => isQqTrialMediaUrlBuiltin(url));
}

function isQqTrialMediaUrlBuiltin(url: string | undefined | null): boolean {
  return typeof url === 'string' && QQ_TRIAL_URL_RE.test(url);
}

export async function qqFillSongDurations(
  source: PluginSource,
  platform: string | undefined,
  results: PluginSearchResult[],
): Promise<PluginSearchResult[]> {
  return dispatchFallbackModule('plugin_fallback', 'fillSongDurations', { source, platform, results },
    () => qqFillSongDurationsBuiltin(source, platform, results));
}

async function qqFillSongDurationsBuiltin(
  source: PluginSource,
  platform: string | undefined,
  results: PluginSearchResult[],
): Promise<PluginSearchResult[]> {
  if (!results.length || !isQqMusicPluginSource(source, platform)) return results;
  const missing = results.filter(r =>
    !r.duration
    && r.rawData
    && typeof r.rawData === 'object'
    && r.rawData.id !== undefined
    && r.rawData.id !== null
    && r.rawData.id !== '',
  );
  if (!missing.length) return results;
  try {
    const durationMap = await txBatchTrackInterval(missing.map(r => String(r.rawData.id)));
    if (!durationMap.size) return results;
    for (const result of missing) {
      const seconds = durationMap.get(String(result.rawData.id));
      if (seconds && seconds > 0) {
        result.duration = seconds * 1000;
        result.rawData.duration = seconds;
      }
    }
  } catch { /* 补时长失败不影响列表展示 */ }
  return results;
}
