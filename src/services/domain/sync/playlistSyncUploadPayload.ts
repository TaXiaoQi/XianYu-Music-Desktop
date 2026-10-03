import type { Playlist, Song } from '../../../types';
import { classifySyncPlaylist } from '../playlistSyncSong';
import type { FileSyncPlaylistData, SyncIdMapEntry, SyncSongPayload } from '../playlistSyncTypes';

// ==================== 上传载荷组装（纯函数） ====================

/**
 * 组装单歌单上传载荷。
 * 歌曲层面的 tombstone（cloudKeep/localOnly/pendingDeleted）合并
 * 由 playlistSyncService 在调用前完成。
 */
export function buildPlaylistUploadItem(params: {
  playlist: Playlist;
  songs: Song[];
  payloadSongs: SyncSongPayload[];
  cloudCoverUrl: string;
  deletedSongPaths?: string[];
}): FileSyncPlaylistData {
  const pl = params.playlist;
  return {
    id: pl.id,
    name: pl.name,
    type: classifySyncPlaylist(params.songs),
    cloudId: pl.cloudId,
    cloudCoverUrl: params.cloudCoverUrl,
    isFavorite: pl.isFavorite,
    createdAt: pl.createdAt,
    songs: params.payloadSongs,
    ...(pl.sourcePluginId ? { sourcePluginId: pl.sourcePluginId } : {}),
    ...(pl.sourceUrl ? { sourceUrl: pl.sourceUrl } : {}),
    ...(pl.sourceRaw ? { sourceRaw: pl.sourceRaw } : {}),
    ...(params.deletedSongPaths ? { deletedSongPaths: params.deletedSongPaths } : {}),
  };
}

/**
 * 上传响应的 id_map 写回本地歌单（id → cloudId）。
 * 返回成功写回的条数。
 */
export function applyUploadIdMap(
  idMap: SyncIdMapEntry[] | undefined,
  setPlaylistCloudId: (id: string, cloudId: string) => boolean,
): number {
  if (!idMap?.length) return 0;
  let written = 0;
  for (const { id, cloudId } of idMap) {
    if (id && cloudId && setPlaylistCloudId(id, cloudId)) {
      written++;
    }
  }
  return written;
}
