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

export async function fetchLyricText(
  song: Song,
  format: 'lrc' | 'txt',
  lyricsStyle: DownloadLyricsStyle,
): Promise<string | null> {
  const path = song.cue_source_path || song.path;

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

  if (path?.startsWith('plugin://')) {
    fetched = await fetchPluginLyricText(song, format, lyricsStyle);
  } else if (path?.startsWith('lx://')) {
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

  if (existingLyric && typeof existingLyric === 'string' && existingLyric.trim().length > 0) {
    return processFormat(existingLyric);
  }

  return null;
}

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

    const preferWordByWord = lyricsStyle === 'word-by-word';
    const wordLyric = result?.lyricsRaw || result?.lxlyric;
    const usesLyricsRaw = preferWordByWord && !!result?.lyricsRaw;
    const lineLyric = result?.lyric;
    const lyric = (preferWordByWord && wordLyric) ? wordLyric : (lineLyric || wordLyric || '');
    if (!lyric) return null;

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

export async function resolveCoverUrl(song: Song): Promise<string | null> {
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