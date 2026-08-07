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
import { buildLyricsRaw } from '../composables/lyrics';
import { getStoredPlugins } from './pluginEngine';
import { ensureLxPluginInstance, lxPluginGetLyric } from './lxPluginEngine';
import { tauriInvoke } from './tauri/invoke';

// ==================== Types ====================

export interface LxLyricResult {
  lyric: string;
  tlyric: string;
  rlyric: string;
  lxlyric: string;
}

export interface LxSongInfo {
  songmid: string;
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

/**
 * 缓存歌曲元信息，供后续 playerPlayback.ts 获取歌词时使用
 * @param source 音源 (kw/kg/tx/wy)
 * @param songmid 歌曲 ID
 * @param info 完整的歌曲元信息
 */
export function cacheLxSongInfo(source: string, songmid: string, info: LxSongInfo): void {
  const key = `${source}/${songmid}`;
  if (songInfoCache.size >= MAX_CACHE_SIZE) {
    // 简单淘汰：删除最早的条目
    const firstKey = songInfoCache.keys().next().value;
    if (firstKey) songInfoCache.delete(firstKey);
  }
  songInfoCache.set(key, info);
}

/**
 * 从缓存中获取歌曲元信息
 * @param source 音源 (kw/kg/tx/wy)
 * @param songmid 歌曲 ID
 * @returns 缓存的歌曲元信息，未找到时返回 null
 */
export function getCachedLxSongInfo(source: string, songmid: string): LxSongInfo | null {
  return songInfoCache.get(`${source}/${songmid}`) ?? null;
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
  try {
    const result = await tauriInvoke('fetch_lyric_from_source', {
      source,
      songInfo,
    });
    return result;
  } catch (e) {
    console.warn(`[lxLyricFetcher] 获取 ${source} 歌词失败:`, e);
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
    _songmid?: string;
    _copyrightId?: string;
  };
  const cached = getCachedLxSongInfo(source, songmid);
  // [修复] 缓存未命中时（如从队列播放/页面刷新后），从 song.duration 补全 _interval，
  // 否则 KG 歌词搜索的 timelength=0 会导致搜索失败
  const fallbackInterval = song.duration > 0 ? Math.round(song.duration) : undefined;
  const songInfo: LxSongInfo = {
    songmid: cached?.songmid || extendedSong._songmid || songmid,
    hash: cached?.hash || extendedSong._hash,
    name: cached?.name || song.title || song.name,
    singer: cached?.singer || song.artist || '',
    albumName: cached?.albumName || song.album,
    interval: cached?.interval,
    _interval: cached?._interval || fallbackInterval,
    songId: cached?.songId,
    strMediaMid: cached?.strMediaMid,
    albumMid: cached?.albumMid,
    albumId: cached?.albumId,
    copyrightId: cached?.copyrightId || extendedSong._copyrightId,
    source,
  };

  console.log('[LX Lyrics] 开始获取歌词:', { source, songmid, name: songInfo.name, hasCache: !!cached, duration: song.duration, _interval: songInfo._interval });

  // [修复] 优先使用 LX 插件获取歌词（与 MF/Baka 插件相同的机制，更可靠）
  // LX 插件的 requestHandler 已在 URL 解析时初始化，直接调用 lyric 接口
  // 直接 API 作为后备：某些场景下插件可能不支持该音源的歌词，此时回退到直接 API
  try {
    const lxPlugins = getStoredPlugins().filter((p: any) => p.enabled && p.format === 'lx');
    let matchedPlugin = lxPlugins.find((p: any) => p.sources.includes(source));
    if (!matchedPlugin && lxPlugins.length > 0) matchedPlugin = lxPlugins[0];
    if (matchedPlugin) {
      await ensureLxPluginInstance(matchedPlugin);
      const pluginLyrics = await lxPluginGetLyric(matchedPlugin, source, songInfo as any);
      if (pluginLyrics?.lyric) {
        const result = buildLyricsRaw(
          pluginLyrics.lyric,
          pluginLyrics.tlyric,
          pluginLyrics.rlyric,
          pluginLyrics.lxlyric,
        );
        console.log('[LX Lyrics] LX 插件获取成功:', { resultLen: result.length, lyricLen: pluginLyrics.lyric.length, lxlyricLen: pluginLyrics.lxlyric?.length || 0 });
        return result;
      }
      console.warn('[LX Lyrics] LX 插件返回空歌词，尝试直接 API 后备');
    } else {
      console.warn('[LX Lyrics] 未找到可用的 LX 插件，尝试直接 API 后备');
    }
  } catch (e) {
    console.warn('[fetchLxSongLyricsRaw] LX 插件歌词获取失败，尝试直接 API 后备:', e);
  }

  // [后备] LX 插件失败时，直接从音乐平台 API 获取歌词（由 Rust 后端完成）
  // 某些插件可能不支持特定音源的歌词，直接 API 作为兜底
  if (LX_SOURCES.has(source)) {
    const lyrics = await fetchLxLyric(source as 'kw' | 'kg' | 'tx' | 'wy', songInfo);
    if (lyrics) {
      const result = buildLyricsRaw(lyrics.lyric, lyrics.tlyric, lyrics.rlyric, lyrics.lxlyric);
      console.log('[LX Lyrics] 直接 API 后备获取成功:', { lyricLen: lyrics.lyric.length, lxlyricLen: lyrics.lxlyric?.length || 0, resultLen: result.length });
      return result;
    }
    console.warn('[LX Lyrics] 直接 API 后备也失败');
  }

  console.warn('[LX Lyrics] 所有歌词获取方式均失败:', { source, songmid, name: songInfo.name });
  return '';
}
