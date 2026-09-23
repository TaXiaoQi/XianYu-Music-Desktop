import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const loadCoverMock = vi.fn().mockResolvedValue('');
const loadCoverPathMock = vi.fn().mockResolvedValue('');
const loadFullCoverMock = vi.fn().mockResolvedValue('');
const peekCoverUrlMock = vi.fn().mockReturnValue('');
const peekCoverPathMock = vi.fn().mockReturnValue('');
const getFullCoverUrlMock = vi.fn().mockReturnValue('');
const preloadFullCoversMock = vi.fn();
const preloadPriorityCoversMock = vi.fn();
const retainFullCoverPathsMock = vi.fn();
const primeCoverPathMock = vi.fn().mockReturnValue('');
const {
  fetchLxSongLyricsRawMock,
  pluginGetMusicInfoMock,
  pluginGetSupportedQualitiesMock,
  isBakaPluginMock,
} = vi.hoisted(() => ({
  fetchLxSongLyricsRawMock: vi.fn().mockResolvedValue(''),
  pluginGetMusicInfoMock: vi.fn().mockResolvedValue({ url: 'https://example.test/audio.mp3' }),
  pluginGetSupportedQualitiesMock: vi.fn().mockResolvedValue(['320k']),
  isBakaPluginMock: vi.fn().mockResolvedValue(false),
}));

vi.mock('../services/domain/lxLyricFetcher', () => ({
  fetchLxSongLyricsRaw: fetchLxSongLyricsRawMock,
}));

vi.mock('../services/domain/usageStats', () => ({
  reportUserBehavior: vi.fn(),
}));

vi.mock('../services/domain/pluginEngine', () => ({
  getStoredPlugins: vi.fn(() => [{
    id: 'lx-test-plugin',
    name: 'LX Test Plugin',
    enabled: true,
    format: 'lx',
    sources: ['wy', 'tx'],
  }]),
  pluginGetCover: vi.fn().mockResolvedValue(null),
  pluginGetLyric: vi.fn().mockResolvedValue(null),
  pluginGetMusicInfo: pluginGetMusicInfoMock,
  pluginGetBakaMusicInfo: vi.fn().mockResolvedValue(null),
  pluginGetSupportedQualities: pluginGetSupportedQualitiesMock,
  isBakaPlugin: isBakaPluginMock,
  getLastPluginError: vi.fn(() => ''),
}));

vi.mock('../services/domain/downloadHistory', () => ({
  checkDownloadExists: vi.fn().mockResolvedValue(null),
}));

vi.mock('../services/domain/lxPluginEngine', () => ({
  ensureLxPluginInstance: vi.fn().mockResolvedValue(undefined),
  lxPluginGetMusicUrl: vi.fn().mockResolvedValue({ url: 'https://example.test/audio.mp3' }),
}));

vi.mock('../services/domain/lxSongCache', () => ({
  getCachedLxSong: vi.fn(() => null),
}));

vi.mock('../services/domain/lxSourceFallback', () => ({
  findAlternativeLxSource: vi.fn().mockResolvedValue(null),
  getLxSourceDisplayName: vi.fn((source: string) => source),
}));

vi.mock('../services/tauri/playbackApi', () => ({
  playbackApi: {
    playAudio: vi.fn().mockResolvedValue(undefined),
    updatePlaybackMetadata: vi.fn().mockResolvedValue(undefined),
    getPlaybackProgress: vi.fn().mockResolvedValue(0),
    pauseAudio: vi.fn().mockResolvedValue(undefined),
    resumeAudio: vi.fn().mockResolvedValue(undefined),
    seekAudio: vi.fn().mockResolvedValue(undefined),
    setVolume: vi.fn().mockResolvedValue(undefined),
    stopAudio: vi.fn().mockResolvedValue(undefined),
    recordPlay: vi.fn().mockResolvedValue(undefined),
    getPlaybackReady: vi.fn().mockResolvedValue(true),
    getPlaybackStartFailed: vi.fn().mockResolvedValue(false),
    getPlaybackStartFailedInfo: vi.fn().mockResolvedValue({ failed: false, reason: null }),
    getCurrentOutputDevice: vi.fn().mockResolvedValue({
      selected_device_id: null,
      active_device_name: 'Default Output',
      follows_system_default: true,
      requested_output_mode: 'shared',
      active_output_mode: 'shared',
      fallback_reason: null,
    }),
  },
}));

vi.mock('./useCoverCache', () => ({
  useCoverCache: () => ({
    loadCover: loadCoverMock,
    loadCoverPath: loadCoverPathMock,
    loadFullCover: loadFullCoverMock,
    peekCoverUrl: peekCoverUrlMock,
    peekCoverPath: peekCoverPathMock,
    getFullCoverUrl: getFullCoverUrlMock,
    preloadFullCovers: preloadFullCoversMock,
    preloadPriorityCovers: preloadPriorityCoversMock,
    retainFullCoverPaths: retainFullCoverPathsMock,
    primeCoverPath: primeCoverPathMock,
  }),
}));

const tauriEventListeners = new Map<string, (event: { payload: unknown }) => void>();
const emitPlaybackProgress = (position: number, duration: number) => {
  tauriEventListeners.get('playback:progress')?.({ payload: { position, duration, is_playing: true } });
};
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockImplementation((event: string, handler: (event: { payload: unknown }) => void) => {
    tauriEventListeners.set(event, handler);
    return Promise.resolve(() => tauriEventListeners.delete(event));
  }),
  emitTo: vi.fn(),
}));

import type { Song } from '../types';
import { usePlaybackStore } from '../features/playback';
import { useSettingsStore } from '../features/settings/store';
import { playbackApi } from '../services/tauri/playbackApi';
import { pluginApi } from '../services/tauri/pluginApi';
import { reportUserBehavior } from '../services/domain/usageStats';
import { createPlayerPlayback } from '../features/playback/playerPlayback';
import { useUiStore } from '../shared/stores/ui';
import { setMainWindowRenderingSnapshot } from './renderingPower';

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

describe('player playback domain', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    useSettingsStore().settings.audio.fadeInOutEnabled = false;
    loadCoverMock.mockResolvedValue('');
    loadCoverPathMock.mockResolvedValue('');
    loadFullCoverMock.mockResolvedValue('');
    peekCoverUrlMock.mockReturnValue('');
    peekCoverPathMock.mockReturnValue('');
    getFullCoverUrlMock.mockReturnValue('');
    preloadFullCoversMock.mockReset();
    preloadPriorityCoversMock.mockReset();
    retainFullCoverPathsMock.mockReset();
    primeCoverPathMock.mockReturnValue('');
    fetchLxSongLyricsRawMock.mockReset();
    fetchLxSongLyricsRawMock.mockResolvedValue('');
    pluginGetMusicInfoMock.mockReset();
    pluginGetMusicInfoMock.mockResolvedValue({ url: 'https://example.test/audio.mp3' });
    pluginGetSupportedQualitiesMock.mockReset();
    pluginGetSupportedQualitiesMock.mockResolvedValue(['320k']);
    isBakaPluginMock.mockReset();
    isBakaPluginMock.mockResolvedValue(false);
    setMainWindowRenderingSnapshot({
      documentHidden: false,
      windowFocused: true,
      windowVisible: true,
      windowMinimized: false,
      miniMode: false,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('rebuilds the queue from the display song list order when playback starts', async () => {
    const playbackStore = usePlaybackStore();
    const firstSong = makeSong({ path: '/music/first.flac', title: 'First' });
    const secondSong = makeSong({ path: '/music/second.flac', title: 'Second' });
    const displaySongList = [firstSong, secondSong];
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => displaySongList,
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(firstSong);

    expect(playbackStore.playQueue.map(song => song.path)).toEqual(displaySongList.map(song => song.path));
    playerPlayback.dispose();
  });

  it('inserts a searched song directly after the previously playing song', async () => {
    const playbackStore = usePlaybackStore();
    const songA = makeSong({ path: '/music/a.flac', title: 'A' });
    const songB = makeSong({ path: '/music/b.flac', title: 'B' });
    const songC = makeSong({ path: '/music/c.flac', title: 'C' });
    const songD = makeSong({ path: '/music/d.flac', title: 'D' });
    const searchedSong = makeSong({ path: '/music/search.flac', title: 'Search' });
    playbackStore.currentSong = songA;
    playbackStore.playQueue = [songA, songB, songC, songD];

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [searchedSong],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(searchedSong, { insertAfterCurrent: true });

    expect(playbackStore.currentSong?.path).toBe(searchedSong.path);
    expect(playbackStore.playQueue.map(song => song.path)).toEqual([
      songA.path,
      searchedSong.path,
      songB.path,
      songC.path,
      songD.path,
    ]);
    playerPlayback.dispose();
  });

  it('prefers tagged song title when reporting playback metadata', async () => {
    const song = makeSong({ name: 'i-dle - Allergy.flac', title: 'Allergy' });
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song);

    expect(playbackApi.playAudio).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Allergy',
    }));
    playerPlayback.dispose();
  });

  it('reports two plays and 6:30 of listening for two complete 3:15 sessions', async () => {
    const song = makeSong({ duration: 195 });
    let periodicFlush: (() => void) | undefined;
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('setInterval', vi.fn((callback: () => void, delay: number) => {
      if (delay === 30_000) periodicFlush = callback;
      return delay;
    }));
    vi.stubGlobal('clearInterval', vi.fn());

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song);
    expect(periodicFlush).toBeDefined();

    for (let index = 1; index <= 6; index += 1) {
      dateNow.mockReturnValue(100_000 + index * 30_000);
      periodicFlush?.();
    }

    dateNow.mockReturnValue(295_000);
    await playerPlayback.pauseSong();
    await playerPlayback.playSong(song);

    for (let index = 1; index <= 6; index += 1) {
      dateNow.mockReturnValue(295_000 + index * 30_000);
      periodicFlush?.();
    }

    dateNow.mockReturnValue(490_000);
    await playerPlayback.pauseSong();

    const recordedPayloads = vi.mocked(playbackApi.recordPlay).mock.calls.map(([payload]) => payload);
    expect(recordedPayloads.filter(payload => payload.countAsPlay)).toHaveLength(2);
    expect(recordedPayloads.reduce((sum, payload) => sum + payload.listenedMs, 0)).toBe(390_000);

    playerPlayback.dispose();
    dateNow.mockRestore();
    vi.unstubAllGlobals();
  });

  it('does not count or report listening time while no audio output device is active', async () => {
    const song = makeSong({ duration: 195 });
    let periodicFlush: (() => void) | undefined;
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('setInterval', vi.fn((callback: () => void, delay: number) => {
      if (delay === 30_000) periodicFlush = callback;
      return delay;
    }));
    vi.stubGlobal('clearInterval', vi.fn());

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song);
    expect(periodicFlush).toBeDefined();

    tauriEventListeners.get('audio-output-device-changed')?.({ payload: { active_device_name: null } });

    for (let index = 1; index <= 3; index += 1) {
      dateNow.mockReturnValue(100_000 + index * 30_000);
      periodicFlush?.();
    }

    dateNow.mockReturnValue(190_000);
    await playerPlayback.pauseSong();

    expect(playbackApi.recordPlay).not.toHaveBeenCalled();
    expect(reportUserBehavior).not.toHaveBeenCalled();

    playerPlayback.dispose();
    dateNow.mockRestore();
    vi.unstubAllGlobals();
  });

  it('does not count or report listening time while volume is below 1', async () => {
    const playbackStore = usePlaybackStore();
    const song = makeSong({ duration: 195 });
    let periodicFlush: (() => void) | undefined;
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('setInterval', vi.fn((callback: () => void, delay: number) => {
      if (delay === 30_000) periodicFlush = callback;
      return delay;
    }));
    vi.stubGlobal('clearInterval', vi.fn());

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song);
    expect(periodicFlush).toBeDefined();

    playbackStore.volume = 0;

    for (let index = 1; index <= 3; index += 1) {
      dateNow.mockReturnValue(100_000 + index * 30_000);
      periodicFlush?.();
    }

    dateNow.mockReturnValue(190_000);
    await playerPlayback.pauseSong();

    expect(playbackApi.recordPlay).not.toHaveBeenCalled();
    expect(reportUserBehavior).not.toHaveBeenCalled();

    playerPlayback.dispose();
    dateNow.mockRestore();
    vi.unstubAllGlobals();
  });

  it('counts only audible time when the output device is removed and restored mid-playback', async () => {
    const song = makeSong({ duration: 195 });
    let periodicFlush: (() => void) | undefined;
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('setInterval', vi.fn((callback: () => void, delay: number) => {
      if (delay === 30_000) periodicFlush = callback;
      return delay;
    }));
    vi.stubGlobal('clearInterval', vi.fn());

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song);
    expect(periodicFlush).toBeDefined();

    dateNow.mockReturnValue(130_000);
    periodicFlush?.();

    tauriEventListeners.get('audio-output-device-changed')?.({ payload: { active_device_name: null } });
    dateNow.mockReturnValue(160_000);
    periodicFlush?.();
    dateNow.mockReturnValue(190_000);
    periodicFlush?.();

    tauriEventListeners.get('audio-output-device-changed')?.({ payload: { active_device_name: 'Default Output' } });
    dateNow.mockReturnValue(220_000);
    periodicFlush?.();

    dateNow.mockReturnValue(250_000);
    await playerPlayback.pauseSong();

    const recordedPayloads = vi.mocked(playbackApi.recordPlay).mock.calls.map(([payload]) => payload);
    expect(recordedPayloads.reduce((sum, payload) => sum + payload.listenedMs, 0)).toBe(90_000);

    playerPlayback.dispose();
    dateNow.mockRestore();
    vi.unstubAllGlobals();
  });

  it('does not auto-advance songs with unknown duration', async () => {
    const song = makeSong({ path: 'remote://source/demo.flac', duration: 0 });
    const handleAutoNext = vi.fn();
    let frameCallback: FrameRequestCallback | undefined;
    vi
      .stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frameCallback = callback;
        return 1;
      });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext,
    });

    await playerPlayback.playSong(song);
    expect(frameCallback).toBeDefined();
    (frameCallback as FrameRequestCallback)(performance.now() + 16);

    expect(handleAutoNext).not.toHaveBeenCalled();

    playerPlayback.dispose();
    vi.unstubAllGlobals();
  });

  it('updates playback progress with a low-frequency timer while main window rendering is low power', async () => {
    const song = makeSong({ duration: 180 });
    const handleAutoNext = vi.fn();
    const requestAnimationFrameMock = vi.fn();
    const setTimeoutMock = vi.fn().mockReturnValue(7);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('setTimeout', setTimeoutMock);
    vi.stubGlobal('clearTimeout', vi.fn());
    setMainWindowRenderingSnapshot({ windowVisible: false });

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext,
    });

    await playerPlayback.playSong(song);

    expect(requestAnimationFrameMock).not.toHaveBeenCalled();
    expect(setTimeoutMock).toHaveBeenCalledWith(expect.any(Function), 1000);

    playerPlayback.dispose();
    vi.unstubAllGlobals();
  });

  it('keeps cue track time relative when the backend confirms an absolute seek position', async () => {
    const playbackStore = usePlaybackStore();
    const song = makeSong({
      path: '/music/album.cue::track02',
      cue_source_path: '/music/album.flac',
      cue_start_offset: 180_000,
      cue_end_offset: 300_000,
      duration: 120,
    });
    playbackStore.currentSong = song;

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.seekTo(10);

    const seekRequest = vi.mocked(playbackApi.seekAudio).mock.calls[0]?.[0];
    expect(seekRequest).toEqual(expect.objectContaining({
      time: 190,
    }));

    playerPlayback.handleSeekCompleted({
      request_id: seekRequest.requestId,
      time: seekRequest.time,
    });

    expect(playbackStore.currentTime).toBe(10);
    playerPlayback.dispose();
  });

  it('strips the file extension when title metadata is missing', async () => {
    const song = makeSong({ name: 'i-dle - Allergy.flac', title: '   ' });
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song);

    expect(playbackApi.playAudio).toHaveBeenCalledWith(expect.objectContaining({
      title: 'i-dle - Allergy',
    }));
    playerPlayback.dispose();
  });

  it('updates the full-size cover state when switching songs in the player detail view', async () => {
    const playbackStore = usePlaybackStore();
    const uiStore = useUiStore();
    const song = makeSong({ path: '/music/full-cover.flac', title: 'Full Cover' });

    uiStore.showPlayerDetail = true;
    loadCoverMock.mockResolvedValue('thumb-url');
    loadFullCoverMock.mockResolvedValue('full-url');

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song);
    await Promise.resolve();

    expect(loadFullCoverMock).toHaveBeenCalledWith(song.path);
    expect(playbackStore.currentCoverFull).toBe('full-url');
    playerPlayback.dispose();
  });

  it('starts loading the current thumbnail before the audio backend finishes switching songs', async () => {
    const song = makeSong({ path: '/music/current-thumbnail.flac', title: 'Current Thumbnail' });
    let resolvePlayAudio!: () => void;
    vi.mocked(playbackApi.playAudio).mockReturnValueOnce(new Promise<void>((resolve) => {
      resolvePlayAudio = resolve;
    }));

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    const playPromise = playerPlayback.playSong(song);

    expect(loadCoverMock).toHaveBeenCalledWith(song.path);

    resolvePlayAudio();
    await playPromise;
    playerPlayback.dispose();
  });

  it('uses the persisted thumbnail path immediately when switching songs', async () => {
    const playbackStore = usePlaybackStore();
    const song = makeSong({
      path: '/music/persisted-thumb.flac',
      title: 'Persisted Thumb',
      cover_thumb_path: 'C:\\covers\\persisted-thumb.jpg',
    });
    primeCoverPathMock.mockReturnValue('asset://C:\\covers\\persisted-thumb.jpg');

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song);

    expect(primeCoverPathMock).toHaveBeenCalledWith(song.path, song.cover_thumb_path);
    expect(playbackStore.currentCover).toBe('asset://C:\\covers\\persisted-thumb.jpg');
    expect(loadCoverMock).toHaveBeenCalledWith(song.path);
    playerPlayback.dispose();
  });

  it('keeps the previous visible cover while the next thumbnail is loading', async () => {
    const playbackStore = usePlaybackStore();
    const oldCover = 'asset://C:\\covers\\old-thumb.jpg';
    const song = makeSong({ path: '/music/cold-hdd.flac', title: 'Cold HDD' });
    let resolvePlayAudio!: () => void;
    playbackStore.currentCover = oldCover;
    vi.mocked(playbackApi.playAudio).mockReturnValueOnce(new Promise<void>((resolve) => {
      resolvePlayAudio = resolve;
    }));

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    const playPromise = playerPlayback.playSong(song);

    expect(playbackStore.currentCover).toBe(oldCover);

    resolvePlayAudio();
    await playPromise;
    playerPlayback.dispose();
  });

  it('clears the previous cover after confirming the next song has no cover', async () => {
    const playbackStore = usePlaybackStore();
    const oldCover = 'asset://C:\\covers\\old-thumb.jpg';
    const song = makeSong({ path: '/music/no-cover.flac', title: 'No Cover' });
    let resolveCover!: (cover: string) => void;
    playbackStore.currentCover = oldCover;
    loadCoverMock.mockReturnValueOnce(new Promise<string>((resolve) => {
      resolveCover = resolve;
    }));

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    const playPromise = playerPlayback.playSong(song);
    expect(playbackStore.currentCover).toBe(oldCover);

    resolveCover('');
    await playPromise;
    await vi.waitFor(() => expect(playbackStore.currentCover).toBe(''));
    playerPlayback.dispose();
  });

  it('does not carry the previous full cover into the next song detail view', async () => {
    const playbackStore = usePlaybackStore();
    const uiStore = useUiStore();
    const oldCover = 'asset://C:\\covers\\old-thumb.jpg';
    const oldFullCover = 'asset://C:\\covers\\old-full.png';
    const song = makeSong({ path: '/music/new-song.flac', title: 'New Song' });
    let resolvePlayAudio!: () => void;
    uiStore.showPlayerDetail = true;
    playbackStore.currentCover = oldCover;
    playbackStore.currentCoverPath = '/music/old-song.flac';
    playbackStore.currentCoverFull = oldFullCover;
    vi.mocked(playbackApi.playAudio).mockReturnValueOnce(new Promise<void>((resolve) => {
      resolvePlayAudio = resolve;
    }));

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    const playPromise = playerPlayback.playSong(song);

    expect(playbackStore.currentCover).toBe(oldCover);
    expect(playbackStore.currentCoverPath).toBe('/music/old-song.flac');
    expect(playbackStore.currentCoverFull).toBe('');

    resolvePlayAudio();
    await playPromise;
    playerPlayback.dispose();
  });

  it('loads LX lyrics asynchronously and refreshes the current song', async () => {
    const playbackStore = usePlaybackStore();
    const loadLyrics = vi.fn();
    const song = makeSong({ path: 'lx://wy/123', title: 'Online' });
    fetchLxSongLyricsRawMock.mockResolvedValue('[00:01.00]Online lyric');
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics,
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song);
    await vi.waitFor(() => {
      expect(playbackStore.currentSong?.lyrics_raw).toBe('[00:01.00]Online lyric');
    });

    expect(fetchLxSongLyricsRawMock).toHaveBeenCalledWith(song);
    expect(playbackStore.playQueue[0]?.lyrics_raw).toBe('[00:01.00]Online lyric');
    expect(loadLyrics).toHaveBeenCalled();
    playerPlayback.dispose();
  });

  it('ignores lyrics returned for an outdated LX playback request', async () => {
    const playbackStore = usePlaybackStore();
    const firstSong = makeSong({ path: 'lx://wy/first', title: 'First' });
    const secondSong = makeSong({ path: '/music/second.flac', title: 'Second' });
    let resolveLyrics!: (value: string) => void;
    fetchLxSongLyricsRawMock.mockReturnValueOnce(new Promise<string>((resolve) => {
      resolveLyrics = resolve;
    }));
    const loadLyrics = vi.fn();
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [firstSong, secondSong],
      addToHistory: vi.fn(),
      loadLyrics,
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(firstSong);
    await playerPlayback.playSong(secondSong);
    resolveLyrics('[00:01.00]Stale lyric');
    await Promise.resolve();

    expect(playbackStore.currentSong?.path).toBe(secondSong.path);
    expect(playbackStore.currentSong?.lyrics_raw).toBeUndefined();
    playerPlayback.dispose();
  });

  it('does not fetch LX lyrics when the song already carries lyrics', async () => {
    const song = makeSong({
      path: 'lx://tx/existing',
      lyrics_raw: '[00:01.00]Existing lyric',
    });
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song);

    expect(fetchLxSongLyricsRawMock).not.toHaveBeenCalled();
    playerPlayback.dispose();
  });

  it('does not repeatedly auto-advance after the same online song fails quickly', async () => {
    vi.useFakeTimers();
    const failingSong = makeSong({ path: 'plugin://qishui/failed', title: 'Failed' });
    const nextSong = makeSong({ path: '/music/next.flac', title: 'Next' });
    useSettingsStore().settings.audio.onlineFailureBehavior = 'skip';
    const handleAutoNext = vi.fn();
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [failingSong, nextSong],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext,
    });

    await playerPlayback.playSong(failingSong);
    await vi.runOnlyPendingTimersAsync();
    await playerPlayback.playSong(failingSong);
    await vi.runOnlyPendingTimersAsync();

    expect(handleAutoNext).toHaveBeenCalledTimes(1);
    playerPlayback.dispose();
  });

  it('stops instead of skipping to itself when an online song has no alternative queue item', async () => {
    vi.useFakeTimers();
    const failingSong = makeSong({ path: 'plugin://qishui/only', title: 'Only Failed' });
    const handleAutoNext = vi.fn();
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [failingSong],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext,
    });

    await playerPlayback.playSong(failingSong);
    await vi.runOnlyPendingTimersAsync();

    expect(handleAutoNext).not.toHaveBeenCalled();
    expect(playbackApi.stopAudio).toHaveBeenCalled();
    playerPlayback.dispose();
  });

  it('stops the previous audio immediately while resolving a new online song url', async () => {
    const playbackStore = usePlaybackStore();
    const previousSong = makeSong({ path: '/music/previous.flac', title: 'Previous' });
    const onlineSong = makeSong({
      path: 'plugin://lx-test-plugin/online-song',
      title: 'Online Song',
      rawData: {
        pluginId: 'lx-test-plugin',
        id: 'online-song',
      },
    } as Partial<Song>);

    let resolveMusicInfo!: (value: { url: string }) => void;
    const pendingMusicInfo = new Promise<{ url: string }>((resolve) => {
      resolveMusicInfo = resolve;
    });
    pluginGetMusicInfoMock.mockReturnValueOnce(pendingMusicInfo);

    playbackStore.currentSong = previousSong;
    playbackStore.isPlaying = true;
    playbackStore.isSongLoaded = true;

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [previousSong, onlineSong],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    const playPromise = playerPlayback.playSong(onlineSong, { preserveQueue: true });

    expect(playbackApi.stopAudio).toHaveBeenCalledTimes(1);
    expect(playbackApi.playAudio).not.toHaveBeenCalled();

    resolveMusicInfo({ url: 'https://example.test/online-song.mp3' });
    await playPromise;

    expect(playbackApi.playAudio).toHaveBeenCalled();
    playerPlayback.dispose();
  });

  it('does not advance the progress clock while an online song is still loading', async () => {
    const playbackStore = usePlaybackStore();
    const onlineSong = makeSong({
      path: 'plugin://lx-test-plugin/slow-load',
      title: 'Slow Load',
      duration: 200,
      rawData: {
        pluginId: 'lx-test-plugin',
        id: 'slow-load',
      },
    } as Partial<Song>);

    let resolveMusicInfo!: (value: { url: string }) => void;
    const pendingMusicInfo = new Promise<{ url: string }>((resolve) => {
      resolveMusicInfo = resolve;
    });
    pluginGetMusicInfoMock.mockReturnValueOnce(pendingMusicInfo);

    // 捕获运行时循环的帧回调，手动驱动时钟
    let frameCallback: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameCallback = callback;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [onlineSong],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    const playPromise = playerPlayback.playSong(onlineSong);

    expect(playbackStore.isSongLoaded).toBe(false);
    expect(playbackStore.currentTime).toBe(0);

    // 加载期间真实时间流逝后驱动一帧：进度必须被钉在起点，不能自行前进
    await new Promise((resolve) => setTimeout(resolve, 60));
    const loadingFrame = frameCallback;
    frameCallback = undefined;
    loadingFrame?.(performance.now());

    expect(playbackStore.isSongLoaded).toBe(false);
    expect(playbackStore.currentTime).toBe(0);

    resolveMusicInfo({ url: 'https://example.test/slow-load.mp3' });
    await playPromise;
    expect(playbackStore.isSongLoaded).toBe(true);

    // 起播后同样的时间流逝应正常推进进度
    await new Promise((resolve) => setTimeout(resolve, 60));
    const playingFrame = frameCallback;
    frameCallback = undefined;
    playingFrame?.(performance.now());

    expect(playbackStore.currentTime).toBeGreaterThan(0);

    playerPlayback.dispose();
    vi.unstubAllGlobals();
  });

  it('maps a qishui vip preview clip back to the full song timeline', async () => {
    const playbackStore = usePlaybackStore();
    const song = makeSong({
      path: 'plugin://汽水音乐/6778775241108752385',
      title: '初学者',
      duration: 261,
      rawData: { pluginId: 'lx-test-plugin', id: '6778775241108752385' },
    } as Partial<Song>);
    const pluginHttpRequestSpy = vi.spyOn(pluginApi, 'pluginHttpRequest').mockResolvedValue({
      status: 200,
      body: {
        seo_track: {
          track: {
            duration: 261_000,
            preview: { start: 208_900, duration: 52_000 },
          },
        },
      },
    });

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song);
    expect(pluginHttpRequestSpy).toHaveBeenCalled();

    emitPlaybackProgress(10, 52);
    await vi.waitFor(() => {
      expect(playbackStore.currentTime).toBeGreaterThan(200);
    });
    expect(playbackStore.currentTime).toBeCloseTo(218.9, 1);
    expect(playbackStore.currentSong?.duration).toBe(261);

    emitPlaybackProgress(12, 52);
    expect(playbackStore.currentTime).toBeCloseTo(220.9, 1);

    await playerPlayback.seekTo(220);
    const seekRequest = vi.mocked(playbackApi.seekAudio).mock.calls.at(-1)?.[0];
    expect(seekRequest?.time).toBeCloseTo(11.1, 1);

    playerPlayback.dispose();
  });

  it('clears the stale preview mapping when the same song returns a full stream', async () => {
    const playbackStore = usePlaybackStore();
    const song = makeSong({
      path: 'plugin://汽水音乐/1111111111111111111',
      title: 'Full Stream Now',
      duration: 261,
      rawData: { pluginId: 'lx-test-plugin', id: '1111111111111111111' },
    } as Partial<Song>);
    vi.spyOn(pluginApi, 'pluginHttpRequest').mockResolvedValue({
      status: 200,
      body: {
        seo_track: {
          track: {
            duration: 261_000,
            preview: { start: 208_900, duration: 52_000 },
          },
        },
      },
    });

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song);
    emitPlaybackProgress(10, 52);
    await vi.waitFor(() => {
      expect(playbackStore.currentTime).toBeGreaterThan(200);
    });

    emitPlaybackProgress(20, 261);
    expect(playbackStore.currentTime).toBeCloseTo(20, 1);

    playerPlayback.dispose();
  });

  it('falls back to clip-relative timing for non-qishui preview streams', async () => {
    const playbackStore = usePlaybackStore();
    const song = makeSong({
      path: 'plugin://kw/preview-only',
      title: 'Preview Only',
      duration: 240,
      rawData: { pluginId: 'lx-test-plugin', id: 'preview-only' },
    } as Partial<Song>);
    const pluginHttpRequestSpy = vi.spyOn(pluginApi, 'pluginHttpRequest');

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song);
    emitPlaybackProgress(5, 60);
    await vi.waitFor(() => {
      expect(playbackStore.currentSong?.duration).toBe(60);
    });

    expect(playbackStore.currentSong?.duration).toBe(60);
    expect(playbackStore.currentTime).toBeCloseTo(5, 1);
    expect(pluginHttpRequestSpy).not.toHaveBeenCalled();

    playerPlayback.dispose();
  });

  it('prepares likely full-size covers before switching songs in the player detail view', async () => {
    const playbackStore = usePlaybackStore();
    const uiStore = useUiStore();
    const previousSong = makeSong({ path: '/music/previous.flac', title: 'Previous' });
    const song = makeSong({ path: '/music/current.flac', title: 'Current' });
    const nextSong = makeSong({ path: '/music/next.flac', title: 'Next' });
    const tempSong = makeSong({ path: '/music/temp.flac', title: 'Temp' });

    uiStore.showPlayerDetail = true;
    playbackStore.currentSong = previousSong;
    playbackStore.playQueue = [previousSong, song, nextSong];
    playbackStore.tempQueue = [tempSong];

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [previousSong, song, nextSong],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song, { preserveQueue: true });

    expect(retainFullCoverPathsMock).toHaveBeenCalledWith([
      song.path,
      tempSong.path,
      previousSong.path,
      nextSong.path,
    ]);
    expect(preloadFullCoversMock).toHaveBeenCalledWith([
      tempSong.path,
      previousSong.path,
      nextSong.path,
    ]);
    playerPlayback.dispose();
  });
});
