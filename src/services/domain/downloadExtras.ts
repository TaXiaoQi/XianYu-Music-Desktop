/**
 * 在线下载服务 · 歌词与封面获取（叶子）。
 *
 * 歌词文本提取、格式转换（lrc → 纯文本、逐字/逐行选择）、封面 URL 解析，
 * 支持 lx://（落雪）和 plugin://（MusicFree）两种协议，复用各自插件引擎。
 * 依赖已有的 lxUrlResolver 与 pluginEngine 插件调用门面，无循环依赖。
 */
import type { Song, DownloadLyricsStyle } from '../../types';
import { usePlaybackStore } from '../../features/playback/store';
import {
  getStoredPlugins,
  pluginGetCover,
  pluginGetLyric,
} from './pluginEngine';
import { ensureLxPluginInstance, lxPluginGetLyric, lxPluginGetPic } from './lxPluginEngine';
import {
  parseLxPath,
  resolveLxCachedInfo,
  findLxPluginForSource,
  buildLxSongInfo,
} from './lxUrlResolver';

/** 获取歌词文本（lrc 或纯文本）用于一并下载 */
export async function fetchLyricText(
  song: Song,
  format: 'lrc' | 'txt',
  lyricsStyle: DownloadLyricsStyle,
): Promise<string | null> {
  const path = song.cue_source_path || song.path;

  // 尝试从歌曲对象或当前播放器 state 中提取已有的歌词文本作为兜底
  const playbackStore = usePlaybackStore();
  const playingSong = playbackStore.currentSong;
  const existingLyric = (song as any).lyrics
    || (song as any).lyric
    || (song as any).lyrics_raw
    || (playingSong?.path === path ? ((playingSong as any).lyrics || (playingSong as any).lyrics_raw) : null)
    || null;

  const processFormat = (lyricText: string): string => {
    if (format === 'txt') {
      return lyricText
        .replace(/\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?]/g, '')
        .replace(/<\d+,\d+>/g, '')
        .replace(/\[\d+,\d+\]/g, '')
        .trim();
    }
    return lyricText.trim();
  };

  let fetched: string | null = null;

  // plugin:// 协议：通过 MusicFree 插件引擎获取歌词
  if (path?.startsWith('plugin://')) {
    fetched = await fetchPluginLyricText(song, format, lyricsStyle);
  } else if (path?.startsWith('lx://')) {
    // lx:// 协议：通过落雪插件引擎获取歌词
    const pathInfo = parseLxPath(path);
    if (pathInfo) {
      const { source: lxSource, songmid } = pathInfo;
      try {
        const matchedPlugin = findLxPluginForSource(lxSource);
        if (matchedPlugin) {
          await ensureLxPluginInstance(matchedPlugin);
          const cachedInfo = resolveLxCachedInfo(song, lxSource, songmid);
          const songInfo = buildLxSongInfo(song, songmid, lxSource, cachedInfo);
          const result = await lxPluginGetLyric(matchedPlugin, lxSource, songInfo as any);

          const preferWordByWord = lyricsStyle === 'word-by-word';
          const wordLyric = result?.lxlyric || result?.yrc || result?.qrc;
          const lineLyric = result?.lyric;
          const lyric = (preferWordByWord && wordLyric) ? wordLyric : (lineLyric || wordLyric || '');
          if (lyric) {
            fetched = processFormat(lyric);
          }
        }
      } catch (e: any) {
        console.warn('[Download] 获取歌词失败:', e?.message);
      }
    }
  }

  if (fetched && fetched.trim().length > 0) {
    return fetched;
  }

  // 兜底：若网络请求未获取到，但歌曲原本带有一份歌词文本，使用原歌词
  if (existingLyric && typeof existingLyric === 'string' && existingLyric.trim().length > 0) {
    return processFormat(existingLyric);
  }

  return null;
}

/** plugin:// 协议获取歌词：调用 MusicFree 插件的 getLyric 方法 */
async function fetchPluginLyricText(
  song: Song,
  format: 'lrc' | 'txt',
  lyricsStyle: DownloadLyricsStyle,
): Promise<string | null> {
  const pluginId = song.plugin_id || song.rawData?.pluginId;
  if (!pluginId) return null;
  const pluginSearchResult = song.rawData || { ...song, pluginId };

  try {
    const plugins = getStoredPlugins();
    const pluginSource = plugins.find(p => p.id === pluginId && p.enabled);
    if (!pluginSource) return null;

    const result = await pluginGetLyric(pluginSource, pluginSearchResult);

    // word-by-word：优先使用 Baka/MF 统一构建的逐字歌词（lyricsRaw），
    // 可覆盖 yrc/qrc/eslrc/lxlyric；无逐字时回退到逐行（lyric）。
    // line-by-line：仅使用逐行歌词（lyric）
    const preferWordByWord = lyricsStyle === 'word-by-word';
    const wordLyric = result?.lyricsRaw || result?.lxlyric;
    const usesLyricsRaw = preferWordByWord && !!result?.lyricsRaw;
    const lineLyric = result?.lyric;
    const lyric = (preferWordByWord && wordLyric) ? wordLyric : (lineLyric || wordLyric || '');
    if (!lyric) return null;

    // 若有翻译歌词，拼接在后面；lyricsRaw 已由插件专用构建器合并过翻译/罗马音轨道，避免重复拼接
    const tlyric = result?.tlyric;
    const combined = tlyric && !usesLyricsRaw ? `${lyric}\n[offset:0]\n${tlyric}` : lyric;

    if (format === 'txt') {
      return combined
        .replace(/\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?]/g, '')
        .replace(/<\d+,\d+>/g, '')
        .replace(/\[\d+,\d+\]/g, '')
        .trim();
    }
    return combined;
  } catch (e: any) {
    console.warn('[Download][plugin] 获取歌词失败:', e?.message);
    return null;
  }
}

/**
 * 解析在线歌曲的封面图片 URL。
 * - lx:// 协议：优先取 cover_thumb_path，否则调用 LX 插件 pic action 获取
 * - plugin:// 协议：优先取 cover_thumb_path，否则调用 pluginGetCover 获取
 */
export async function resolveCoverUrl(song: Song): Promise<string | null> {
  // cover_thumb_path 已是远程 URL 时直接使用
  const thumb = song.cover_thumb_path;
  if (thumb && /^https?:\/\//.test(thumb)) return thumb;

  const path = song.cue_source_path || song.path;
  const lxPathInfo = parseLxPath(path || '');
  if (lxPathInfo) {
    const { source: lxSource, songmid } = lxPathInfo;
    try {
      const matchedPlugin = findLxPluginForSource(lxSource);
      if (!matchedPlugin) return null;

      await ensureLxPluginInstance(matchedPlugin);
      const cachedInfo = resolveLxCachedInfo(song, lxSource, songmid);
      const songInfo = buildLxSongInfo(song, songmid, lxSource, cachedInfo);
      const cover = await lxPluginGetPic(matchedPlugin, lxSource, songInfo as any);
      return cover && /^https?:\/\//.test(cover) ? cover : null;
    } catch {
      return null;
    }
  }

  if (!path.startsWith('plugin://')) return null;

  // plugin:// 歌曲：通过插件引擎获取封面
  const rawData = song.rawData;
  if (!rawData?.pluginId) return null;
  try {
    const plugins = getStoredPlugins();
    const pluginSource = plugins.find(p => p.id === rawData.pluginId && p.enabled);
    if (!pluginSource) return null;
    const cover = await pluginGetCover(pluginSource, rawData);
    return cover && /^https?:\/\//.test(cover) ? cover : null;
  } catch {
    return null;
  }
}