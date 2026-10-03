import type { Playlist, Song } from '../../../types';
import { syncPayloadToSong } from '../playlistSyncSong';
import type { SyncOp, SyncSongPayload } from '../playlistSyncTypes';
import { resolveLocalPath, type LibraryMatchIndex } from './libraryMatch';

// ==================== v2 ops 应用（纯函数，PR-3 启用） ====================
// 与 v1 下载合并（playlistSyncService.downloadPlaylists）同构：
// diff 计算移到 Server，本模块负责把 ops 幂等地应用到本地歌单。
// 匹配既有歌单时 cloudId 优先、云端快照 id 兜底（消除跨设备重复建单）。

export interface PlaylistMetaPatch {
  cloudCoverUrl?: string;
  sourcePluginId?: string;
  sourceUrl?: string;
  sourceRaw?: unknown;
  cloudId?: string;
  isCloud?: boolean;
}

/** 写回既有歌单的完整状态（songPaths/songs 由本模块算好，实现方只负责落 store）。 */
export interface SyncOpsWriteState {
  songPaths: string[];
  songs: Song[] | undefined;
  meta: PlaylistMetaPatch;
}

export interface SyncOpsTarget {
  matchIndex: LibraryMatchIndex;
  findByCloudId(cloudId: string): Playlist | undefined;
  findById(id: string): Playlist | undefined;
  /** 客户端 tombstone 过滤（与 v1 下载 songKeepMap 语义一致）：仅删本地、云端保留 */
  isSongKept(cloudId: string, path: string): boolean;
  /** 待上报删除集合：本地已删、墓碑未上传 */
  isSongPendingDeleted(cloudId: string, path: string): boolean;
  createPlaylist(playlist: Playlist): void;
  writePlaylist(id: string, next: SyncOpsWriteState): void;
  setExtraSongs(songs: Song[]): void;
}

export interface SyncOpsOutcome {
  createdPlaylists: number;
  mergedPlaylists: number;
  /** 各歌单可见云歌曲总数（与 v1 downloadedSongs 口径一致，非净新增） */
  addedSongs: number;
  removedSongs: number;
}

function emptyOutcome(): SyncOpsOutcome {
  return { createdPlaylists: 0, mergedPlaylists: 0, addedSongs: 0, removedSongs: 0 };
}

function toLocalSongs(payloads: SyncSongPayload[], index: LibraryMatchIndex): Song[] {
  return payloads.map(raw => {
    const restored = syncPayloadToSong(raw);
    const resolved = resolveLocalPath(index, restored);
    return resolved === restored.path ? restored : { ...restored, path: resolved };
  });
}

/** 与 v1 下载一致：展开墓碑（含云歌曲元数据可解析的本地路径）并过滤 keep/pending。 */
function visibleLocalSongs(
  cloudSongs: SyncSongPayload[],
  cloudId: string,
  deletedPaths: Set<string>,
  target: SyncOpsTarget,
): { localSongs: Song[]; pathRemap: Map<string, string>; expandedDeleted: Set<string> } {
  const expandedDeleted = new Set(deletedPaths);
  if (deletedPaths.size > 0) {
    for (const raw of cloudSongs) {
      const p = (raw as any).path as string | undefined;
      if (p && deletedPaths.has(p)) {
        const restored = syncPayloadToSong(raw);
        expandedDeleted.add(resolveLocalPath(target.matchIndex, restored));
      }
    }
  }

  const visible = cloudSongs.filter(raw => {
    const p = (raw as any).path as string | undefined;
    if (!p) return true;
    if (expandedDeleted.has(p) || target.isSongPendingDeleted(cloudId, p)) return false;
    return !target.isSongKept(cloudId, p);
  });

  const localSongs = toLocalSongs(visible, target.matchIndex);
  const pathRemap = new Map<string, string>();
  visible.forEach((raw, i) => {
    const originalPath = (raw as any).path as string | undefined;
    const newPath = localSongs[i]?.path;
    if (originalPath && newPath && originalPath !== newPath) {
      pathRemap.set(originalPath, newPath);
    }
  });
  return { localSongs, pathRemap, expandedDeleted };
}

function findExisting(target: SyncOpsTarget, cloudId: string, localId?: string): Playlist | undefined {
  return (cloudId ? target.findByCloudId(cloudId) : undefined)
    ?? (localId ? target.findById(localId) : undefined);
}

/** 把云端歌单增量并入既有歌单（路径重映射/墓碑过滤/按 path 去重追加），返回净增歌曲数。 */
function mergeIntoExisting(
  existing: Playlist,
  localSongs: Song[],
  pathRemap: Map<string, string>,
  expandedDeleted: Set<string>,
  meta: PlaylistMetaPatch,
  target: SyncOpsTarget,
): number {
  if (pathRemap.size > 0) {
    existing.songPaths = existing.songPaths.map(p => pathRemap.get(p) ?? p);
  }

  let songPaths = existing.songPaths;
  let songs = existing.songs;
  let netAdded = 0;

  if (expandedDeleted.size > 0) {
    songPaths = songPaths.filter(p => !expandedDeleted.has(p));
    if (songs?.length) {
      const kept = songs.filter(s => !expandedDeleted.has(s.path));
      songs = kept.length > 0 ? kept : undefined;
    }
  }

  const localSongPaths = new Set(songPaths);
  for (const song of localSongs) {
    if (!localSongPaths.has(song.path)) {
      songPaths = [...songPaths, song.path];
      localSongPaths.add(song.path);
      netAdded++;
    }
  }

  const existingSongPaths = new Set((songs ?? []).map(s => s.path));
  const mergedSongs = [...(songs ?? [])];
  for (const song of localSongs) {
    if (!existingSongPaths.has(song.path)) {
      mergedSongs.push(song);
      existingSongPaths.add(song.path);
    }
  }
  songs = mergedSongs.length > 0 ? mergedSongs : undefined;

  target.writePlaylist(existing.id, { songPaths, songs, meta });
  target.setExtraSongs(localSongs);
  return netAdded;
}

function buildNewPlaylist(cloudPl: {
  id: string;
  name: string;
  cloudId?: string;
  cloudCoverUrl?: string;
  isFavorite?: boolean;
  createdAt?: string;
  sourcePluginId?: string;
  sourceUrl?: string;
  sourceRaw?: any;
}, localSongs: Song[]): Playlist {
  return {
    id: cloudPl.id,
    name: cloudPl.name,
    songPaths: localSongs.map(s => s.path),
    songs: localSongs.length > 0 ? localSongs : undefined,
    cloudId: cloudPl.cloudId,
    isCloud: true,
    cloudCoverUrl: cloudPl.cloudCoverUrl || '',
    isFavorite: cloudPl.isFavorite,
    createdAt: cloudPl.createdAt,
    ...(cloudPl.sourcePluginId ? { sourcePluginId: cloudPl.sourcePluginId } : {}),
    ...(cloudPl.sourceUrl ? { sourceUrl: cloudPl.sourceUrl } : {}),
    ...(cloudPl.sourceRaw ? { sourceRaw: cloudPl.sourceRaw } : {}),
  };
}

export function applySyncOps(ops: SyncOp[], target: SyncOpsTarget): SyncOpsOutcome {
  const outcome = emptyOutcome();

  for (const op of ops) {
    switch (op.type) {
      case 'create_playlist': {
        const cloudPl = op.playlist;
        const existing = findExisting(target, cloudPl.cloudId || '', cloudPl.id);
        const { localSongs, pathRemap, expandedDeleted } = visibleLocalSongs(
          cloudPl.songs ?? [],
          cloudPl.cloudId || '',
          new Set(cloudPl.deletedSongPaths ?? []),
          target,
        );

        if (existing) {
          // 跨设备重复建单防护：cloudId/id 已匹配到本地歌单 → 走合并语义
          mergeIntoExisting(
            existing,
            localSongs,
            pathRemap,
            expandedDeleted,
            {
              ...(cloudPl.cloudCoverUrl ? { cloudCoverUrl: cloudPl.cloudCoverUrl } : {}),
              ...(cloudPl.sourcePluginId ? { sourcePluginId: cloudPl.sourcePluginId } : {}),
              ...(cloudPl.sourceUrl ? { sourceUrl: cloudPl.sourceUrl } : {}),
              ...(cloudPl.sourceRaw ? { sourceRaw: cloudPl.sourceRaw } : {}),
              isCloud: true,
              ...(cloudPl.cloudId ? { cloudId: cloudPl.cloudId } : {}),
            },
            target,
          );
          outcome.mergedPlaylists++;
          outcome.addedSongs += localSongs.length;
        } else {
          target.createPlaylist(buildNewPlaylist(cloudPl, localSongs));
          target.setExtraSongs(localSongs);
          outcome.createdPlaylists++;
          outcome.addedSongs += localSongs.length;
        }
        break;
      }

      case 'add_songs': {
        const existing = findExisting(target, op.cloudId, op.id);
        if (!existing) break;
        const cloudId = existing.cloudId || op.cloudId;
        const visible = (op.songs ?? []).filter(raw => {
          const p = (raw as any).path as string | undefined;
          if (!p) return true;
          if (target.isSongPendingDeleted(cloudId, p)) return false;
          return !target.isSongKept(cloudId, p);
        });
        const localSongs = toLocalSongs(visible, target.matchIndex);
        const netAdded = mergeIntoExisting(existing, localSongs, new Map(), new Set(), {}, target);
        outcome.mergedPlaylists++;
        outcome.addedSongs += netAdded;
        break;
      }

      case 'remove_songs': {
        const existing = findExisting(target, op.cloudId, op.id);
        if (!existing) break;
        const tombstones = new Set(op.paths ?? []);
        if (tombstones.size === 0) break;
        const before = existing.songPaths.length;
        const songPaths = existing.songPaths.filter(p => !tombstones.has(p));
        let songs = existing.songs;
        if (songs?.length) {
          const kept = songs.filter(s => !tombstones.has(s.path));
          songs = kept.length > 0 ? kept : undefined;
        }
        target.writePlaylist(existing.id, { songPaths, songs, meta: {} });
        outcome.removedSongs += before - songPaths.length;
        break;
      }

      case 'update_playlist_meta': {
        const existing = findExisting(target, op.cloudId, op.id);
        if (!existing) break;
        const meta: PlaylistMetaPatch = {};
        if (op.cloudCoverUrl !== undefined) meta.cloudCoverUrl = op.cloudCoverUrl;
        if (op.sourcePluginId !== undefined) meta.sourcePluginId = op.sourcePluginId;
        if (op.sourceUrl !== undefined) meta.sourceUrl = op.sourceUrl;
        target.writePlaylist(existing.id, {
          songPaths: existing.songPaths,
          songs: existing.songs,
          meta,
        });
        break;
      }
    }
  }

  return outcome;
}
