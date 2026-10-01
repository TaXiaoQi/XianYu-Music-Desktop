import { describe, expect, it, vi } from 'vitest';
import type { Song } from '../../types';
import { createOnlineLyricsLoader } from './onlineLyricsLoader';

const song: Song = {
  path: 'lx://wy/123',
  name: 'demo',
  title: 'Demo',
  artist: 'Artist',
  duration: 120,
} as Song;

describe('online lyrics loader', () => {
  it('ignores lyrics returned for an outdated playback request', async () => {
    const fetchRaw = vi.fn().mockResolvedValue('[00:01.00] stale');
    const patchSongMeta = vi.fn();
    const setCurrentSong = vi.fn();
    const loadLyrics = vi.fn();
    const loader = createOnlineLyricsLoader({
      fetchRaw,
      getCurrentSong: () => song,
      setCurrentSong,
      patchSongMeta,
      patchQueueSongMeta: vi.fn(),
      loadLyrics,
      isCurrentRequest: () => false,
    });

    await loader.loadForSong(song, 1);

    expect(patchSongMeta).not.toHaveBeenCalled();
    expect(setCurrentSong).not.toHaveBeenCalled();
    expect(loadLyrics).not.toHaveBeenCalled();
  });

  it('writes fresh lyrics and refreshes the current song', async () => {
    const fetchRaw = vi.fn().mockResolvedValue('<00:01.00>word');
    const patchSongMeta = vi.fn();
    const patchQueueSongMeta = vi.fn();
    const setCurrentSong = vi.fn();
    const loadLyrics = vi.fn();
    const loader = createOnlineLyricsLoader({
      fetchRaw,
      getCurrentSong: () => song,
      setCurrentSong,
      patchSongMeta,
      patchQueueSongMeta,
      loadLyrics,
      isCurrentRequest: () => true,
    });

    await loader.loadForSong(song, 1);

    expect(song.lyrics_raw).toBe('<00:01.00>word');
    expect(patchSongMeta).toHaveBeenCalledWith(song.path, { lyrics_raw: '<00:01.00>word' });
    expect(patchQueueSongMeta).toHaveBeenCalledWith(song.path, { lyrics_raw: '<00:01.00>word' });
    expect(setCurrentSong).toHaveBeenCalled();
    expect(loadLyrics).toHaveBeenCalledWith('<00:01.00>word');
  });
});
