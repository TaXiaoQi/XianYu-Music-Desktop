import type { Playlist, Song } from '../../../types';
import { signedRequest } from '../../auth/authService';
import { readImageBase64 } from '../../tauri/pluginApi';
import {
  deleteCloudPlaylist,
  fileSyncDownload,
  fileSyncUpload,
  firstRemoteSongCover,
  getCiyuanxiId,
  songToSyncPayload,
  syncPayloadToSong,
  type FileSyncPlaylistData,
  type SyncResult,
} from '../playlistSync';
import {
  clearPlaylistSongTombstones,
  getCloudKeepSongs,
  getLocalOnlySongs,
  getPendingDeletedSongs,
  pruneCloudKeepSongs,
  pruneLocalOnlySongs,
  prunePendingDeletedSongs,
} from '../playlistSongSyncState';
import type { ToastKind } from './toastKind';
import { buildLibraryMatchIndex, resolveLocalPath } from './libraryMatch';
import { applyUploadIdMap, buildPlaylistUploadItem } from './playlistSyncUploadPayload';

// ==================== 端口（由 UI 层注入 store 实例） ====================

export interface PlaylistSyncCollectionsPort {
  playlists: Playlist[];
  getPlaylistById(id: string): Playlist | undefined;
  setPlaylistCloudId(id: string, cloudId: string): boolean;
  setPlaylistCloudCoverUrl(id: string, url: string): void;
}

export interface PlaylistSyncLibraryPort {
  songList: Song[];
  setExtraSong(song: Song): void;
}

export interface PlaylistSyncDeps {
  collections: PlaylistSyncCollectionsPort;
  library: PlaylistSyncLibraryPort;
  onProgress(msg: string): void;
  notify(msg: string, kind: ToastKind): void;
  log(msg: string, ...args: unknown[]): void;
  logError(msg: string, ...args: unknown[]): void;
}

// ==================== 服务（业务决策与 IO） ====================

export function createPlaylistSyncService(deps: PlaylistSyncDeps) {
  const { collections, library } = deps;

  function collectPlaylistSongs(playlist: Playlist): Song[] {
    const songs: Song[] = [];

    if (playlist.songs && playlist.songs.length > 0) {
      songs.push(...playlist.songs);
    }

    const songMap = new Map<string, Song>();
    library.songList.forEach(song => songMap.set(song.path, song));
    for (const path of playlist.songPaths) {
      const song = songMap.get(path);
      if (song && !songs.some(s => s.path === song.path)) {
        songs.push(song);
      }
    }

    deps.log(`collectPlaylistSongs: playlist="${playlist.name}", songPaths=${playlist.songPaths.length}, songs.meta=${playlist.songs?.length ?? 0}, collected=${songs.length}`);
    return songs;
  }

  async function resolvePlaylistCloudCover(
    playlist: Playlist,
    songs: Song[],
  ): Promise<string> {
    if (playlist.cloudCoverUrl && /^https?:\/\//i.test(playlist.cloudCoverUrl)) {
      return playlist.cloudCoverUrl;
    }

    const coverPath = playlist.coverPath;
    if (coverPath) {
      try {
        let dataUrl = '';
        if (/^https?:\/\//i.test(coverPath)) {
          return coverPath;
        } else if (coverPath.startsWith('data:')) {
          dataUrl = coverPath;
        } else if (!coverPath.startsWith('asset:')) {
          const { mime, base64 } = await readImageBase64(coverPath);
          if (base64) {
            dataUrl = `data:${mime || 'image/jpeg'};base64,${base64}`;
          }
        }
        if (dataUrl) {
          const res = await signedRequest<{ cover_url?: string }>(
            'upload_cover',
            { image_data: dataUrl },
            { timeoutMs: 20_000, fetchTimeoutMs: 18_000 },
          );
          if (res?.cover_url) return res.cover_url;
        }
      } catch {
        // 封面上传失败静默降级到在线歌曲封面
      }
    }

    return firstRemoteSongCover(songs);
  }

  async function uploadPlaylists(): Promise<SyncResult> {
    const result: SyncResult = {
      uploadedPlaylists: 0,
      downloadedPlaylists: 0,
      uploadedSongs: 0,
      downloadedSongs: 0,
      errors: [],
    };

    const ciyuanxiId = getCiyuanxiId();
    if (!ciyuanxiId) {
      deps.logError('uploadPlaylists: 未获取到弦予号，取消上传');
      result.errors.push('未登录或未获取到弦予号');
      return result;
    }

    const playlists = [...collections.playlists];
    deps.log(`uploadPlaylists: 共 ${playlists.length} 个本地歌单待上传`);
    playlists.forEach((pl, idx) => {
      deps.log(`  本地歌单[${idx}]: name="${pl.name}", id=${pl.id}, cloudId=${pl.cloudId ?? 'none'}, songPaths=${pl.songPaths.length}, songs.meta=${pl.songs?.length ?? 0}`);
    });
    if (playlists.length === 0) {
      deps.log('uploadPlaylists: 无歌单，直接返回');
      return result;
    }

    deps.onProgress('正在上传歌单到云端...');

    try {
      const playlistData: FileSyncPlaylistData[] = [];
      for (const pl of playlists) {
        const songs = collectPlaylistSongs(pl);
        const cloudCoverUrl = await resolvePlaylistCloudCover(pl, songs);
        if (cloudCoverUrl && cloudCoverUrl !== pl.cloudCoverUrl) {
          collections.setPlaylistCloudCoverUrl(pl.id, cloudCoverUrl);
        }
        let payloadSongs = songs.map(songToSyncPayload);
        let deletedSongPaths: string[] | undefined;
        if (pl.cloudId) {
          const cloudId = pl.cloudId;
          const localPaths = new Set(songs.map(s => s.path));
          const keepMap = getCloudKeepSongs(cloudId);
          for (const [path, payloadJson] of Object.entries(keepMap)) {
            if (!payloadSongs.some(s => s.path === path)) {
              try {
                payloadSongs.push(JSON.parse(payloadJson) as typeof payloadSongs[number]);
              } catch {
                // 缓存载荷损坏时忽略，云端将由下次有效上传覆盖
              }
            }
          }
          pruneCloudKeepSongs(cloudId, localPaths);
          const localOnly = getLocalOnlySongs(cloudId);
          if (localOnly.size > 0) {
            payloadSongs = payloadSongs.filter(s => !localOnly.has(s.path));
            pruneLocalOnlySongs(cloudId, localPaths);
          }
          const pending = getPendingDeletedSongs(cloudId);
          if (pending.size > 0) {
            prunePendingDeletedSongs(cloudId, Array.from(pending).filter(p => localPaths.has(p)));
          }
          const report = new Set<string>([...getLocalOnlySongs(cloudId), ...getPendingDeletedSongs(cloudId)]);
          if (report.size > 0) deletedSongPaths = Array.from(report);
        }
        playlistData.push(buildPlaylistUploadItem({
          playlist: pl,
          songs,
          payloadSongs,
          cloudCoverUrl,
          ...(deletedSongPaths ? { deletedSongPaths } : {}),
        }));
      }

      const totalSongs = playlistData.reduce((sum, pl) => sum + pl.songs.length, 0);
      deps.log(`uploadPlaylists: 收集完成, 歌单=${playlistData.length}, 总歌曲=${totalSongs}`);

      const uploadResult = await fileSyncUpload(ciyuanxiId, playlistData);
      result.uploadedPlaylists = uploadResult.playlist_count;
      result.uploadedSongs = uploadResult.song_total;
      deps.log(`uploadPlaylists 完成: uploadedPlaylists=${result.uploadedPlaylists}, uploadedSongs=${result.uploadedSongs}`);

      const written = applyUploadIdMap(uploadResult.id_map, collections.setPlaylistCloudId);
      if (uploadResult.id_map?.length) {
        deps.log(`uploadPlaylists: 已写回 ${written}/${uploadResult.id_map.length} 个歌单的云端 id`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      deps.logError(`uploadPlaylists 异常: ${msg}`, error);
      result.errors.push(`上传失败: ${msg}`);
    }

    return result;
  }

  async function downloadPlaylists(): Promise<SyncResult> {
    const result: SyncResult = {
      uploadedPlaylists: 0,
      downloadedPlaylists: 0,
      uploadedSongs: 0,
      downloadedSongs: 0,
      errors: [],
    };

    const ciyuanxiId = getCiyuanxiId();
    if (!ciyuanxiId) {
      deps.logError('downloadPlaylists: 未获取到弦予号，取消下载');
      result.errors.push('未登录或未获取到弦予号');
      return result;
    }

    deps.onProgress('正在从云端下载歌单...');

    try {
      const downloadData = await fileSyncDownload(ciyuanxiId);
      if (!downloadData || !downloadData.playlists || downloadData.playlists.length === 0) {
        deps.log('downloadPlaylists: 云端无歌单数据');
        return result;
      }

      deps.log(`downloadPlaylists: 云端共 ${downloadData.playlists.length} 个歌单, ${downloadData.stats?.song_total ?? 0} 首歌曲`);

      const matchIndex = buildLibraryMatchIndex(library.songList);

      for (let i = 0; i < downloadData.playlists.length; i++) {
        const cloudPl = downloadData.playlists[i];
        deps.log(`downloadPlaylists: [${i + 1}/${downloadData.playlists.length}] 处理歌单 "${cloudPl.name}" (songs=${cloudPl.songs?.length ?? 0})`);
        deps.onProgress(`正在下载歌单 (${i + 1}/${downloadData.playlists.length})：${cloudPl.name}`);

        const deletedPaths = new Set(cloudPl.deletedSongPaths ?? []);
        const songCloudId = cloudPl.cloudId || '';
        const songKeepMap = songCloudId ? getCloudKeepSongs(songCloudId) : {};
        const songPendingSet = songCloudId ? getPendingDeletedSongs(songCloudId) : new Set<string>();

        const cloudSongs = cloudPl.songs ?? [];

        const expandedDeleted = new Set(deletedPaths);
        if (deletedPaths.size > 0) {
          for (const raw of cloudSongs) {
            const p = (raw as any).path as string | undefined;
            if (p && deletedPaths.has(p)) {
              const restored = syncPayloadToSong(raw);
              expandedDeleted.add(resolveLocalPath(matchIndex, restored));
            }
          }
        }

        const visibleCloudSongs = cloudSongs.filter(raw => {
          const p = (raw as any).path as string | undefined;
          if (!p) return true;
          if (expandedDeleted.has(p) || songPendingSet.has(p)) return false;
          return songKeepMap[p] === undefined;
        });
        const localSongs = visibleCloudSongs.map(song => {
          const restored = syncPayloadToSong(song);
          const resolved = resolveLocalPath(matchIndex, restored);
          return resolved === restored.path ? restored : { ...restored, path: resolved };
        });

        const pathRemapFromCloud = new Map<string, string>();
        visibleCloudSongs.forEach((raw, i) => {
          const originalPath = (raw as any).path as string | undefined;
          const newPath = localSongs[i]?.path;
          if (originalPath && newPath && originalPath !== newPath) {
            pathRemapFromCloud.set(originalPath, newPath);
          }
        });

        const existing = collections.playlists.find(p => p.id === cloudPl.id);

        if (existing) {
          if (pathRemapFromCloud.size > 0) {
            existing.songPaths = existing.songPaths.map(p => pathRemapFromCloud.get(p) ?? p);
          }

          if (expandedDeleted.size > 0) {
            existing.songPaths = existing.songPaths.filter(p => !expandedDeleted.has(p));
            if (existing.songs?.length) {
              const kept = existing.songs.filter(s => !expandedDeleted.has(s.path));
              existing.songs = kept.length > 0 ? kept : undefined;
            }
          }

          const localSongPaths = new Set(existing.songPaths);
          const newPaths: string[] = [];

          for (const song of localSongs) {
            if (!localSongPaths.has(song.path)) {
              newPaths.push(song.path);
            }
          }

          existing.songPaths = [...existing.songPaths, ...newPaths];

          const existingSongPaths = new Set((existing.songs ?? []).map(s => s.path));
          const mergedSongs = [...(existing.songs ?? [])];
          for (const song of localSongs) {
            if (!existingSongPaths.has(song.path)) {
              mergedSongs.push(song);
              existingSongPaths.add(song.path);
            }
          }
          existing.songs = mergedSongs.length > 0 ? mergedSongs : undefined;
          for (const song of localSongs) {
            library.setExtraSong(song);
          }
          if (cloudPl.cloudCoverUrl) existing.cloudCoverUrl = cloudPl.cloudCoverUrl;
          if (cloudPl.sourcePluginId) existing.sourcePluginId = cloudPl.sourcePluginId;
          if (cloudPl.sourceUrl) existing.sourceUrl = cloudPl.sourceUrl;
          if (cloudPl.sourceRaw) existing.sourceRaw = cloudPl.sourceRaw;
          existing.isCloud = true;
          if (cloudPl.cloudId) existing.cloudId = cloudPl.cloudId;

          result.downloadedPlaylists++;
          result.downloadedSongs += localSongs.length;
          deps.log(`downloadPlaylists: 合并到已有歌单 "${cloudPl.name}", downloaded=${localSongs.length}`);
        } else {
          const allPaths = localSongs.map(s => s.path);

          const newPlaylist: Playlist = {
            id: cloudPl.id,
            name: cloudPl.name,
            songPaths: allPaths,
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

          collections.playlists.push(newPlaylist);
          for (const song of localSongs) {
            library.setExtraSong(song);
          }

          result.downloadedPlaylists++;
          result.downloadedSongs += localSongs.length;
          deps.log(`downloadPlaylists: 创建新歌单 "${cloudPl.name}", downloaded=${localSongs.length}`);
        }
      }

      deps.log(`downloadPlaylists 完成: downloadedPlaylists=${result.downloadedPlaylists}, downloadedSongs=${result.downloadedSongs}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      deps.logError(`downloadPlaylists 异常: ${msg}`, error);
      result.errors.push(`下载失败: ${msg}`);
    }

    return result;
  }

  async function deleteCloudPlaylistLocal(playlistId: string): Promise<boolean> {
    const ciyuanxiId = getCiyuanxiId();
    if (!ciyuanxiId) {
      deps.notify('请先登录', 'error');
      return false;
    }

    const playlist = collections.getPlaylistById(playlistId);
    if (!playlist?.cloudId) {
      deps.notify('该歌单未同步到云端', 'info');
      return false;
    }

    try {
      await deleteCloudPlaylist(ciyuanxiId, [playlist.cloudId]);
      clearPlaylistSongTombstones(playlist.cloudId);
      collections.setPlaylistCloudId(playlistId, '');
      deps.notify('已从云端删除歌单', 'success');
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      deps.notify(`删除云端歌单失败：${msg}`, 'error');
      return false;
    }
  }

  return {
    uploadPlaylists,
    downloadPlaylists,
    deleteCloudPlaylistLocal,
  };
}
