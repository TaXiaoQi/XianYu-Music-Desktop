import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PluginSource, Song } from '../../types';

const mocks = vi.hoisted(() => ({
  getStoredPlugins: vi.fn(),
  pluginMusicSearchWithDiagnostics: vi.fn(),
  pluginGetLyric: vi.fn(),
  ensureLxPluginInstance: vi.fn(),
  lxPluginGetLyric: vi.fn(),
  lxSearch: vi.fn(),
  buildLxLyricsRaw: vi.fn(),
  loadLyrics: vi.fn(),
  tauriInvoke: vi.fn(),
  patchSongMeta: vi.fn(),
  patchQueueSongMeta: vi.fn(),
  playbackStore: {
    currentSong: null as Song | null,
    patchQueueSongMeta: vi.fn(),
  },
}));

vi.mock('./pluginEngine', () => ({
  getStoredPlugins: mocks.getStoredPlugins,
  pluginMusicSearchWithDiagnostics: mocks.pluginMusicSearchWithDiagnostics,
  pluginGetLyric: mocks.pluginGetLyric,
}));

vi.mock('./lxPluginEngine', () => ({
  ensureLxPluginInstance: mocks.ensureLxPluginInstance,
  lxPluginGetLyric: mocks.lxPluginGetLyric,
}));

vi.mock('./lxMusicSdk', () => ({
  LX_SOURCE_NAMES: { kw: '酷我音乐', wy: '网易云音乐' },
  lxSearch: mocks.lxSearch,
}));

vi.mock('../../composables/lyrics', () => ({
  createDefaultDesktopLyricsSettings: vi.fn(() => ({})),
  createDefaultLyricsSettings: vi.fn(() => ({})),
  loadLyrics: mocks.loadLyrics,
}));

vi.mock('./lxLyricsBuilder', () => ({
  buildLxLyricsRaw: mocks.buildLxLyricsRaw,
}));

vi.mock('../tauri/invoke', () => ({
  tauriInvoke: mocks.tauriInvoke,
}));

vi.mock('../../features/library/store', () => ({
  useLibraryStore: () => ({ patchSongMeta: mocks.patchSongMeta }),
}));

vi.mock('../../features/playback/store', () => ({
  usePlaybackStore: () => mocks.playbackStore,
}));

import {
  applyLyricsReplacement,
  createDefaultLyricsSearchQuery,
  searchLyricsFromAllPlugins,
} from './lyricsReplacement';

const createSong = (path = 'plugin://source/song'): Song => ({
  name: '测试歌曲',
  title: '测试歌曲',
  path,
  artist: '测试歌手',
  artist_names: ['测试歌手'],
  effective_artist_names: ['测试歌手'],
  album: '测试专辑',
  album_artist: '测试歌手',
  album_key: '测试专辑::测试歌手',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 180,
});

const musicFreePlugin: PluginSource = {
  id: 'mf-plugin',
  name: 'MF 插件',
  format: 'musicfree',
  version: '1',
  author: '',
  description: '',
  filePath: 'mf.js',
  importedAt: 1,
  enabled: true,
  sources: [],
  sortOrder: 1,
};

const lxPlugin: PluginSource = {
  ...musicFreePlugin,
  id: 'lx-plugin',
  name: 'LX 插件',
  format: 'lx',
  filePath: 'lx.js',
  sources: ['kw', 'wy'],
  sortOrder: 2,
};

describe('lyrics replacement service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.playbackStore.currentSong = null;
    mocks.playbackStore.patchQueueSongMeta = mocks.patchQueueSongMeta;
    mocks.getStoredPlugins.mockReturnValue([lxPlugin, musicFreePlugin]);
    mocks.ensureLxPluginInstance.mockResolvedValue({
      status: 'ready',
      initInfo: {
        sources: {
          kw: { type: 'music', actions: ['musicUrl', 'lyric'], qualitys: [] },
          wy: { type: 'music', actions: ['musicUrl', 'lyric'], qualitys: [] },
        },
      },
    });
  });

  it('builds an editable default query from the current song', () => {
    expect(createDefaultLyricsSearchQuery(createSong())).toBe('测试歌曲 测试歌手');
  });

  it('returns every enabled plugin/source group in configured order', async () => {
    mocks.pluginMusicSearchWithDiagnostics.mockResolvedValue({
      results: [{
        id: 'mf-song',
        title: 'MF 结果',
        artist: '歌手',
        album: '专辑',
        coverUrl: '',
        duration: 180000,
        platform: 'mf',
        platformId: 'mf-song',
        pluginId: musicFreePlugin.id,
      }],
      status: 'success',
      reason: '插件返回 1 首歌曲，可逐项获取歌词',
      supportsLyrics: true,
    });
    mocks.lxSearch.mockImplementation(async (source: string) => ({
      list: source === 'kw' ? [{
        name: 'LX 结果',
        singer: '歌手',
        albumName: '专辑',
        albumId: 'album',
        songmid: 'lx-song',
        source: 'kw',
        interval: '03:12',
        img: null,
        types: [],
        _types: {},
      }] : [],
      allPage: 1,
      limit: 30,
      total: source === 'kw' ? 1 : 0,
      source,
    }));

    const groups = await searchLyricsFromAllPlugins('自定义搜索内容');

    expect(groups.map(group => group.pluginId)).toEqual([
      musicFreePlugin.id,
      lxPlugin.id,
    ]);
    expect(groups.map(group => group.sources.map(source => source.candidates.length))).toEqual([
      [1],
      [1, 0],
    ]);
    expect(mocks.pluginMusicSearchWithDiagnostics).toHaveBeenCalledWith(
      musicFreePlugin,
      '自定义搜索内容',
      1,
      30,
      true,
    );
    expect(mocks.lxSearch).toHaveBeenCalledTimes(2);
  });

  it('keeps the diagnostic reason when a plugin returns no results', async () => {
    mocks.getStoredPlugins.mockReturnValue([musicFreePlugin]);
    mocks.pluginMusicSearchWithDiagnostics.mockResolvedValue({
      results: [],
      status: 'search_failed',
      reason: '插件搜索调用失败：HTTP 403',
      supportsLyrics: true,
    });

    const groups = await searchLyricsFromAllPlugins('歌曲 歌手');

    expect(groups[0]?.sources[0]).toMatchObject({
      status: 'error',
      reason: '插件搜索调用失败：HTTP 403',
      candidates: [],
    });
  });

  it('hides plugins that do not support the lyrics workflow', async () => {
    mocks.getStoredPlugins.mockReturnValue([musicFreePlugin]);
    mocks.pluginMusicSearchWithDiagnostics.mockResolvedValue({
      results: [],
      status: 'lyrics_unsupported',
      reason: '插件未实现独立歌词方法 getLyric',
      supportsLyrics: false,
    });

    await expect(searchLyricsFromAllPlugins('歌曲 歌手')).resolves.toEqual([]);
  });

  it('updates online song metadata and reloads lyrics immediately', async () => {
    const song = createSong();
    mocks.playbackStore.currentSong = song;

    await expect(applyLyricsReplacement(song, '\uFEFF[00:01.00]新歌词')).resolves.toBe('runtime');

    expect(mocks.patchSongMeta).toHaveBeenCalledWith(song.path, {
      lyrics_raw: '[00:01.00]新歌词',
    });
    expect(mocks.patchQueueSongMeta).toHaveBeenCalledWith(song.path, {
      lyrics_raw: '[00:01.00]新歌词',
    });
    expect(mocks.loadLyrics).toHaveBeenCalledWith('[00:01.00]新歌词');
  });

  it('writes local lyrics back to the existing storage source', async () => {
    const song = createSong('C:/Music/song.flac');
    mocks.playbackStore.currentSong = song;
    mocks.tauriInvoke
      .mockResolvedValueOnce({ source: 'embedded', sourcePath: null, lyrics: '旧歌词' })
      .mockResolvedValueOnce({ source: 'embedded', sourcePath: null, lyrics: '新歌词' });

    await expect(applyLyricsReplacement(song, '[00:01.00]新歌词')).resolves.toBe('saved');

    expect(mocks.tauriInvoke).toHaveBeenNthCalledWith(2, 'save_song_lyrics', {
      path: song.path,
      lyrics: '[00:01.00]新歌词',
      source: 'embedded',
      sourcePath: null,
    });
    expect(mocks.loadLyrics).toHaveBeenCalledWith('[00:01.00]新歌词');
  });
});
