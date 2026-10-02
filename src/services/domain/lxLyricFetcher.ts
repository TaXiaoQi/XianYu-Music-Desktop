import type { Song } from '../../types';
import { getStoredPlugins } from './pluginEngine';
import { ensureLxPluginInstance, lxPluginGetLyric } from './lxPluginEngine';
import { lyricsApi } from '../tauri/lyricsApi';
import { buildLxLyricsRaw } from './lxLyricsBuilder';
import { dispatchFallbackModule } from '../fallbackModules/registry';
// ==================== Types ==================== 
export interface LxLyricResult { // 实现
  lyric: string; // 实现
  tlyric: string; // 实现
  rlyric: string; // 实现
  lxlyric: string; // 实现
} // 实现
export interface LxSongInfo { // 实现
  songmid: string | number;
  hash?: string; // 实现
  name: string; // 实现
  singer: string; // 实现
  albumName?: string; // 实现
  interval?: string; // 实现
  _interval?: number; // 实现
  songId?: string | number; // 实现
  strMediaMid?: string; // 实现
  albumMid?: string; // 实现
  albumId?: string | number; // 实现
  copyrightId?: string; // 实现
  source?: string; // 实现
} // 实现
// ==================== Song Info Cache ==================== 
const songInfoCache = new Map<string, LxSongInfo>(); // 实现
const MAX_CACHE_SIZE = 200; // 实现
function normalizeOptionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value);
  return text.length > 0 ? text : undefined;
}

function normalizeLxSongInfo(songInfo: LxSongInfo): LxSongInfo & { songmid: string } {
  return {
    ...songInfo,
    songmid: String(songInfo.songmid),
    hash: normalizeOptionalString(songInfo.hash),
    name: String(songInfo.name || ''),
    singer: String(songInfo.singer || ''),
    albumName: normalizeOptionalString(songInfo.albumName),
    interval: normalizeOptionalString(songInfo.interval),
    strMediaMid: normalizeOptionalString(songInfo.strMediaMid),
    albumMid: normalizeOptionalString(songInfo.albumMid),
    copyrightId: normalizeOptionalString(songInfo.copyrightId),
    source: normalizeOptionalString(songInfo.source),
  };
}

export function cacheLxSongInfo(source: string, songmid: string | number, info: LxSongInfo): void {
  const normalizedInfo = normalizeLxSongInfo(info);
  const key = `${source}/${String(songmid)}`;
  if (songInfoCache.size >= MAX_CACHE_SIZE) { // 实现
    const firstKey = songInfoCache.keys().next().value; // 实现
    if (firstKey) songInfoCache.delete(firstKey); // 实现
  } // 实现
  songInfoCache.set(key, normalizedInfo);
} // 实现
export function getCachedLxSongInfo(source: string, songmid: string | number): LxSongInfo | null {
  return songInfoCache.get(`${source}/${String(songmid)}`) ?? null;
} // 实现
// ==================== Unified Entry Point ==================== 
export async function fetchLxLyric( // 实现
  source: LxDirectSource,
  songInfo: LxSongInfo, // 实现
): Promise<LxLyricResult | null> {
  return dispatchFallbackModule('lx_lyric', 'fetchLyric', { source, songInfo },
    () => fetchLxLyricBuiltin(source, songInfo));
}

async function fetchLxLyricBuiltin(
  source: LxDirectSource,
  songInfo: LxSongInfo,
): Promise<LxLyricResult | null> { // 实现
  try { // 实现
    const normalizedSongInfo = normalizeLxSongInfo(songInfo);
    const result = await lyricsApi.fetchLyricFromSource(source, normalizedSongInfo);
    return result; // 实现
  } catch (e: any) {
    console.warn(`[lxLyricFetcher] 获取 ${source} 歌词失败:`, e?.message || e);
    return null; // 实现
  } // 实现
} // 实现

const LX_SOURCES = new Set(['kw', 'kg', 'tx', 'wy', 'mg']);

type LxDirectSource = 'kw' | 'kg' | 'tx' | 'wy' | 'mg';

export async function fetchLxSongLyricsRaw(song: Song): Promise<string> {
  if (song.lyrics_raw?.trim()) return song.lyrics_raw;

  const match = /^lx:\/\/([^/]+)\/(.+)$/.exec(song.path);
  if (!match) return '';

  const [, source, songmid] = match;
  if (!LX_SOURCES.has(source) || !songmid) return '';

  const extendedSong = song as Song & {
    _hash?: string;
    _songmid?: string | number;
    _copyrightId?: string;
    _songId?: string | number;
    _strMediaMid?: string;
    _albumMid?: string;
    _albumId?: string | number;
  };
  const cached = getCachedLxSongInfo(source, songmid);
  const rawInterval = cached?._interval || (song.duration > 0 ? Math.round(song.duration) : undefined);
  const intervalMs = rawInterval ? rawInterval * 1000 : undefined;

  const songInfo: LxSongInfo = {
    songmid: cached?.songmid || extendedSong._songmid || songmid,
    hash: cached?.hash || extendedSong._hash,
    name: cached?.name || song.title || song.name,
    singer: cached?.singer || song.artist || '',
    albumName: cached?.albumName || song.album,
    interval: cached?.interval,
    _interval: intervalMs,
    songId: cached?.songId ?? extendedSong._songId,
    strMediaMid: cached?.strMediaMid ?? extendedSong._strMediaMid,
    albumMid: cached?.albumMid ?? extendedSong._albumMid,
    albumId: cached?.albumId ?? extendedSong._albumId,
    copyrightId: cached?.copyrightId || extendedSong._copyrightId,
    source,
  };

  try {
    const lxPlugins = getStoredPlugins().filter((p: any) => p.enabled && p.format === 'lx');
    let matchedPlugin = lxPlugins.find((p: any) => p.sources.includes(source));
    if (!matchedPlugin && lxPlugins.length > 0) matchedPlugin = lxPlugins[0];
    if (matchedPlugin) {
      await ensureLxPluginInstance(matchedPlugin);
      const pluginLyrics = await lxPluginGetLyric(matchedPlugin, source, songInfo as any);
      if (pluginLyrics && (pluginLyrics.lyric || pluginLyrics.lxlyric || pluginLyrics.yrc || pluginLyrics.qrc || pluginLyrics.eslrc)) {
        const result = buildLxLyricsRaw(pluginLyrics);
        if (result && result.trim()) {
          if (hasWordLevelContent(result) || !LX_SOURCES.has(source)) {
            return result;
          }
          const directLyrics = await fetchLxLyric(source as LxDirectSource, songInfo);
          if (directLyrics) {
            const directResult = buildLxLyricsRaw(directLyrics);
            if (directResult && directResult.trim() && hasWordLevelContent(directResult)) {
              return directResult;
            }
          }
          return result;
        }
      }
    } else {
      // no plugin: fall through to direct API
    }
  } catch (e) {
    console.warn('[fetchLxSongLyricsRaw] LX 插件歌词获取失败，尝试直接 API 后备:', e);
  }

  if (LX_SOURCES.has(source)) {
    const lyrics = await fetchLxLyric(source as LxDirectSource, songInfo);
    if (lyrics) {
      const result = buildLxLyricsRaw(lyrics);
      return result;
    }
  }

  console.warn('[LX Lyrics] 所有歌词获取方式均失败:', { source, songmid, name: songInfo.name });
  return '';
}

function hasWordLevelContent(text: string): boolean {
  if (!text) return false;
  if (/<\d+:\d{2}(?:\.\d{1,3})?>/.test(text)) return true;
  if (/^\[\d+:\d{2}(?:\.\d+)?\]\(/.test(text) || /^\[\d+,\d+\]/.test(text)) return true;
  if (/<\d+,\d+>/.test(text)) return true;
  return false;
}
