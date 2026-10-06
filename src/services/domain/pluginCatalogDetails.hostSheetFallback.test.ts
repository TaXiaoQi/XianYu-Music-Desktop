import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PluginSource } from '../../types';

vi.mock('./pluginEngineBase', () => ({
  log: vi.fn(),
  isBilibiliSource: vi.fn(() => false),
}));
vi.mock('./pluginEngineInstance', () => ({
  ensurePluginInstance: vi.fn(),
}));
vi.mock('./bakaPluginManager', () => ({
  BakaPluginManager: {
    isBakaPlugin: vi.fn(async () => false),
  },
}));
vi.mock('./qqHostSearchFallback', () => ({
  isQqMusicPluginSource: vi.fn(async () => false),
  qqFillSongDurations: vi.fn(async (_s: unknown, _p: unknown, r: unknown) => r),
  qqHostAlbumSongsFallback: vi.fn(async () => []),
}));
vi.mock('./lxToplist', () => ({
  lxToplistFetchTopLists: vi.fn(async () => []),
  lxToplistFetchTracks: vi.fn(async () => ({ list: [], isEnd: true })),
}));
vi.mock('../fallbackModules/registry', () => ({
  dispatchFallbackModule: vi.fn((_key: string, _method: string, _args: unknown, builtin: () => unknown) => builtin()),
  dispatchFallbackModuleMany: vi.fn(
    (_key: string, _method: string, argsList: unknown[], builtinMany: (args: unknown, i: number) => unknown) =>
      Promise.resolve(argsList.map((args, i) => builtinMany(args, i))),
  ),
}));
vi.mock('../tauri/playlistImportApi', () => ({
  playlistImportApi: {
    fetchPlaylistFromSource: vi.fn(),
  },
}));

import { ensurePluginInstance } from './pluginEngineInstance';
import { playlistImportApi } from '../tauri/playlistImportApi';
import { pluginGetPlaylistDetailWithEnd } from './pluginCatalogDetails';

const makeSource = (): PluginSource => ({
  id: 'src-1',
  name: '小咪音乐',
  format: 'musicfree',
  enabled: true,
  filePath: 'http://example.com/xiaomi.js',
} as unknown as PluginSource);

// 宿主（Rust playlist_fetcher）返回的歌单条目形状
const makeHostSong = (i: number, hash?: string) => ({
  id: hash ?? `HOSTHASH${String(i).padStart(6, '0')}`,
  title: `宿主歌曲${i}`,
  artist: `歌手${i}`,
  album: `专辑${i}`,
  coverUrl: '',
  duration: 200000,
  platform: '酷狗',
  platformId: hash ?? `HOSTHASH${String(i).padStart(6, '0')}`,
  pluginId: 'src-1',
  rawData: { songmid: hash ?? `HOSTHASH${String(i).padStart(6, '0')}`, hash: hash ?? `HOSTHASH${String(i).padStart(6, '0')}`, source: 'kg', name: `宿主歌曲${i}`, singer: `歌手${i}` },
});

// 插件 getMusicSheetInfo 返回的条目形状（与宿主 hash 对齐才能过交叠校验）
const makePluginSong = (hash: string) => ({
  id: hash,
  title: `插件歌曲-${hash}`,
  artist: '某歌手',
  hash,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pluginGetPlaylistDetailWithEnd 宿主歌单全量兜底', () => {
  it('插件单页截断（isEnd=true、第二页空）→ 宿主 kg 全量补齐', async () => {
    const page1Hashes = Array.from({ length: 31 }, (_, i) => `HASH${String(i).padStart(6, '0')}`);
    const getMusicSheetInfo = vi.fn((_item: any, page: number) => {
      if (page === 1) return Promise.resolve({ isEnd: true, list: page1Hashes.map(makePluginSong) });
      return Promise.resolve({ list: [] });
    });
    (ensurePluginInstance as ReturnType<typeof vi.fn>).mockResolvedValue({ instance: { getMusicSheetInfo } });
    // 宿主 kg 返回全量 100 首，前 31 首与插件首页 hash 对齐
    const full = Array.from({ length: 100 }, (_, i) =>
      makeHostSong(i, i < page1Hashes.length ? page1Hashes[i] : undefined));
    (playlistImportApi.fetchPlaylistFromSource as ReturnType<typeof vi.fn>).mockImplementation(
      async (source: string) => (source === 'kg' ? { source: 'kg', songs: full, total: full.length, info: {} } : Promise.reject(new Error('nope'))),
    );

    const sheetItem = { id: '123456', title: '测试歌单' };
    const { songs, isEnd } = await pluginGetPlaylistDetailWithEnd(makeSource(), sheetItem, 1);

    expect(isEnd).toBe(true);
    expect(songs).toHaveLength(100);
    expect(playlistImportApi.fetchPlaylistFromSource).toHaveBeenCalledWith('kg', '123456');
    // 命中 kg 后不再尝试其他平台
    expect(playlistImportApi.fetchPlaylistFromSource).toHaveBeenCalledTimes(1);
    // 兜底条目保留宿主 rawData 供插件播放链路使用
    expect((songs[0] as any).rawData.songmid).toBe('HASH000000');
  });

  it('插件会翻页（isEnd=false、第二页有数据）→ 不兜底', async () => {
    const getMusicSheetInfo = vi.fn((_item: any, page: number) =>
      Promise.resolve({ isEnd: false, list: Array.from({ length: 30 }, (_, i) => makePluginSong(`P${page}-${i}`)) }));
    (ensurePluginInstance as ReturnType<typeof vi.fn>).mockResolvedValue({ instance: { getMusicSheetInfo } });

    const { songs, isEnd } = await pluginGetPlaylistDetailWithEnd(makeSource(), { id: '123' }, 1);
    expect(songs).toHaveLength(30);
    expect(isEnd).toBe(false);
    expect(playlistImportApi.fetchPlaylistFromSource).not.toHaveBeenCalled();
  });

  it('声明曲目数 ≤ 插件首页 → 首页已完整，不探测不兜底', async () => {
    const getMusicSheetInfo = vi.fn((_item: any, page: number) =>
      Promise.resolve({ isEnd: true, list: Array.from({ length: 20 }, (_, i) => makePluginSong(`DONE${i}`)) }));
    (ensurePluginInstance as ReturnType<typeof vi.fn>).mockResolvedValue({ instance: { getMusicSheetInfo } });

    await pluginGetPlaylistDetailWithEnd(makeSource(), { id: '123', trackCount: 20 }, 1);
    expect(getMusicSheetInfo).toHaveBeenCalledTimes(1); // 只取首页
    expect(playlistImportApi.fetchPlaylistFromSource).not.toHaveBeenCalled();
  });

  it('宿主结果与插件首页无 ID 交叠 → 拒绝兜底，维持插件数据', async () => {
    const getMusicSheetInfo = vi.fn((_item: any, page: number) => {
      if (page === 1) return Promise.resolve({ isEnd: true, list: Array.from({ length: 31 }, (_, i) => makePluginSong(`ONLY${i}`)) });
      return Promise.resolve({ list: [] });
    });
    (ensurePluginInstance as ReturnType<typeof vi.fn>).mockResolvedValue({ instance: { getMusicSheetInfo } });
    // 各平台都返回无交叠的大歌单（模拟纯数字 ID 跨平台撞车）
    (playlistImportApi.fetchPlaylistFromSource as ReturnType<typeof vi.fn>).mockImplementation(
      async () => ({ source: 'kg', songs: Array.from({ length: 200 }, (_, i) => makeHostSong(1000 + i)), total: 200, info: {} }),
    );

    const { songs } = await pluginGetPlaylistDetailWithEnd(makeSource(), { id: '777' }, 1);
    expect(songs).toHaveLength(31);
    expect((songs[0] as any).title).toContain('ONLY0');
  });

  it('宿主结果不多于插件首页 → 不采用', async () => {
    const page1Hashes = Array.from({ length: 31 }, (_, i) => `SAME${i}`);
    const getMusicSheetInfo = vi.fn((_item: any, page: number) => {
      if (page === 1) return Promise.resolve({ isEnd: true, list: page1Hashes.map(makePluginSong) });
      return Promise.resolve({ list: [] });
    });
    (ensurePluginInstance as ReturnType<typeof vi.fn>).mockResolvedValue({ instance: { getMusicSheetInfo } });
    (playlistImportApi.fetchPlaylistFromSource as ReturnType<typeof vi.fn>).mockImplementation(
      async () => ({ source: 'kg', songs: Array.from({ length: 10 }, (_, i) => makeHostSong(i, i < page1Hashes.length ? page1Hashes[i] : undefined)), total: 10, info: {} }),
    );

    const { songs } = await pluginGetPlaylistDetailWithEnd(makeSource(), { id: '888' }, 1);
    expect(songs).toHaveLength(31);
  });
});
