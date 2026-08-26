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
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockImplementation((event: string, handler: (event: { payload: unknown }) => void) => {
    tauriEventListeners.set(event, handler);
    return Promise.resolve(() => tauriEventListeners.delete(event));
  }),
  emitTo: vi.fn(),
}));

import type { Song } from '../types';
import { usePlaybackStore } from '../features/playback';
import { playbackApi } from '../services/tauri/playbackApi';
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

describe('debug hang', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
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

  it('local song playSong completes', async () => {
    const song = makeSong({ duration: 195 });
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });
    const p = playerPlayback.playSong(song);
    const result = await Promise.race([
      p.then(() => 'resolved'),
      new Promise<string>((resolve) => setTimeout(() => resolve('TIMEOUT'), 3000)),
    ]);
    expect(result).toBe('resolved');
    playerPlayback.dispose();
  });

  it('lx song playSong completes', async () => {
    const song = makeSong({ path: 'lx://wy/first', title: 'First' });
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });
    const p = playerPlayback.playSong(song);
    const result = await Promise.race([
      p.then(() => 'resolved'),
      new Promise<string>((resolve) => setTimeout(() => resolve('TIMEOUT'), 3000)),
    ]);
    expect(result).toBe('resolved');
    playerPlayback.dispose();
  });
});
