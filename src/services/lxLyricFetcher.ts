/**
 * lxLyricFetcher - 直接从各音乐平台 API 获取歌词（包括逐字歌词）
 *
 * 请求构造+解密逻辑已迁移到 Rust 后端 (lyric_fetcher.rs)，
 * 前端仅负责调用 Tauri 命令 fetch_lyric_from_source 并处理
 * LX 插件优先 / 直接 API 后备的两级歌词获取策略。
 *
 * 支持的音源：
 * - kg (酷狗): KRC 加密歌词，包含逐字时间
 * - kw (酷我): 加密歌词，包含逐字时间
 * - tx (QQ音乐): QRC 加密歌词，包含逐字时间
 * - wy (网易云): eapi 加密，yrc 逐字歌词
 */

import type { Song } from '../types';
import { getStoredPlugins } from './pluginEngine';
import { ensureLxPluginInstance, lxPluginGetLyric } from './lxPluginEngine';
import { lyricsApi } from './tauri/lyricsApi';
import { buildLxLyricsRaw } from './lxLyricsBuilder';
import { dispatchFallbackModule } from './fallbackModules/registry';

// ==================== Types ====================

export interface LxLyricResult {
  lyric: string;
  tlyric: string;
  rlyric: string;
  lxlyric: string;
}

export interface LxSongInfo {
  songmid: string | number;
  hash?: string;
  name: string;
  singer: string;
  albumName?: string;
  interval?: string;
  _interval?: number;
  songId?: string | number;
  strMediaMid?: string;
  albumMid?: string;
  albumId?: string | number;
  copyrightId?: string;
  source?: string;
}

// ==================== Song Info Cache ====================
// 缓存 lx://source/songmid → 完整歌曲元信息
// 使 playerPlayback.ts 在处理 lx:// 协议时能获取到 hash/songId/interval 等字段
const songInfoCache = new Map<string, LxSongInfo>();
const MAX_CACHE_SIZE = 200;

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

/**
 * 缓存歌曲元信息，供后续 playerPlayback.ts 获取歌词时使用
 * @param source 音源 (kw/kg/tx/wy)
 * @param songmid 歌曲 ID
 * @param info 完整的歌曲元信息
 */
export function cacheLxSongInfo(source: string, songmid: string | number, info: LxSongInfo): void {
  const normalizedInfo = normalizeLxSongInfo(info);
  const key = `${source}/${String(songmid)}`;
  if (songInfoCache.size >= MAX_CACHE_SIZE) {
    // 简单淘汰：删除最早的条目
    const firstKey = songInfoCache.keys().next().value;
    if (firstKey) songInfoCache.delete(firstKey);
  }
  songInfoCache.set(key, normalizedInfo);
}

/**
 * 从缓存中获取歌曲元信息
 * @param source 音源 (kw/kg/tx/wy)
 * @param songmid 歌曲 ID
 * @returns 缓存的歌曲元信息，未找到时返回 null
 */
export function getCachedLxSongInfo(source: string, songmid: string | number): LxSongInfo | null {
  return songInfoCache.get(`${source}/${String(songmid)}`) ?? null;
}

// ==================== Unified Entry Point ====================

/**
 * 获取歌词（包括逐字歌词）
 *
 * 请求构造+解密+解析均由 Rust 后端 (lyric_fetcher.rs) 完成，
 * 前端仅负责调用 Tauri 命令并返回结果。
 *
 * 注意：返回的 lxlyric 统一使用相对偏移格式 <offsetMs,durationMs>（相对于行首）。
 */
export async function fetchLxLyric(
  source: 'kw' | 'kg' | 'tx' | 'wy',
  songInfo: LxSongInfo,
): Promise<LxLyricResult | null> {
  return dispatchFallbackModule('lx_lyric', 'fetchLyric', { source, songInfo },
    () => fetchLxLyricBuiltin(source, songInfo));
}

async function fetchLxLyricBuiltin(
  source: 'kw' | 'kg' | 'tx' | 'wy',
  songInfo: LxSongInfo,
): Promise<LxLyricResult | null> {
  try {
    const normalizedSongInfo = normalizeLxSongInfo(songInfo);
    const result = await lyricsApi.fetchLyricFromSource(source, normalizedSongInfo);
    return result;
  } catch (e: any) {
    console.warn(`[lxLyricFetcher] 获取 ${source} 歌词失败:`, e?.message || e);
    return null;
  }
}

const LX_SOURCES = new Set(['kw', 'kg', 'tx', 'wy']);

/** 获取 LX 在线歌曲歌词并转换为播放器支持的原始歌词文本。 */
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
  // [修复] 缓存未命中时（如从队列播放/页面刷新后），从 song.duration 补全 _interval，
  // 否则 KG 歌词搜索的 timelength=0 会导致搜索失败。
  // 注意：缓存中 _interval 统一存储为秒数，但 LX 插件和后端酷狗API的 timelength 需要毫秒，
  // 此处统一转换为毫秒值。
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
          // 插件结果已含逐字内容（独立逐字字段，或内嵌在 lyric 字段的 LX 原生
          // <offset,duration> 标记经 buildLxLyricsRaw 转成 Enhanced LRC），视为已处理。
          // 插件只有普通 LRC（无逐字）时，若该源支持直接 API，则尝试用直接 API
          // 拿逐字歌词（如 wy 的 yrc、kw 的 lyricx），拿到逐字则优先，否则回退插件的普通 LRC。
          if (hasWordLevelContent(result) || !LX_SOURCES.has(source)) {
            return result;
          }
          const directLyrics = await fetchLxLyric(source as 'kw' | 'kg' | 'tx' | 'wy', songInfo);
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
    const lyrics = await fetchLxLyric(source as 'kw' | 'kg' | 'tx' | 'wy', songInfo);
    if (lyrics) {
      const result = buildLxLyricsRaw(lyrics);
      return result;
    }
  }

  console.warn('[LX Lyrics] 所有歌词获取方式均失败:', { source, songmid, name: songInfo.name });
  return '';
}

/** 判断歌词文本是否包含逐字时间信息（Enhanced LRC 内联时间戳 / YRC 行格式）。 */
function hasWordLevelContent(text: string): boolean {
  if (!text) return false;
  // Enhanced LRC：<mm:ss.ms> 内联绝对时间戳
  if (/<\d+:\d{2}(?:\.\d{1,3})?>/.test(text)) return true;
  // YRC（网易云）：行首 [mm:ss.mmm] 或 [ms,ms]，正文含 (start,dur,count) 逐字标记
  if (/^\[\d+:\d{2}(?:\.\d+)?\]\(/.test(text) || /^\[\d+,\d+\]/.test(text)) return true;
  // LX 原生逐字标记 <offset,dur>（无冒号，区别于 Enhanced LRC）
  if (/<\d+,\d+>/.test(text)) return true;
  return false;
}
