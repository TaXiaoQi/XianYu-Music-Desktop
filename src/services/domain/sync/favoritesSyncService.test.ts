import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Song } from '../../../types';
import { createFavoritesSyncFlow, type FavoritesSyncFlowDeps } from './favoritesSyncService';

vi.mock('../favoritesSync', () => ({
  downloadFavorites: vi.fn(),
  uploadFavorites: vi.fn(),
}));
vi.mock('../playlistSyncSong', () => ({
  getCiyuanxiId: vi.fn(() => 'cyx-1'),
}));
vi.mock('../favoritesSyncState', () => ({
  getCloudKeepPaths: vi.fn(() => new Set<string>()),
  getLocalOnlyPaths: vi.fn(() => new Set<string>()),
  loadSyncedFavoritePaths: vi.fn(() => []),
  persistSyncedFavoritePaths: vi.fn(),
  removeCloudKeepPaths: vi.fn(),
  removeLocalOnlyPaths: vi.fn(),
}));

import { downloadFavorites } from '../favoritesSync';
import { getCloudKeepPaths } from '../favoritesSyncState';

const song = (overrides: Partial<Song> = {}): Song =>
  ({
    path: '',
    name: '',
    title: '',
    artist: '',
    album: '',
    duration: 0,
    ...overrides,
  }) as Song;

interface Harness {
  deps: FavoritesSyncFlowDeps;
  favoritePaths: string[];
  metaWrites: Array<Record<string, Song>>;
  extraWrites: Song[][];
}

function makeHarness(options: {
  favoritePaths?: string[];
  favoriteSongMeta?: Record<string, Song>;
  librarySongs?: Song[];
  cloudKeep?: string[];
} = {}): Harness {
  const favoritePaths = [...(options.favoritePaths ?? [])];
  let favoriteSongMeta = { ...(options.favoriteSongMeta ?? {}) };
  const metaWrites: Array<Record<string, Song>> = [];
  const extraWrites: Song[][] = [];

  const collections = {
    favoritePaths,
    favoriteSongMeta,
    setFavoritePaths: (paths: string[]) => {
      favoritePaths.length = 0;
      favoritePaths.push(...paths);
    },
    setFavoriteSongMetaMap: (map: Record<string, Song>) => {
      favoriteSongMeta = map;
      metaWrites.push(map);
    },
  };
  const library = {
    songList: options.librarySongs ?? [],
    songLookup: new Map((options.librarySongs ?? []).map(s => [s.path, s] as const)),
    setExtraSongs: (songs: Song[]) => { extraWrites.push(songs); },
  };

  const deps: FavoritesSyncFlowDeps = {
    canSync: () => true,
    isUploadEnabled: () => true,
    collections,
    library,
    onProgress: () => {},
    notify: () => {},
    setSyncing: () => {},
    setLastResult: () => {},
    setLastTime: () => {},
    log: () => {},
    logError: () => {},
  };
  return { deps, favoritePaths, metaWrites, extraWrites };
}

beforeEach(() => {
  vi.mocked(downloadFavorites).mockReset();
  vi.mocked(getCloudKeepPaths).mockReturnValue(new Set<string>());
});

describe('createFavoritesSyncFlow.downloadFavoritesOnly', () => {
  it('云端在线收藏下载后补挂进曲库索引并写入元数据表', async () => {
    const onlineA = song({ path: 'lx://wy/a1', title: '云歌A', name: '云歌A', artist: '歌手A', album: '专辑A' });
    const onlineB = song({ path: 'lx://tx/b1', title: '云歌B', name: '云歌B', artist: '歌手B', album: '专辑B' });
    vi.mocked(downloadFavorites).mockResolvedValue([onlineA, onlineB]);
    const { deps, favoritePaths, metaWrites, extraWrites } = makeHarness();

    await createFavoritesSyncFlow(deps).downloadFavoritesOnly();

    // 曲库索引补挂：收藏页按 songLookup 解析歌曲实体，不补挂会显示 0 首。
    expect(extraWrites).toEqual([[onlineA, onlineB]]);
    expect(favoritePaths).toEqual(['lx://wy/a1', 'lx://tx/b1']);
    expect(metaWrites[0]).toMatchObject({
      'lx://wy/a1': onlineA,
      'lx://tx/b1': onlineB,
    });
  });

  it('元数据表按合并语义写入，不清掉既有在线收藏元数据', async () => {
    const oldMeta = song({ path: 'lx://kg/old', title: '旧收藏', name: '旧收藏', artist: '旧歌手', album: '旧专辑' });
    const incoming = song({ path: 'lx://wy/new1', title: '新歌', name: '新歌', artist: '新歌手', album: '新专辑' });
    vi.mocked(downloadFavorites).mockResolvedValue([incoming]);
    const { deps, metaWrites } = makeHarness({ favoriteSongMeta: { 'lx://kg/old': oldMeta } });

    await createFavoritesSyncFlow(deps).downloadFavoritesOnly();

    expect(metaWrites).toHaveLength(1);
    expect(metaWrites[0]['lx://kg/old']).toBe(oldMeta);
    expect(metaWrites[0]['lx://wy/new1']).toBe(incoming);
  });

  it('本地匹配命中的收藏不进元数据表也不补挂曲库索引', async () => {
    const localSong = song({ path: 'D:\\music\\晴天.mp3', title: '晴天', name: '晴天', artist: '周杰伦', album: '叶惠美' });
    const cloudCopy = song({ path: 'D:\\music\\晴天.mp3', title: '晴天', name: '晴天', artist: '周杰伦', album: '叶惠美' });
    vi.mocked(downloadFavorites).mockResolvedValue([cloudCopy]);
    const { deps, favoritePaths, metaWrites, extraWrites } = makeHarness({ librarySongs: [localSong] });

    await createFavoritesSyncFlow(deps).downloadFavoritesOnly();

    expect(extraWrites).toHaveLength(0);
    expect(metaWrites).toHaveLength(1);
    expect(metaWrites[0]).toEqual({});
    expect(favoritePaths).toEqual(['D:\\music\\晴天.mp3']);
  });

  it('cloudKeep 标记的路径跳过合并与补挂', async () => {
    const onlineA = song({ path: 'lx://wy/a1', title: '云歌A', name: '云歌A', artist: '歌手A', album: '专辑A' });
    vi.mocked(downloadFavorites).mockResolvedValue([onlineA]);
    vi.mocked(getCloudKeepPaths).mockReturnValue(new Set<string>(['lx://wy/a1']));
    const { deps, favoritePaths, extraWrites } = makeHarness();

    await createFavoritesSyncFlow(deps).downloadFavoritesOnly();

    expect(favoritePaths).toEqual([]);
    expect(extraWrites).toHaveLength(0);
  });
});
