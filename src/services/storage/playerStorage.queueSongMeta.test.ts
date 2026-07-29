/**
 * Tests for playerStorage queueSongMeta I/O.
 *
 * queueSongMeta 用于持久化播放队列/歌单中在线歌（lx://）的完整 Song 元数据，
 * 使非收藏在线歌重启后能从队列还原（含 duration），不再整首丢失。
 *
 * Covers:
 *   - writePlayerState 写入 + readQueueSongMeta 读回往返
 *   - duration 等关键字段保留
 *   - 非法数据过滤
 *   - 空/缺失时返回空对象
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { playerStorage, playerStorageKeys } from './playerStorage';
import type { Song } from '../../types';

type StorageMap = Record<string, string>;

const createLocalStorageMock = () => {
  let storage: StorageMap = {};
  return {
    clear: vi.fn(() => { storage = {}; }),
    getItem: vi.fn((key: string) => (key in storage ? storage[key] : null)),
    removeItem: vi.fn((key: string) => { delete storage[key]; }),
    setItem: vi.fn((key: string, value: string) => { storage[key] = value; }),
    get length() { return Object.keys(storage).length; },
    key: vi.fn((index: number) => Object.keys(storage)[index] ?? null),
  };
};

const makeOnlineSong = (overrides: Partial<Song> = {}): Song => ({
  name: '测试在线歌',
  title: '测试在线歌',
  path: 'lx://wy/123456',
  artist: '歌手',
  album: '专辑',
  duration: 263,
  source_type: 'remote',
  cover_thumb_path: '',
  ...overrides,
} as unknown as Song);

const writeMeta = (queueSongMeta: Record<string, Song>) => {
  playerStorage.writePlayerState({
    playlistPathKey: 'k_playlist',
    queuePathKey: 'k_queue',
    legacyPlaylistKey: 'k_legacy_playlist',
    legacyQueueKey: 'k_legacy_queue',
    sourceSongPaths: [],
    watchedFolders: [],
    favoritePaths: [],
    favoriteSongMeta: {},
    queueSongMeta,
    playlists: [],
    settings: {} as any,
    playQueuePaths: [],
    artistCustomOrder: [],
    albumCustomOrder: [],
    folderCustomOrder: {},
    localCustomOrder: [],
  });
};

describe('playerStorage: queueSongMeta I/O', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageMock());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns empty object when nothing stored', () => {
    expect(playerStorage.readQueueSongMeta()).toEqual({});
  });

  it('round-trips an online song with duration preserved', () => {
    const song = makeOnlineSong({ path: 'lx://wy/abc', duration: 200 });
    writeMeta({ 'lx://wy/abc': song });

    const result = playerStorage.readQueueSongMeta();
    expect(Object.keys(result)).toEqual(['lx://wy/abc']);
    expect(result['lx://wy/abc'].duration).toBe(200);
    expect(result['lx://wy/abc'].path).toBe('lx://wy/abc');
  });

  it('round-trips multiple songs', () => {
    writeMeta({
      'lx://wy/1': makeOnlineSong({ path: 'lx://wy/1', duration: 100 }),
      'lx://kg/2': makeOnlineSong({ path: 'lx://kg/2', duration: 250 }),
    });
    const result = playerStorage.readQueueSongMeta();
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['lx://kg/2'].duration).toBe(250);
  });

  it('filters out entries without a string path', () => {
    localStorage.setItem(
      playerStorageKeys.queueSongMeta,
      JSON.stringify({ good: { path: 'lx://wy/ok', duration: 5 }, bad: { duration: 9 }, worse: 42 }),
    );
    const result = playerStorage.readQueueSongMeta();
    expect(Object.keys(result)).toEqual(['good']);
  });

  it('returns empty object for non-object stored value', () => {
    localStorage.setItem(playerStorageKeys.queueSongMeta, JSON.stringify([1, 2, 3]));
    expect(playerStorage.readQueueSongMeta()).toEqual({});
  });
});
