import { describe, expect, it } from 'vitest';
import { applySyncOps, type PlaylistMetaPatch, type SyncOpsTarget, type SyncOpsWriteState } from './playlistOpsApply';
import { buildLibraryMatchIndex } from './libraryMatch';
import type { Playlist, Song } from '../../../types';
import type { SyncOp } from '../playlistSyncTypes';

// ==================== 测试用 fake target ====================

function createFakeTarget(songList: Song[] = []) {
  const byId = new Map<string, Playlist>();
  const byCloudId = new Map<string, Playlist>();
  const keptByCloud = new Map<string, Set<string>>();
  const pendingByCloud = new Map<string, Set<string>>();
  const created: Playlist[] = [];
  const writes: Array<{ id: string; next: SyncOpsWriteState }> = [];
  const extraSongs: Song[] = [];

  const target: SyncOpsTarget = {
    matchIndex: buildLibraryMatchIndex(songList),
    findByCloudId: cloudId => byCloudId.get(cloudId),
    findById: id => byId.get(id),
    isSongKept: (cloudId, path) => keptByCloud.get(cloudId)?.has(path) ?? false,
    isSongPendingDeleted: (cloudId, path) => pendingByCloud.get(cloudId)?.has(path) ?? false,
    createPlaylist: pl => {
      created.push(pl);
      byId.set(pl.id, pl);
      if (pl.cloudId) byCloudId.set(pl.cloudId, pl);
    },
    writePlaylist: (id, next) => {
      writes.push({ id, next });
      const pl = byId.get(id);
      if (pl) {
        pl.songPaths = next.songPaths;
        pl.songs = next.songs;
        const meta: PlaylistMetaPatch = next.meta;
        if (meta.cloudCoverUrl !== undefined) pl.cloudCoverUrl = meta.cloudCoverUrl;
        if (meta.sourcePluginId !== undefined) pl.sourcePluginId = meta.sourcePluginId;
        if (meta.sourceUrl !== undefined) pl.sourceUrl = meta.sourceUrl;
        if (meta.sourceRaw !== undefined) (pl as any).sourceRaw = meta.sourceRaw;
        if (meta.cloudId !== undefined) {
          pl.cloudId = meta.cloudId;
          byCloudId.set(meta.cloudId, pl);
        }
        if (meta.isCloud !== undefined) pl.isCloud = meta.isCloud;
      }
    },
    setExtraSongs: songs => extraSongs.push(...songs),
  };

  const addPlaylist = (pl: Partial<Playlist> & Pick<Playlist, 'id' | 'name' | 'songPaths'>): Playlist => {
    const full = { isCloud: false, ...pl } as Playlist;
    byId.set(full.id, full);
    if (full.cloudId) byCloudId.set(full.cloudId, full);
    return full;
  };

  return { target, byId, byCloudId, keptByCloud, pendingByCloud, created, writes, extraSongs, addPlaylist };
}

const song = (path: string, title: string, artist: string, duration = 180): Song =>
  ({ path, title, name: title, artist, duration } as Song);

describe('applySyncOps', () => {
  it('create_playlist 新建歌单并解析本地路径', () => {
    const local = song('C:/Music/a.mp3', 'Song A', 'Artist', 180);
    const env = createFakeTarget([local]);
    const ops: SyncOp[] = [{
      type: 'create_playlist',
      playlist: {
        id: 'pl-1', name: '云端歌单', cloudId: 'c-1', cloudCoverUrl: 'http://cover',
        isFavorite: true, createdAt: '2026-01-01',
        songs: [{ path: 'C:/Music/a.mp3', title: 'Song A', artist: 'Artist' } as any],
      },
    }];

    const outcome = applySyncOps(ops, env.target);

    expect(outcome.createdPlaylists).toBe(1);
    expect(env.created).toHaveLength(1);
    const pl = env.created[0];
    expect(pl.cloudId).toBe('c-1');
    expect(pl.isCloud).toBe(true);
    expect(pl.cloudCoverUrl).toBe('http://cover');
    expect(pl.songPaths).toEqual(['C:/Music/a.mp3']);
    expect(env.extraSongs).toHaveLength(1);
  });

  it('create_playlist 按 cloudId 命中既有歌单时走合并而非重复建单', () => {
    const env = createFakeTarget();
    const existing = env.addPlaylist({
      id: 'pl-1', name: '已有', songPaths: ['C:/Music/old.mp3'], cloudId: 'c-1',
    });
    const ops: SyncOp[] = [{
      type: 'create_playlist',
      playlist: {
        id: 'pl-1', name: '云端歌单', cloudId: 'c-1',
        songs: [{ path: 'C:/Music/new.mp3', title: 'New', artist: 'A' } as any],
      },
    }];

    const outcome = applySyncOps(ops, env.target);

    expect(env.created).toHaveLength(0);
    expect(outcome.mergedPlaylists).toBe(1);
    const write = env.writes.find(w => w.id === 'pl-1');
    expect(write?.next.songPaths).toEqual(['C:/Music/old.mp3', 'C:/Music/new.mp3']);
    expect(existing.isCloud).toBe(true);
  });

  it('create_playlist 在 cloudId 缺失时按本地 id 兜底匹配', () => {
    const env = createFakeTarget();
    env.addPlaylist({ id: 'pl-1', name: '已有', songPaths: [] });
    const ops: SyncOp[] = [{
      type: 'create_playlist',
      playlist: { id: 'pl-1', name: '云端歌单', cloudId: 'c-1', songs: [] },
    }];

    const outcome = applySyncOps(ops, env.target);

    expect(env.created).toHaveLength(0);
    expect(outcome.mergedPlaylists).toBe(1);
    expect(env.writes[0]?.next.meta.cloudId).toBe('c-1');
  });

  it('add_songs 只追加本地没有的歌曲并按 path 去重', () => {
    const env = createFakeTarget();
    env.addPlaylist({
      id: 'pl-1', name: '已有', songPaths: ['C:/Music/a.mp3'],
      songs: [song('C:/Music/a.mp3', 'Song A', 'Artist')],
      cloudId: 'c-1',
    });
    const ops: SyncOp[] = [{
      type: 'add_songs', cloudId: 'c-1',
      songs: [
        { path: 'C:/Music/a.mp3', title: 'Song A', artist: 'Artist' } as any,
        { path: 'C:/Music/b.mp3', title: 'Song B', artist: 'Artist' } as any,
      ],
    }];

    const outcome = applySyncOps(ops, env.target);

    expect(outcome.addedSongs).toBe(1);
    expect(env.writes[0]?.next.songPaths).toEqual(['C:/Music/a.mp3', 'C:/Music/b.mp3']);
    expect(env.writes[0]?.next.songs).toHaveLength(2);
  });

  it('add_songs 过滤 cloudKeep 与 pendingDeleted 中的歌曲', () => {
    const env = createFakeTarget();
    env.addPlaylist({ id: 'pl-1', name: '已有', songPaths: [], cloudId: 'c-1' });
    env.keptByCloud.set('c-1', new Set(['keep://1']));
    env.pendingByCloud.set('c-1', new Set(['pending://1']));
    const ops: SyncOp[] = [{
      type: 'add_songs', cloudId: 'c-1',
      songs: [
        { path: 'keep://1' } as any,
        { path: 'pending://1' } as any,
        { path: 'lx://ok/1' } as any,
      ],
    }];

    const outcome = applySyncOps(ops, env.target);

    expect(env.writes[0]?.next.songPaths).toEqual(['lx://ok/1']);
    expect(outcome.addedSongs).toBe(1);
  });

  it('add_songs 无命中歌单时跳过', () => {
    const env = createFakeTarget();
    const ops: SyncOp[] = [{
      type: 'add_songs', cloudId: 'missing',
      songs: [{ path: 'lx://x/1' } as any],
    }];

    const outcome = applySyncOps(ops, env.target);

    expect(outcome.mergedPlaylists).toBe(0);
    expect(env.writes).toHaveLength(0);
  });

  it('add_songs 在 cloudId 未命中时按 id 字段兜底匹配', () => {
    const env = createFakeTarget();
    env.addPlaylist({ id: 'pl-1', name: '已有', songPaths: [] });
    const ops: SyncOp[] = [{
      type: 'add_songs', cloudId: 'c-1', id: 'pl-1',
      songs: [{ path: 'lx://ok/1' } as any],
    }];

    const outcome = applySyncOps(ops, env.target);

    expect(env.writes).toHaveLength(1);
    expect(outcome.addedSongs).toBe(1);
  });

  it('id 兜底命中时回写 cloudId，已有一致 cloudId 时不重复写', () => {
    const env = createFakeTarget();
    env.addPlaylist({ id: 'pl-1', name: '已有', songPaths: [] });
    const ops: SyncOp[] = [{ type: 'add_songs', cloudId: 'c-1', id: 'pl-1', songs: [] }];

    applySyncOps(ops, env.target);

    expect(env.writes[0]?.next.meta.cloudId).toBe('c-1');

    const env2 = createFakeTarget();
    env2.addPlaylist({ id: 'pl-2', name: '已有', songPaths: ['a'], cloudId: 'c-9' });
    applySyncOps(
      [{ type: 'add_songs', cloudId: 'c-9', songs: [] }],
      env2.target,
    );
    expect(env2.writes[0]?.next.meta).toEqual({});
  });

  it('remove_songs 过滤墓碑路径（songPaths 与 songs 元数据同步清理）', () => {
    const env = createFakeTarget();
    env.addPlaylist({
      id: 'pl-1', name: '已有', songPaths: ['a', 'b', 'c'], cloudId: 'c-1',
      songs: [song('a', 'A', 'x'), song('b', 'B', 'x'), song('c', 'C', 'x')],
    });
    const ops: SyncOp[] = [{ type: 'remove_songs', cloudId: 'c-1', paths: ['a', 'c'] }];

    const outcome = applySyncOps(ops, env.target);

    expect(outcome.removedSongs).toBe(2);
    expect(env.writes[0]?.next.songPaths).toEqual(['b']);
    expect(env.writes[0]?.next.songs?.map(s => s.path)).toEqual(['b']);
  });

  it('update_playlist_meta 只应用 patch 中出现的字段', () => {
    const env = createFakeTarget();
    const existing = env.addPlaylist({
      id: 'pl-1', name: '已有', songPaths: ['a'], cloudId: 'c-1',
      cloudCoverUrl: 'http://old', sourcePluginId: 'p1',
    });
    const ops: SyncOp[] = [{
      type: 'update_playlist_meta', cloudId: 'c-1',
      cloudCoverUrl: 'http://new', sourceUrl: 'http://s',
    }];

    applySyncOps(ops, env.target);

    expect(existing.cloudCoverUrl).toBe('http://new');
    expect(existing.sourceUrl).toBe('http://s');
    expect(existing.sourcePluginId).toBe('p1');
    expect(env.writes[0]?.next.songPaths).toEqual(['a']);
  });

  it('混合 ops 顺序应用且相互独立', () => {
    const env = createFakeTarget();
    env.addPlaylist({ id: 'pl-1', name: '已有', songPaths: ['old'], cloudId: 'c-1' });
    const ops: SyncOp[] = [
      { type: 'update_playlist_meta', cloudId: 'c-1', cloudCoverUrl: 'http://cover' },
      { type: 'add_songs', cloudId: 'c-1', songs: [{ path: 'lx://1' } as any] },
      { type: 'remove_songs', cloudId: 'c-1', paths: ['old'] },
      { type: 'create_playlist', playlist: { id: 'pl-2', name: '新歌单', cloudId: 'c-2', songs: [] } },
    ];

    const outcome = applySyncOps(ops, env.target);

    expect(outcome.mergedPlaylists).toBe(1);
    expect(outcome.createdPlaylists).toBe(1);
    expect(outcome.removedSongs).toBe(1);
    expect(env.byId.get('pl-1')?.songPaths).toEqual(['lx://1']);
    expect(env.byId.get('pl-1')?.cloudCoverUrl).toBe('http://cover');
    expect(env.byId.get('pl-2')?.isCloud).toBe(true);
  });
});
