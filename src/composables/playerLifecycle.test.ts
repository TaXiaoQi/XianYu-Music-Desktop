import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

import type { Song } from '../types';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback';
import { useSettingsStore } from '../features/settings/store';
import { useUiStore } from '../shared/stores/ui';
import { createPlayerLifecycle } from '../features/playback/playerLifecycle';
import * as colorExtraction from './colorExtraction';

// —— 提升到文件顶部的 API 打桩 ——

const apiSpies = vi.hoisted(() => ({
  listen: vi.fn(),
  setVolume: vi.fn().mockResolvedValue(undefined), setOutputDevice: vi.fn().mockResolvedValue(undefined),
  setAudioOutputMode: vi.fn().mockResolvedValue(undefined), updateLoudnessSettings: vi.fn().mockResolvedValue(undefined),
  getRemoteSources: vi.fn().mockResolvedValue([]),
  syncRemoteSource: vi.fn().mockResolvedValue(undefined), precacheRemoteSong: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (filePath: string) => `asset://${filePath}`,
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: apiSpies.listen }));

vi.mock('../services/tauri/playbackApi', () => ({
  playbackApi: {
    setVolume: apiSpies.setVolume, setOutputDevice: apiSpies.setOutputDevice,
    setAudioOutputMode: apiSpies.setAudioOutputMode, updateLoudnessSettings: apiSpies.updateLoudnessSettings,
    setPreventSleep: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../services/tauri/remoteLibraryApi', () => ({
  remoteLibraryApi: {
    getRemoteSources: apiSpies.getRemoteSources,
    syncRemoteSource: apiSpies.syncRemoteSource, precacheRemoteSong: apiSpies.precacheRemoteSong,
  },
}));

vi.mock('./colorExtraction', () => ({
  clearPaletteCache: vi.fn(), extractDominantColors: vi.fn().mockResolvedValue([]),
}));

/** 歌曲夹具：默认字段值属于行为规格，保持不变 */
const buildSong = (overrides: Partial<Song> = {}): Song => ({
  path: 'remote://source/demo.mp3', name: 'demo.mp3', title: 'Demo',
  artist: '未知歌手', artist_names: ['未知歌手'], effective_artist_names: ['未知歌手'],
  album: '未知专辑', album_artist: '未知歌手', album_key: '未知专辑::未知歌手',
  is_various_artists_album: false, collapse_artist_credits: false,
  duration: 0, bitrate: 0, sample_rate: 0,
  format: 'mp3', source_type: 'remote', remote_source_id: 'source',
  ...overrides,
});

/** 生命周期初始化依赖：默认全部空实现，测试按需覆写 */
const buildLifecycleDeps = (loadLyrics = vi.fn()) => ({
  bootstrapLibrary: vi.fn().mockResolvedValue(undefined),
  togglePlay: vi.fn(), nextSong: vi.fn(), prevSong: vi.fn(), seekTo: vi.fn(), stopPlayback: vi.fn(),
  applyLibraryScanBatch: vi.fn(), flushBufferedLibraryScanBatch: vi.fn(), handleSeekCompleted: vi.fn(),
  schedulePersistedState: vi.fn(), flushPersistedState: vi.fn().mockResolvedValue(undefined),
  restorePathBackedState: vi.fn().mockResolvedValue(undefined), restoreRecentHistory: vi.fn().mockResolvedValue(undefined),
  refreshStateSongReferences: vi.fn(), loadLyrics,
  disposePlayerPlayback: vi.fn(), disposeLibraryRuntime: vi.fn(), disposePlayerPersistence: vi.fn(), disposeLibraryBatch: vi.fn(),
  lastSongPathKey: 'last-song-path', legacyLastSongKey: 'last-song',
});

let warnSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('playerLifecycle：播放器生命周期', () => {
  beforeEach(() => {
    setActivePinia(createPinia()); vi.clearAllMocks();
    apiSpies.listen.mockResolvedValue(vi.fn());
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy?.mockRestore();
    warnSpy = null;
  });

  it('关闭动态背景且桌面歌词为自动配色时，从封面提取主色', async () => {
    const playbackStore = usePlaybackStore();
    const settingsStore = useSettingsStore();
    const uiStore = useUiStore();
    const extractDominantColors = vi.mocked(colorExtraction.extractDominantColors);
    extractDominantColors.mockResolvedValueOnce(['#111111', '#222222', '#333333', '#444444']);

    settingsStore.settings.theme.dynamicBgType = 'none'; settingsStore.settings.desktopLyrics.colorScheme = 'auto';
    createPlayerLifecycle(buildLifecycleDeps()).init();
    playbackStore.currentCover = 'http://asset.localhost/cover-thumb.png';

    await nextTick();
    await Promise.resolve();

    expect(extractDominantColors).toHaveBeenCalledWith('http://asset.localhost/cover-thumb.png', 4, { colorBoost: 25, depth: 30 });
    expect(uiStore.dominantColors).toEqual(['#111111', '#222222', '#333333', '#444444']);
  });

  it('后端完成远端歌曲缓存后，回填当前歌曲的元数据', async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    apiSpies.listen.mockImplementation((eventName: string, handler: (event: { payload: unknown }) => void) => {
      handlers.set(eventName, handler);
      return Promise.resolve(vi.fn());
    });
    const libraryStore = useLibraryStore();
    const playbackStore = usePlaybackStore();
    const staleSong = buildSong();
    const parsedSong = buildSong({
      title: '一个像夏天一个像秋天', artist: '范玮琪',
      artist_names: ['范玮琪'], effective_artist_names: ['范玮琪'],
      album: '我们的纪念日', album_artist: '范玮琪', album_key: '我们的纪念日::范玮琪',
      duration: 249, bitrate: 320, sample_rate: 44100,
    });
    libraryStore.setSourceSongs([staleSong]); playbackStore.currentSong = staleSong;
    const loadLyrics = vi.fn();

    createPlayerLifecycle(buildLifecycleDeps(loadLyrics)).init();

    handlers.get('remote-lyrics-cache-ready')?.({ payload: { uri: parsedSong.path, song: parsedSong } });

    expect(playbackStore.currentSong?.artist).toBe('范玮琪');
    expect(playbackStore.currentSong?.album).toBe('我们的纪念日'); expect(playbackStore.currentSong?.duration).toBe(249);
    expect(loadLyrics).toHaveBeenCalledTimes(1);
  });

  it('响度设置变化时携带当前歌曲上下文', async () => {
    const playbackStore = usePlaybackStore();
    const settingsStore = useSettingsStore();
    playbackStore.currentSong = buildSong({
      id: 42, path: 'C:\\Music\\album.cue::track01', cue_source_path: 'C:\\Music\\album.flac',
    });

    createPlayerLifecycle(buildLifecycleDeps()).init();
    settingsStore.settings.audio.volumeBalance.enabled = true;
    settingsStore.settings.audio.volumeBalance.gainOffsetDb = -2; settingsStore.settings.audio.volumeBalance.preventClipping = false;

    await nextTick();
    await Promise.resolve();

    expect(apiSpies.updateLoudnessSettings).toHaveBeenLastCalledWith({
      enabled: true, songId: 42, songPath: 'C:\\Music\\album.flac',
      gainOffsetDb: -2, preventClipping: false,
    });
  });
});
