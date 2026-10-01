import type {Song} from '../../types';
import {clearOnlineLyricsUnavailable, markOnlineLyricsUnavailable} from '../../composables/lyrics/state';
import {fetchOnlineLyricsRaw} from './onlineLyrics';

export const wordTimestampPattern = /<\d{1,3}:\d{2}/;
export const qrcXmlPattern = /<(?:QrcInfos|src=")/;

export const looksWordLevel = (text: string): boolean =>
  wordTimestampPattern.test(text) || qrcXmlPattern.test(text);

export interface OnlineLyricsLoaderDeps {
  fetchRaw?: (song: Song) => Promise<string | null>;
  getCurrentSong: () => Song | null;
  setCurrentSong: (song: Song) => void;
  patchSongMeta: (path: string, patch: Partial<Song>) => void;
  patchQueueSongMeta: (path: string, patch: Partial<Song>) => void;
  loadLyrics: (lyricsRaw?: string) => void | Promise<void>;
  isCurrentRequest: (song: Song, requestId: number) => boolean;
}

export function createOnlineLyricsLoader(deps: OnlineLyricsLoaderDeps) {
  const fetchRaw = deps.fetchRaw ?? fetchOnlineLyricsRaw;

  const loadForSong = async (song: Song, requestId: number): Promise<void> => {
    const existingLyricsRaw = song.lyrics_raw?.trim() || '';
    const canUpgradeToWordLyrics = !!existingLyricsRaw && !looksWordLevel(existingLyricsRaw);
    const isOnlineSong = song.path.startsWith('lx://') || song.path.startsWith('plugin://');
    if (!isOnlineSong) return;
    if (song.path.startsWith('lx://') && existingLyricsRaw) return;
    if (song.path.startsWith('plugin://') && existingLyricsRaw && !canUpgradeToWordLyrics) return;

    clearOnlineLyricsUnavailable(song.path);
    try {
      const lyricsRaw = await fetchRaw(song);
      if (!lyricsRaw) {
        console.warn('[Lyrics] 在线歌词获取为空:', song.path);
        if (deps.isCurrentRequest(song, requestId)) markOnlineLyricsUnavailable(song.path);
        return;
      }
      if (!deps.isCurrentRequest(song, requestId)) return;
      const currentLyricsRaw = song.lyrics_raw?.trim() || '';
      const shouldWriteLyrics = !currentLyricsRaw
        || (!looksWordLevel(currentLyricsRaw) && looksWordLevel(lyricsRaw));
      if (!shouldWriteLyrics) return;
      song.lyrics_raw = lyricsRaw;
      deps.patchSongMeta(song.path, {lyrics_raw: lyricsRaw});
      deps.patchQueueSongMeta(song.path, {lyrics_raw: lyricsRaw});
      const currentSong = deps.getCurrentSong();
      if (currentSong?.path === song.path) deps.setCurrentSong({...currentSong, lyrics_raw: lyricsRaw});
      void deps.loadLyrics(lyricsRaw);
    } catch (error) {
      console.warn('[Lyrics] 在线歌词获取失败:', error);
      if (deps.isCurrentRequest(song, requestId)) markOnlineLyricsUnavailable(song.path);
    }
  };

  return {loadForSong};
}
