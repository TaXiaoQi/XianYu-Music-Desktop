import type { Song } from '../../types';
import { fetchLxSongLyricsRaw } from '../../services/domain/lxLyricFetcher';
import { getStoredPlugins, pluginGetLyric } from '../../services/domain/pluginEngine';

/**
 * 在线歌曲（lx:// / plugin://）的取词。
 *
 * 抽出来是因为**取词必须能脱离播放流程发起**：原先它只长在 `playerPlayback` 的播放分支里，
 * 于是刚进详情页、还没点播放时根本没人取词，歌词要等按下播放才出现（`state.ts` 的在线分支
 * 只能空转等待播放流程投喂）。
 *
 * 这里只负责拿到原始歌词文本，落库与刷新由调用方处理——播放流程那边还带着自己的
 * requestId / 逐行→逐字升级判断，暂不合并，以免动到播放主链路。
 */
export async function fetchOnlineLyricsRaw(song: Song): Promise<string | null> {
  try {
    if (song.path.startsWith('lx://')) {
      const raw = await fetchLxSongLyricsRaw(song);
      return raw?.trim() ? raw : null;
    }

    if (song.path.startsWith('plugin://')) {
      const searchResult = song.rawData;
      if (!searchResult?.pluginId) return null;

      const pluginSource = getStoredPlugins().find(
        (plugin) => plugin.id === searchResult.pluginId && plugin.enabled,
      );
      if (!pluginSource) return null;

      const lyricData = await pluginGetLyric(pluginSource, searchResult);
      return lyricData?.lyricsRaw?.trim() ? lyricData.lyricsRaw : null;
    }
  } catch (error) {
    console.warn('[Lyrics] 在线取词失败:', song.path.slice(0, 48), error);
  }

  return null;
}
