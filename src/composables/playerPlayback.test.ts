import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia'; // 实现

const loadCoverMock = vi.fn().mockResolvedValue(''); // 实现
const loadCoverPathMock = vi.fn().mockResolvedValue(''); // 实现
const loadFullCoverMock = vi.fn().mockResolvedValue(''); // 实现
const peekCoverUrlMock = vi.fn().mockReturnValue(''); // 实现
const peekCoverPathMock = vi.fn().mockReturnValue(''); // 实现
const getFullCoverUrlMock = vi.fn().mockReturnValue(''); // 实现
const preloadFullCoversMock = vi.fn(); // 实现
const preloadPriorityCoversMock = vi.fn(); // 实现
const retainFullCoverPathsMock = vi.fn(); // 实现
const primeCoverPathMock = vi.fn().mockReturnValue(''); // 实现
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
  findDownloadedFileFuzzy: vi.fn().mockResolvedValue(null),
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

vi.mock('../services/tauri/playbackApi', () => ({ // 实现
  playbackApi: { // 实现
    playAudio: vi.fn().mockResolvedValue(undefined), // 实现
    updatePlaybackMetadata: vi.fn().mockResolvedValue(undefined), // 实现
    getPlaybackProgress: vi.fn().mockResolvedValue(0), // 实现
    pauseAudio: vi.fn().mockResolvedValue(undefined), // 实现
    resumeAudio: vi.fn().mockResolvedValue(undefined), // 实现
    seekAudio: vi.fn().mockResolvedValue(undefined), // 实现
    setVolume: vi.fn().mockResolvedValue(undefined),
    stopAudio: vi.fn().mockResolvedValue(undefined),
    recordPlay: vi.fn().mockResolvedValue(undefined), // 实现
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

vi.mock('./useCoverCache', () => ({ // 实现
  useCoverCache: () => ({ // 实现
    loadCover: loadCoverMock, // 实现
    loadCoverPath: loadCoverPathMock, // 实现
    loadFullCover: loadFullCoverMock, // 实现
    peekCoverUrl: peekCoverUrlMock, // 实现
    peekCoverPath: peekCoverPathMock, // 实现
    getFullCoverUrl: getFullCoverUrlMock, // 实现
    preloadFullCovers: preloadFullCoversMock, // 实现
    preloadPriorityCovers: preloadPriorityCoversMock, // 实现
    retainFullCoverPaths: retainFullCoverPathsMock, // 实现
    primeCoverPath: primeCoverPathMock, // 实现
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

import type { Song } from '../types'; // 实现
import { usePlaybackStore } from '../features/playback';
import { useSettingsStore } from '../features/settings/store';
import { playbackApi } from '../services/tauri/playbackApi'; // 实现
import { pluginApi } from '../services/tauri/pluginApi';
import { reportUserBehavior } from '../services/domain/usageStats';
import { createPlayerPlayback } from '../features/playback/playerPlayback';
import { useUiStore } from '../shared/stores/ui'; // 实现
import { setMainWindowRenderingSnapshot } from './renderingPower'; // 实现

const makeSong = (overrides: Partial<Song> = {}): Song => ({ // 实现
  path: '/music/demo.flac', // 实现
  name: 'demo.flac', // 实现
  title: 'Demo', // 实现
  artist: 'Artist', // 实现
  artist_names: ['Artist'], // 实现
  effective_artist_names: ['Artist'], // 实现
  album: 'Album', // 实现
  album_artist: 'Artist', // 实现
  album_key: 'album::artist', // 实现
  is_various_artists_album: false, // 实现
  collapse_artist_credits: false, // 实现
  duration: 180, // 实现
  ...overrides, // 实现
});

describe('player playback domain', () => { // 实现
  beforeEach(() => { // 实现
    setActivePinia(createPinia()); // 实现
    vi.clearAllMocks(); // 实现
    vi.unstubAllGlobals(); // 实现
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1)); // 实现
    vi.stubGlobal('cancelAnimationFrame', vi.fn()); // 实现
    useSettingsStore().settings.audio.fadeInOutEnabled = false;
    loadCoverMock.mockResolvedValue(''); // 实现
    loadCoverPathMock.mockResolvedValue(''); // 实现
    loadFullCoverMock.mockResolvedValue(''); // 实现
    peekCoverUrlMock.mockReturnValue(''); // 实现
    peekCoverPathMock.mockReturnValue(''); // 实现
    getFullCoverUrlMock.mockReturnValue(''); // 实现
    preloadFullCoversMock.mockReset(); // 实现
    preloadPriorityCoversMock.mockReset(); // 实现
    retainFullCoverPathsMock.mockReset(); // 实现
    primeCoverPathMock.mockReturnValue(''); // 实现
    fetchLxSongLyricsRawMock.mockReset();
    fetchLxSongLyricsRawMock.mockResolvedValue('');
    pluginGetMusicInfoMock.mockReset();
    pluginGetMusicInfoMock.mockResolvedValue({ url: 'https://example.test/audio.mp3' });
    pluginGetSupportedQualitiesMock.mockReset();
    pluginGetSupportedQualitiesMock.mockResolvedValue(['320k']);
    isBakaPluginMock.mockReset();
    isBakaPluginMock.mockResolvedValue(false);
    setMainWindowRenderingSnapshot({ // 实现
      documentHidden: false, // 实现
      windowFocused: true, // 实现
      windowVisible: true, // 实现
      windowMinimized: false, // 实现
      miniMode: false, // 实现
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals(); // 实现
    vi.useRealTimers();
  });

  it('rebuilds the queue from the display song list order when playback starts', async () => { // 实现
    const playbackStore = usePlaybackStore(); // 实现
    const firstSong = makeSong({ path: '/music/first.flac', title: 'First' }); // 实现
    const secondSong = makeSong({ path: '/music/second.flac', title: 'Second' }); // 实现
    const displaySongList = [firstSong, secondSong]; // 实现
    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => displaySongList, // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext: vi.fn(), // 实现
    });

    await playerPlayback.playSong(firstSong); // 实现

    expect(playbackStore.playQueue.map(song => song.path)).toEqual(displaySongList.map(song => song.path)); // 实现
    playerPlayback.dispose(); // 实现
  });

  it('inserts a searched song directly after the previously playing song', async () => { // 实现
    const playbackStore = usePlaybackStore(); // 实现
    const songA = makeSong({ path: '/music/a.flac', title: 'A' }); // 实现
    const songB = makeSong({ path: '/music/b.flac', title: 'B' }); // 实现
    const songC = makeSong({ path: '/music/c.flac', title: 'C' }); // 实现
    const songD = makeSong({ path: '/music/d.flac', title: 'D' }); // 实现
    const searchedSong = makeSong({ path: '/music/search.flac', title: 'Search' }); // 实现
    playbackStore.currentSong = songA; // 实现
    playbackStore.playQueue = [songA, songB, songC, songD]; // 实现

    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [searchedSong], // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext: vi.fn(), // 实现
    });

    await playerPlayback.playSong(searchedSong, { insertAfterCurrent: true }); // 实现

    expect(playbackStore.currentSong?.path).toBe(searchedSong.path); // 实现
    expect(playbackStore.playQueue.map(song => song.path)).toEqual([ // 实现
      songA.path,
      searchedSong.path, // 实现
      songB.path,
      songC.path,
      songD.path,
    ]);
    playerPlayback.dispose(); // 实现
  });

  it('prefers tagged song title when reporting playback metadata', async () => { // 实现
    const song = makeSong({ name: 'i-dle - Allergy.flac', title: 'Allergy' }); // 实现
    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [song], // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext: vi.fn(), // 实现
    });

    await playerPlayback.playSong(song); // 实现

    expect(playbackApi.playAudio).toHaveBeenCalledWith(expect.objectContaining({ // 实现
      title: 'Allergy', // 实现
    }));
    playerPlayback.dispose(); // 实现
  });

  it('reports two plays and 6:30 of listening for two complete 3:15 sessions', async () => { // 实现
    const song = makeSong({ duration: 195 }); // 实现
    let periodicFlush: (() => void) | undefined; // 实现
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(100_000); // 实现
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1)); // 实现
    vi.stubGlobal('cancelAnimationFrame', vi.fn()); // 实现
    vi.stubGlobal('setInterval', vi.fn((callback: () => void, delay: number) => { // 实现
      if (delay === 30_000) periodicFlush = callback; // 实现
      return delay; // 实现
    }));
    vi.stubGlobal('clearInterval', vi.fn()); // 实现

    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [song], // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext: vi.fn(), // 实现
    });

    await playerPlayback.playSong(song); // 实现
    expect(periodicFlush).toBeDefined(); // 实现

    for (let index = 1; index <= 6; index += 1) { // 实现
      dateNow.mockReturnValue(100_000 + index * 30_000); // 实现
      periodicFlush?.(); // 实现
    }

    dateNow.mockReturnValue(295_000); // 实现
    await playerPlayback.pauseSong(); // 实现
    await playerPlayback.playSong(song); // 实现

    for (let index = 1; index <= 6; index += 1) { // 实现
      dateNow.mockReturnValue(295_000 + index * 30_000); // 实现
      periodicFlush?.(); // 实现
    }

    dateNow.mockReturnValue(490_000); // 实现
    await playerPlayback.pauseSong(); // 实现

    const recordedPayloads = vi.mocked(playbackApi.recordPlay).mock.calls.map(([payload]) => payload); // 实现
    expect(recordedPayloads.filter(payload => payload.countAsPlay)).toHaveLength(2); // 实现
    expect(recordedPayloads.reduce((sum, payload) => sum + payload.listenedMs, 0)).toBe(390_000); // 实现

    playerPlayback.dispose(); // 实现
    dateNow.mockRestore(); // 实现
    vi.unstubAllGlobals(); // 实现
  });

  it('does not count or report listening time while no audio output device is active', async () => {
    const song = makeSong({ duration: 195 }); // 实现
    let periodicFlush: (() => void) | undefined; // 实现
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(100_000); // 实现
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1)); // 实现
    vi.stubGlobal('cancelAnimationFrame', vi.fn()); // 实现
    vi.stubGlobal('setInterval', vi.fn((callback: () => void, delay: number) => { // 实现
      if (delay === 30_000) periodicFlush = callback; // 实现
      return delay; // 实现
    }));
    vi.stubGlobal('clearInterval', vi.fn()); // 实现

    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [song], // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext: vi.fn(), // 实现
    });

    await playerPlayback.playSong(song); // 实现
    expect(periodicFlush).toBeDefined(); // 实现

    tauriEventListeners.get('audio-output-device-changed')?.({ payload: { active_device_name: null } });

    for (let index = 1; index <= 3; index += 1) {
      dateNow.mockReturnValue(100_000 + index * 30_000); // 实现
      periodicFlush?.(); // 实现
    }

    dateNow.mockReturnValue(190_000);
    await playerPlayback.pauseSong(); // 实现

    expect(playbackApi.recordPlay).not.toHaveBeenCalled();
    expect(reportUserBehavior).not.toHaveBeenCalled();

    playerPlayback.dispose(); // 实现
    dateNow.mockRestore(); // 实现
    vi.unstubAllGlobals(); // 实现
  });

  it('does not count or report listening time while volume is below 1', async () => {
    const playbackStore = usePlaybackStore(); // 实现
    const song = makeSong({ duration: 195 }); // 实现
    let periodicFlush: (() => void) | undefined; // 实现
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(100_000); // 实现
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1)); // 实现
    vi.stubGlobal('cancelAnimationFrame', vi.fn()); // 实现
    vi.stubGlobal('setInterval', vi.fn((callback: () => void, delay: number) => { // 实现
      if (delay === 30_000) periodicFlush = callback; // 实现
      return delay; // 实现
    }));
    vi.stubGlobal('clearInterval', vi.fn()); // 实现

    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [song], // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext: vi.fn(), // 实现
    });

    await playerPlayback.playSong(song); // 实现
    expect(periodicFlush).toBeDefined(); // 实现

    playbackStore.volume = 0;

    for (let index = 1; index <= 3; index += 1) {
      dateNow.mockReturnValue(100_000 + index * 30_000); // 实现
      periodicFlush?.(); // 实现
    }

    dateNow.mockReturnValue(190_000);
    await playerPlayback.pauseSong(); // 实现

    expect(playbackApi.recordPlay).not.toHaveBeenCalled();
    expect(reportUserBehavior).not.toHaveBeenCalled();

    playerPlayback.dispose(); // 实现
    dateNow.mockRestore(); // 实现
    vi.unstubAllGlobals(); // 实现
  });

  it('counts only audible time when the output device is removed and restored mid-playback', async () => {
    const song = makeSong({ duration: 195 }); // 实现
    let periodicFlush: (() => void) | undefined; // 实现
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(100_000); // 实现
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1)); // 实现
    vi.stubGlobal('cancelAnimationFrame', vi.fn()); // 实现
    vi.stubGlobal('setInterval', vi.fn((callback: () => void, delay: number) => { // 实现
      if (delay === 30_000) periodicFlush = callback; // 实现
      return delay; // 实现
    }));
    vi.stubGlobal('clearInterval', vi.fn()); // 实现

    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [song], // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext: vi.fn(), // 实现
    });

    await playerPlayback.playSong(song); // 实现
    expect(periodicFlush).toBeDefined(); // 实现

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
    await playerPlayback.pauseSong(); // 实现

    const recordedPayloads = vi.mocked(playbackApi.recordPlay).mock.calls.map(([payload]) => payload); // 实现
    expect(recordedPayloads.reduce((sum, payload) => sum + payload.listenedMs, 0)).toBe(90_000);

    playerPlayback.dispose(); // 实现
    dateNow.mockRestore(); // 实现
    vi.unstubAllGlobals(); // 实现
  });

  it('does not auto-advance songs with unknown duration', async () => { // 实现
    const song = makeSong({ path: 'remote://source/demo.flac', duration: 0 }); 
    const handleAutoNext = vi.fn(); // 实现
    let frameCallback: FrameRequestCallback | undefined; // 实现
    vi
      .stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { // 实现
        frameCallback = callback; // 实现
        return 1;
      });
    vi.stubGlobal('cancelAnimationFrame', () => {}); // 实现
    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [song], // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext, // 实现
    });

    await playerPlayback.playSong(song); // 实现
    expect(frameCallback).toBeDefined(); // 实现
    (frameCallback as FrameRequestCallback)(performance.now() + 16); // 实现

    expect(handleAutoNext).not.toHaveBeenCalled(); // 实现

    playerPlayback.dispose(); // 实现
    vi.unstubAllGlobals(); // 实现
  });

  it('updates playback progress with a low-frequency timer while main window rendering is low power', async () => { // 实现
    const song = makeSong({ duration: 180 }); // 实现
    const handleAutoNext = vi.fn(); // 实现
    const requestAnimationFrameMock = vi.fn(); // 实现
    const setTimeoutMock = vi.fn().mockReturnValue(7); // 实现
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock); // 实现
    vi.stubGlobal('cancelAnimationFrame', vi.fn()); // 实现
    vi.stubGlobal('setTimeout', setTimeoutMock); // 实现
    vi.stubGlobal('clearTimeout', vi.fn()); // 实现
    setMainWindowRenderingSnapshot({ windowVisible: false }); // 实现

    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [song], // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext, // 实现
    });

    await playerPlayback.playSong(song); // 实现

    expect(requestAnimationFrameMock).not.toHaveBeenCalled(); // 实现
    expect(setTimeoutMock).toHaveBeenCalledWith(expect.any(Function), 1000); // 实现

    playerPlayback.dispose(); // 实现
    vi.unstubAllGlobals(); // 实现
  });

  it('keeps cue track time relative when the backend confirms an absolute seek position', async () => { // 实现
    const playbackStore = usePlaybackStore(); // 实现
    const song = makeSong({ // 实现
      path: '/music/album.cue::track02', // 实现
      cue_source_path: '/music/album.flac', // 实现
      cue_start_offset: 180_000, // 实现
      cue_end_offset: 300_000, // 实现
      duration: 120, // 实现
    });
    playbackStore.currentSong = song; // 实现

    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [song], // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext: vi.fn(), // 实现
    });

    await playerPlayback.seekTo(10); // 实现

    const seekRequest = vi.mocked(playbackApi.seekAudio).mock.calls[0]?.[0]; // 实现
    expect(seekRequest).toEqual(expect.objectContaining({ // 实现
      time: 190,
    }));

    playerPlayback.handleSeekCompleted({ // 实现
      request_id: seekRequest.requestId, // 实现
      time: seekRequest.time, // 实现
    });

    expect(playbackStore.currentTime).toBe(10); // 实现
    playerPlayback.dispose(); // 实现
  });

  it('strips the file extension when title metadata is missing', async () => { // 实现
    const song = makeSong({ name: 'i-dle - Allergy.flac', title: '   ' }); // 实现
    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [song], // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext: vi.fn(), // 实现
    });

    await playerPlayback.playSong(song); // 实现

    expect(playbackApi.playAudio).toHaveBeenCalledWith(expect.objectContaining({ // 实现
      title: 'i-dle - Allergy', // 实现
    }));
    playerPlayback.dispose(); // 实现
  });

  it('updates the full-size cover state when switching songs in the player detail view', async () => { // 实现
    const playbackStore = usePlaybackStore(); // 实现
    const uiStore = useUiStore(); // 实现
    const song = makeSong({ path: '/music/full-cover.flac', title: 'Full Cover' }); // 实现

    uiStore.showPlayerDetail = true; // 实现
    loadCoverMock.mockResolvedValue('thumb-url'); // 实现
    loadFullCoverMock.mockResolvedValue('full-url'); // 实现

    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [song], // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext: vi.fn(), // 实现
    });

    await playerPlayback.playSong(song); // 实现
    await Promise.resolve(); // 实现

    expect(loadFullCoverMock).toHaveBeenCalledWith(song.path); // 实现
    expect(playbackStore.currentCoverFull).toBe('full-url'); // 实现
    playerPlayback.dispose(); // 实现
  });

  it('starts loading the current thumbnail before the audio backend finishes switching songs', async () => { // 实现
    const song = makeSong({ path: '/music/current-thumbnail.flac', title: 'Current Thumbnail' }); // 实现
    let resolvePlayAudio!: () => void; // 实现
    vi.mocked(playbackApi.playAudio).mockReturnValueOnce(new Promise<void>((resolve) => { // 实现
      resolvePlayAudio = resolve; // 实现
    }));

    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [song], // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext: vi.fn(), // 实现
    });

    const playPromise = playerPlayback.playSong(song); // 实现

    expect(loadCoverMock).toHaveBeenCalledWith(song.path); // 实现

    resolvePlayAudio(); // 实现
    await playPromise; // 实现
    playerPlayback.dispose(); // 实现
  });

  it('uses the persisted thumbnail path immediately when switching songs', async () => { // 实现
    const playbackStore = usePlaybackStore(); // 实现
    const song = makeSong({ // 实现
      path: '/music/persisted-thumb.flac', // 实现
      title: 'Persisted Thumb', // 实现
      cover_thumb_path: 'C:\\covers\\persisted-thumb.jpg', // 实现
    });
    primeCoverPathMock.mockReturnValue('asset://C:\\covers\\persisted-thumb.jpg'); 

    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [song], // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext: vi.fn(), // 实现
    });

    await playerPlayback.playSong(song); // 实现

    expect(primeCoverPathMock).toHaveBeenCalledWith(song.path, song.cover_thumb_path); // 实现
    expect(playbackStore.currentCover).toBe('asset://C:\\covers\\persisted-thumb.jpg'); 
    expect(loadCoverMock).toHaveBeenCalledWith(song.path); // 实现
    playerPlayback.dispose(); // 实现
  });

  it('keeps the previous visible cover while the next thumbnail is loading', async () => { // 实现
    const playbackStore = usePlaybackStore(); // 实现
    const oldCover = 'asset://C:\\covers\\old-thumb.jpg'; 
    const song = makeSong({ path: '/music/cold-hdd.flac', title: 'Cold HDD' }); // 实现
    let resolvePlayAudio!: () => void; // 实现
    playbackStore.currentCover = oldCover; // 实现
    vi.mocked(playbackApi.playAudio).mockReturnValueOnce(new Promise<void>((resolve) => { // 实现
      resolvePlayAudio = resolve; // 实现
    }));

    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [song], // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext: vi.fn(), // 实现
    });

    const playPromise = playerPlayback.playSong(song); // 实现

    expect(playbackStore.currentCover).toBe(oldCover); // 实现

    resolvePlayAudio(); // 实现
    await playPromise; // 实现
    playerPlayback.dispose(); // 实现
  });

  it('clears the previous cover after confirming the next song has no cover', async () => { // 实现
    const playbackStore = usePlaybackStore(); // 实现
    const oldCover = 'asset://C:\\covers\\old-thumb.jpg'; 
    const song = makeSong({ path: '/music/no-cover.flac', title: 'No Cover' }); // 实现
    let resolveCover!: (cover: string) => void; // 实现
    playbackStore.currentCover = oldCover; // 实现
    loadCoverMock.mockReturnValueOnce(new Promise<string>((resolve) => { // 实现
      resolveCover = resolve; // 实现
    }));

    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [song], // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext: vi.fn(), // 实现
    });

    const playPromise = playerPlayback.playSong(song); // 实现
    expect(playbackStore.currentCover).toBe(oldCover); // 实现

    resolveCover(''); // 实现
    await playPromise; // 实现
    await vi.waitFor(() => expect(playbackStore.currentCover).toBe('')); // 实现
    playerPlayback.dispose(); // 实现
  });

  it('does not carry the previous full cover into the next song detail view', async () => { // 实现
    const playbackStore = usePlaybackStore(); // 实现
    const uiStore = useUiStore(); // 实现
    const oldCover = 'asset://C:\\covers\\old-thumb.jpg'; 
    const oldFullCover = 'asset://C:\\covers\\old-full.png'; 
    const song = makeSong({ path: '/music/new-song.flac', title: 'New Song' }); // 实现
    let resolvePlayAudio!: () => void; // 实现
    uiStore.showPlayerDetail = true; // 实现
    playbackStore.currentCover = oldCover; // 实现
    playbackStore.currentCoverPath = '/music/old-song.flac'; // 实现
    playbackStore.currentCoverFull = oldFullCover; // 实现
    vi.mocked(playbackApi.playAudio).mockReturnValueOnce(new Promise<void>((resolve) => { // 实现
      resolvePlayAudio = resolve; // 实现
    }));

    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [song], // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext: vi.fn(), // 实现
    });

    const playPromise = playerPlayback.playSong(song); // 实现

    expect(playbackStore.currentCover).toBe(oldCover); // 实现
    expect(playbackStore.currentCoverPath).toBe('/music/old-song.flac'); // 实现
    expect(playbackStore.currentCoverFull).toBe(''); // 实现

    resolvePlayAudio(); // 实现
    await playPromise; // 实现
    playerPlayback.dispose(); // 实现
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
    const nextSong = makeSong({ path: '/music/next.flac', title: 'Next' }); // 实现
    useSettingsStore().settings.audio.onlineFailureBehavior = 'skip';
    const handleAutoNext = vi.fn(); // 实现
    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [failingSong, nextSong],
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext, // 实现
    });

    await playerPlayback.playSong(failingSong);
    await vi.runOnlyPendingTimersAsync();
    await playerPlayback.playSong(failingSong);
    await vi.runOnlyPendingTimersAsync();

    expect(handleAutoNext).toHaveBeenCalledTimes(1);
    playerPlayback.dispose(); // 实现
  });

  it('stops instead of skipping to itself when an online song has no alternative queue item', async () => {
    vi.useFakeTimers();
    const failingSong = makeSong({ path: 'plugin://qishui/only', title: 'Only Failed' });
    const handleAutoNext = vi.fn(); // 实现
    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [failingSong],
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext, // 实现
    });

    await playerPlayback.playSong(failingSong);
    await vi.runOnlyPendingTimersAsync();

    expect(handleAutoNext).not.toHaveBeenCalled(); // 实现
    expect(playbackApi.stopAudio).toHaveBeenCalled();
    playerPlayback.dispose(); // 实现
  });

  it('stops the previous audio immediately while resolving a new online song url', async () => {
    const playbackStore = usePlaybackStore(); // 实现
    const previousSong = makeSong({ path: '/music/previous.flac', title: 'Previous' }); // 实现
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

    playbackStore.currentSong = previousSong; // 实现
    playbackStore.isPlaying = true;
    playbackStore.isSongLoaded = true;

    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [previousSong, onlineSong],
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext: vi.fn(), // 实现
    });

    const playPromise = playerPlayback.playSong(onlineSong, { preserveQueue: true });

    expect(playbackApi.stopAudio).toHaveBeenCalledTimes(1);
    expect(playbackApi.playAudio).not.toHaveBeenCalled();

    resolveMusicInfo({ url: 'https://example.test/online-song.mp3' });
    await playPromise; // 实现

    expect(playbackApi.playAudio).toHaveBeenCalled();
    playerPlayback.dispose(); // 实现
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
    const playbackStore = usePlaybackStore(); // 实现
    const song = makeSong({ // 实现
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

    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [song], // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext: vi.fn(), // 实现
    });

    await playerPlayback.playSong(song); // 实现
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

    playerPlayback.dispose(); // 实现
  });

  it('clears the stale preview mapping when the same song returns a full stream', async () => {
    const playbackStore = usePlaybackStore(); // 实现
    const song = makeSong({ // 实现
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

    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [song], // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext: vi.fn(), // 实现
    });

    await playerPlayback.playSong(song); // 实现
    emitPlaybackProgress(10, 52);
    await vi.waitFor(() => {
      expect(playbackStore.currentTime).toBeGreaterThan(200);
    });

    emitPlaybackProgress(20, 261);
    expect(playbackStore.currentTime).toBeCloseTo(20, 1);

    playerPlayback.dispose(); // 实现
  });

  it('falls back to clip-relative timing for non-qishui preview streams', async () => {
    const playbackStore = usePlaybackStore(); // 实现
    const song = makeSong({ // 实现
      path: 'plugin://kw/preview-only',
      title: 'Preview Only',
      duration: 240,
      rawData: { pluginId: 'lx-test-plugin', id: 'preview-only' },
    } as Partial<Song>);
    const pluginHttpRequestSpy = vi.spyOn(pluginApi, 'pluginHttpRequest');

    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [song], // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext: vi.fn(), // 实现
    });

    await playerPlayback.playSong(song); // 实现
    emitPlaybackProgress(5, 60);
    await vi.waitFor(() => {
      expect(playbackStore.currentSong?.duration).toBe(60);
    });

    expect(playbackStore.currentSong?.duration).toBe(60);
    expect(playbackStore.currentTime).toBeCloseTo(5, 1);
    expect(pluginHttpRequestSpy).not.toHaveBeenCalled();

    playerPlayback.dispose(); // 实现
  });

  it('prepares likely full-size covers before switching songs in the player detail view', async () => { // 实现
    const playbackStore = usePlaybackStore(); // 实现
    const uiStore = useUiStore(); // 实现
    const previousSong = makeSong({ path: '/music/previous.flac', title: 'Previous' }); // 实现
    const song = makeSong({ path: '/music/current.flac', title: 'Current' }); // 实现
    const nextSong = makeSong({ path: '/music/next.flac', title: 'Next' }); // 实现
    const tempSong = makeSong({ path: '/music/temp.flac', title: 'Temp' }); // 实现

    uiStore.showPlayerDetail = true; // 实现
    playbackStore.currentSong = previousSong; // 实现
    playbackStore.playQueue = [previousSong, song, nextSong]; // 实现
    playbackStore.tempQueue = [tempSong]; // 实现

    const playerPlayback = createPlayerPlayback({ // 实现
      getDisplaySongList: () => [previousSong, song, nextSong], // 实现
      addToHistory: vi.fn(), // 实现
      loadLyrics: vi.fn(), // 实现
      handleAutoNext: vi.fn(), // 实现
    });

    await playerPlayback.playSong(song, { preserveQueue: true }); // 实现

    expect(retainFullCoverPathsMock).toHaveBeenCalledWith([ // 实现
      song.path,
      tempSong.path, // 实现
      previousSong.path, // 实现
      nextSong.path, // 实现
    ]);
    expect(preloadFullCoversMock).toHaveBeenCalledWith([ // 实现
      tempSong.path, // 实现
      previousSong.path, // 实现
      nextSong.path, // 实现
    ]);
    playerPlayback.dispose(); // 实现
  });
});
