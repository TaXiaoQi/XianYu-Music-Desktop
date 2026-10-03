import { describe, expect, it } from 'vitest';
import { applyUploadIdMap, buildPlaylistUploadItem } from './playlistSyncUploadPayload';
import type { Playlist } from '../../../types';

const playlist = (overrides: Partial<Playlist> = {}): Playlist =>
  ({
    id: 'pl-1',
    name: '歌单',
    songPaths: [],
    isFavorite: false,
    createdAt: '2026-01-01',
    ...overrides,
  }) as Playlist;

describe('buildPlaylistUploadItem', () => {
  it('组装基础载荷并分类歌单类型', () => {
    const item = buildPlaylistUploadItem({
      playlist: playlist(),
      songs: [],
      payloadSongs: [],
      cloudCoverUrl: 'http://cover',
    });

    expect(item).toMatchObject({
      id: 'pl-1',
      name: '歌单',
      cloudCoverUrl: 'http://cover',
      isFavorite: false,
      createdAt: '2026-01-01',
      songs: [],
    });
    expect(item.sourcePluginId).toBeUndefined();
    expect(item.deletedSongPaths).toBeUndefined();
  });

  it('可选字段仅在存在时输出，墓碑列表原样透传', () => {
    const item = buildPlaylistUploadItem({
      playlist: playlist({ cloudId: 'c-1', sourcePluginId: 'lx', sourceUrl: 'http://s' }),
      songs: [],
      payloadSongs: [],
      cloudCoverUrl: '',
      deletedSongPaths: ['a', 'b'],
    });

    expect(item.cloudId).toBe('c-1');
    expect(item.sourcePluginId).toBe('lx');
    expect(item.sourceUrl).toBe('http://s');
    expect(item.deletedSongPaths).toEqual(['a', 'b']);
  });
});

describe('applyUploadIdMap', () => {
  it('写回全部有效条目并返回计数', () => {
    const written: Array<[string, string]> = [];
    const n = applyUploadIdMap(
      [
        { id: 'a', cloudId: 'c-a' },
        { id: 'b', cloudId: 'c-b' },
      ],
      (id, cloudId) => {
        written.push([id, cloudId]);
        return true;
      },
    );

    expect(n).toBe(2);
    expect(written).toEqual([['a', 'c-a'], ['b', 'c-b']]);
  });

  it('写回失败与空字段不计入，空 id_map 返回 0', () => {
    const n = applyUploadIdMap(
      [
        { id: 'a', cloudId: 'c-a' },
        { id: '', cloudId: 'c-x' },
        { id: 'c' },
      ],
      id => id !== 'a',
    );

    expect(n).toBe(0);
    expect(applyUploadIdMap(undefined, () => true)).toBe(0);
    expect(applyUploadIdMap([], () => true)).toBe(0);
  });
});
