import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const playbackApiBridge = vi.hoisted(() => ({ pauseAudio: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../services/tauri/playbackApi', () => ({ playbackApi: playbackApiBridge }));

import type { Song } from '../types';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import { createPlayerQueue } from '../features/playback/playerQueue';

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    path: '/music/demo.flac', name: 'demo.flac', title: 'Demo',
    artist: 'Artist', artist_names: ['Artist'], effective_artist_names: ['Artist'],
    album: 'Album', album_artist: 'Artist', album_key: 'album::artist',
    is_various_artists_album: false, collapse_artist_credits: false, duration: 180,
    ...overrides,
  };
}

const generateSongsTo = (count: number) =>
  Array.from({ length: count }, (_, index) => makeSong({ path: `/music/${index}.flac`, title: `Song ${index}` }));

const buildQueueHarness = () => {
  const playback = usePlaybackStore();
  const library = useLibraryStore();
  const playedPaths: string[] = [];
  const runtimeStopper = vi.fn();
  let queue!: ReturnType<typeof createPlayerQueue>;

  queue = createPlayerQueue({
    playSong: (song, options) => { queue.handleBeforePlay(song, options); playback.currentSong = song; playedPaths.push(song.path); },
    stopPlaybackRuntime: runtimeStopper,
    showToast: vi.fn(),
  });

  return { queue, playback, library, playedPaths, stopPlaybackRuntime: runtimeStopper };
};

describe('createPlayerQueue', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); });

  it('drains queued temp songs ahead of the main queue', () => {
    const { queue, playback, playedPaths } = buildQueueHarness();
    const [currentSong, queuedSong, tempSong] = [
      makeSong({ path: '/music/current.flac', title: 'Current' }),
      makeSong({ path: '/music/queued.flac', title: 'Queued' }),
      makeSong({ path: '/music/next.flac', title: 'Next Up' }),
    ];

    playback.currentSong = currentSong;
    playback.playQueue = [currentSong, queuedSong];
    playback.tempQueue = [tempSong];

    queue.nextSong();

    expect(playedPaths).toEqual(['/music/next.flac']);
    expect(playback.tempQueue).toEqual([]);
  });

  it('empties queue state and halts the runtime while a song is playing', async () => {
    const { queue, playback, stopPlaybackRuntime } = buildQueueHarness();

    playback.isPlaying = true;
    playback.currentSong = makeSong({ path: '/music/current.flac' });
    playback.playQueue = [makeSong({ path: '/music/a.flac' })];
    playback.tempQueue = [makeSong({ path: '/music/b.flac' })];

    await queue.clearQueue();

    expect(playback.playQueue).toEqual([]);
    expect(playback.tempQueue).toEqual([]);
    expect(playback.currentSong).toBeNull();
    expect(playback.isPlaying).toBe(false);
    expect(playbackApiBridge.pauseAudio).toHaveBeenCalledTimes(1); expect(stopPlaybackRuntime).toHaveBeenCalledTimes(1);
  });

  it('resolves previous-track navigation from the library song list', () => {
    const { queue, playback, library, playedPaths } = buildQueueHarness();
    const [firstSong, secondSong] = [
      makeSong({ path: '/music/first.flac', title: 'First' }),
      makeSong({ path: '/music/second.flac', title: 'Second' }),
    ];

    library.songList = [firstSong, secondSong];
    playback.playMode = 2;
    playback.currentSong = firstSong;

    queue.handleBeforePlay(secondSong);
    playback.currentSong = secondSong;

    queue.prevSong();

    expect(playedPaths).toEqual(['/music/first.flac']);
  });

  it('visits every candidate once before starting the next pseudo-random cycle', () => {
    const { queue, playback, playedPaths } = buildQueueHarness();
    const songs = generateSongsTo(5);

    playback.playMode = 2;
    playback.playQueue = songs;
    playback.currentSong = songs[0];

    for (let step = 0; step < songs.length - 1; step += 1) { queue.nextSong(); }

    expect(new Set(playedPaths).size).toBe(songs.length - 1);
    expect(playedPaths).not.toContain(songs[0].path);

    const lastPathOfFirstCycle = playedPaths.at(-1);
    queue.nextSong();

    expect(playedPaths).toHaveLength(songs.length);
    expect(playedPaths.at(-1)).not.toBe(lastPathOfFirstCycle);
  });

  it('keeps backward and forward positions across pseudo-random jumps', () => {
    const { queue, playback, playedPaths } = buildQueueHarness();
    const songs = generateSongsTo(4);

    playback.playMode = 2;
    playback.playQueue = songs;
    playback.currentSong = songs[0];

    queue.nextSong();
    const secondPath = playback.currentSong.path;
    queue.nextSong();
    const thirdPath = playback.currentSong.path;

    queue.prevSong();
    expect(playback.currentSong.path).toBe(secondPath);

    queue.nextSong();
    expect(playback.currentSong.path).toBe(thirdPath);

    queue.prevSong();
    expect(playback.currentSong.path).toBe(secondPath);
    expect(playedPaths).toHaveLength(5);
  });

  it('retains only the most recent 256 history entries', () => {
    const { queue, playback, library, playedPaths } = buildQueueHarness();
    const songs = generateSongsTo(300);

    library.songList = songs;
    playback.playMode = 2;
    playback.currentSong = songs[0];

    for (let songIndex = 1; songIndex < songs.length; songIndex += 1) {
      queue.handleBeforePlay(songs[songIndex]); playback.currentSong = songs[songIndex];
    }

    for (let step = 0; step < 256; step += 1) { queue.prevSong(); }

    expect(playedPaths).toHaveLength(256);
    expect(playedPaths[0]).toBe('/music/298.flac');
    expect(playedPaths[255]).toBe('/music/43.flac');
  });
});
