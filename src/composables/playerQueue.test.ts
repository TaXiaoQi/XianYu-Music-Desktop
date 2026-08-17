import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../services/tauri/playbackApi', () => ({
  playbackApi: {
    pauseAudio: vi.fn().mockResolvedValue(undefined),
  },
}));

import { playbackApi } from '../services/tauri/playbackApi';
import type { Song } from '../types';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import { createPlayerQueue } from '../features/playback/playerQueue';

const makeSong = (overrides: Partial<Song> = {}): Song => ({
  path: '/music/demo.flac',
  name: 'demo.flac',
  title: 'Demo',
  artist: 'Artist',
  artist_names: ['Artist'],
  effective_artist_names: ['Artist'],
  album: 'Album',
  album_artist: 'Artist',
  album_key: 'album::artist',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 180,
  ...overrides,
});

describe('player queue domain', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('plays queued temp songs before the main queue', () => {
    const played: string[] = [];
    const playbackStore = usePlaybackStore();
    const playerQueue = createPlayerQueue({
      playSong: (song) => {
        played.push(song.path);
      },
      stopPlaybackRuntime: vi.fn(),
      showToast: vi.fn(),
    });

    const currentSong = makeSong({ path: '/music/current.flac', title: 'Current' });
    const queuedSong = makeSong({ path: '/music/queued.flac', title: 'Queued' });
    const tempSong = makeSong({ path: '/music/next.flac', title: 'Next Up' });

    playbackStore.currentSong = currentSong;
    playbackStore.playQueue = [currentSong, queuedSong];
    playbackStore.tempQueue = [tempSong];

    playerQueue.nextSong();

    expect(played).toEqual(['/music/next.flac']);
    expect(playbackStore.tempQueue).toEqual([]);
  });

  it('clears queue state and pauses runtime when queue is reset during playback', async () => {
    const playbackStore = usePlaybackStore();
    const stopPlaybackRuntime = vi.fn();
    const playerQueue = createPlayerQueue({
      playSong: vi.fn(),
      stopPlaybackRuntime,
      showToast: vi.fn(),
    });

    playbackStore.isPlaying = true;
    playbackStore.currentSong = makeSong({ path: '/music/current.flac' });
    playbackStore.playQueue = [makeSong({ path: '/music/a.flac' })];
    playbackStore.tempQueue = [makeSong({ path: '/music/b.flac' })];

    await playerQueue.clearQueue();

    expect(playbackStore.playQueue).toEqual([]);
    expect(playbackStore.tempQueue).toEqual([]);
    expect(playbackStore.currentSong).toBeNull();
    expect(playbackStore.isPlaying).toBe(false);
    expect(playbackApi.pauseAudio).toHaveBeenCalledTimes(1);
    expect(stopPlaybackRuntime).toHaveBeenCalledTimes(1);
  });

  it('falls back to library songs for previous navigation in shuffle mode', () => {
    const played: string[] = [];
    const playbackStore = usePlaybackStore();
    const libraryStore = useLibraryStore();
    const playerQueue = createPlayerQueue({
      playSong: (song) => {
        played.push(song.path);
      },
      stopPlaybackRuntime: vi.fn(),
      showToast: vi.fn(),
    });

    const firstSong = makeSong({ path: '/music/first.flac', title: 'First' });
    const secondSong = makeSong({ path: '/music/second.flac', title: 'Second' });
    libraryStore.songList = [firstSong, secondSong];
    playbackStore.playMode = 2;
    playbackStore.currentSong = firstSong;

    playerQueue.handleBeforePlay(secondSong);
    playbackStore.currentSong = secondSong;

    playerQueue.prevSong();

    expect(played).toEqual(['/music/first.flac']);
  });

  it('plays every candidate once before starting a new pseudo-random cycle', () => {
    const played: string[] = [];
    const playbackStore = usePlaybackStore();
    const songs = Array.from({ length: 5 }, (_, index) => makeSong({
      path: `/music/${index}.flac`,
      title: `Song ${index}`,
    }));
    let playerQueue: ReturnType<typeof createPlayerQueue>;

    playerQueue = createPlayerQueue({
      playSong: (song) => {
        playerQueue.handleBeforePlay(song);
        playbackStore.currentSong = song;
        played.push(song.path);
      },
      stopPlaybackRuntime: vi.fn(),
      showToast: vi.fn(),
    });

    playbackStore.playMode = 2;
    playbackStore.playQueue = songs;
    playbackStore.currentSong = songs[0];

    for (let index = 0; index < songs.length - 1; index += 1) {
      playerQueue.nextSong();
    }

    expect(new Set(played).size).toBe(songs.length - 1);
    expect(played).not.toContain(songs[0].path);

    const lastPathInFirstCycle = played.at(-1);
    playerQueue.nextSong();

    expect(played).toHaveLength(songs.length);
    expect(played.at(-1)).not.toBe(lastPathInFirstCycle);
  });

  it('keeps backward and forward history while using pseudo-random playback', () => {
    const played: string[] = [];
    const playbackStore = usePlaybackStore();
    const songs = Array.from({ length: 4 }, (_, index) => makeSong({
      path: `/music/${index}.flac`,
      title: `Song ${index}`,
    }));
    let playerQueue: ReturnType<typeof createPlayerQueue>;

    playerQueue = createPlayerQueue({
      playSong: (song, options) => {
        playerQueue.handleBeforePlay(song, options);
        playbackStore.currentSong = song;
        played.push(song.path);
      },
      stopPlaybackRuntime: vi.fn(),
      showToast: vi.fn(),
    });

    playbackStore.playMode = 2;
    playbackStore.playQueue = songs;
    playbackStore.currentSong = songs[0];

    playerQueue.nextSong();
    const secondPath = playbackStore.currentSong.path;
    playerQueue.nextSong();
    const thirdPath = playbackStore.currentSong.path;

    playerQueue.prevSong();
    expect(playbackStore.currentSong.path).toBe(secondPath);

    playerQueue.nextSong();
    expect(playbackStore.currentSong.path).toBe(thirdPath);

    playerQueue.prevSong();
    expect(playbackStore.currentSong.path).toBe(secondPath);
    expect(played).toHaveLength(5);
  });

  it('caps shuffle history to the most recent 256 entries', () => {
    const played: string[] = [];
    const playbackStore = usePlaybackStore();
    const libraryStore = useLibraryStore();
    const songs = Array.from({ length: 300 }, (_, index) =>
      makeSong({
        path: `/music/${index}.flac`,
        title: `Song ${index}`,
      }),
    );
    const playerQueue = createPlayerQueue({
      playSong: (song) => {
        played.push(song.path);
        playbackStore.currentSong = song;
      },
      stopPlaybackRuntime: vi.fn(),
      showToast: vi.fn(),
    });

    libraryStore.songList = songs;
    playbackStore.playMode = 2;
    playbackStore.currentSong = songs[0];

    for (let index = 1; index < songs.length; index += 1) {
      playerQueue.handleBeforePlay(songs[index]);
      playbackStore.currentSong = songs[index];
    }

    for (let index = 0; index < 256; index += 1) {
      playerQueue.prevSong();
    }

    expect(played).toHaveLength(256);
    expect(played[0]).toBe('/music/298.flac');
    expect(played[255]).toBe('/music/43.flac');
  });
});
