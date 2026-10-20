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
  computeSongHash,
  type FileSyncPlaylistData,
  type SyncResult,
} from '../playlistSync';
import { fileSyncV2DownloadOps, type LocalPlaylistReportPayload } from '../playlistSyncApi';
import {
  clearPlaylistSongTombstones,
  getCloudKeepSongs,
  getDownloadSkipPlaylistIds,
  getLocalOnlySongs,
  getPendingDeletedSongs,
  pruneCloudKeepSongs,
  pruneLocalOnlySongs,
  prunePendingDeletedSongs,
  removeDownloadSkipPlaylistIds,
} from '../playlistSongSyncState';
import type { ToastKind } from './toastKind';
import { buildLibraryMatchIndex, resolveLocalPath } from './libraryMatch';
import { applyUploadIdMap, buildPlaylistUploadItem } from './playlistSyncUploadPayload';
import { applySyncOps, type SyncOpsTarget } from './playlistOpsApply';

/**
 * v2 下载协议开关：true 走 file_sync_v2_download_ops（服务端 diff），
 * 回退改 false 即恢复 v1 全量快照下载，其余代码不变。
 */
const USE_SYNC_V2 = true;

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

  async function uploadPlaylists(options?: { overwrite?: boolean }): Promise<SyncResult> {
    // 覆盖上传（手动「同步至服务器」）：跳过墓碑/云端保留等合并裁剪，
    // 本地歌单全集即云端目标状态；自动同步不带 options，仍走合并对比
    const overwrite = options?.overwrite === true;
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
    // 覆盖上传不早退：本地为空也上传空快照（merge=false），即快捷清空云端歌单
    if (playlists.length === 0 && !overwrite) {
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
        if (pl.cloudId && !overwrite) {
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

      const uploadResult = await fileSyncUpload(ciyuanxiId, playlistData, { merge: !overwrite });
      result.uploadedPlaylists = uploadResult.playlist_count;
      result.uploadedSongs = uploadResult.song_total;
      deps.log(`uploadPlaylists 完成: uploadedPlaylists=${result.uploadedPlaylists}, uploadedSongs=${result.uploadedSongs}`);

      const written = applyUploadIdMap(uploadResult.id_map, collections.setPlaylistCloudId);
      if (uploadResult.id_map?.length) {
        deps.log(`uploadPlaylists: 已写回 ${written}/${uploadResult.id_map.length} 个歌单的云端 id`);
        // 重新上传视为用户要回该歌单，解除"仅删本地"的下载跳过
        const reUploaded = uploadResult.id_map
          .map(entry => entry.cloudId ?? '')
          .filter(Boolean);
        removeDownloadSkipPlaylistIds(reUploaded);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      deps.logError(`uploadPlaylists 异常: ${msg}`, error);
      result.errors.push(`上传失败: ${msg}`);
    }

    return result;
  }

  async function downloadPlaylists(options?: { overwrite?: boolean }): Promise<SyncResult> {
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
      if (options?.overwrite === true) {
        await downloadOverwriteSnapshot(ciyuanxiId, result);
      } else if (USE_SYNC_V2) {
        await downloadViaOps(ciyuanxiId, result);
      } else {
        await downloadViaSnapshot(ciyuanxiId, result);
      }
      deps.log(`downloadPlaylists 完成: downloadedPlaylists=${result.downloadedPlaylists}, downloadedSongs=${result.downloadedSongs}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      deps.logError(`downloadPlaylists 异常: ${msg}`, error);
      result.errors.push(`下载失败: ${msg}`);
    }

    return result;
  }

  /** v2 路径：上报本地歌单概要（song_hash），由服务端算 diff 下发最小 ops。 */
  async function downloadViaOps(ciyuanxiId: string, result: SyncResult): Promise<void> {
    const matchIndex = buildLibraryMatchIndex(library.songList);
    const localReports: LocalPlaylistReportPayload[] = collections.playlists.map(pl => {
      const songs = collectPlaylistSongs(pl);
      const createdMs = pl.createdAt ? new Date(pl.createdAt).getTime() : NaN;
      return {
        localId: pl.id,
        ...(pl.cloudId ? { cloudId: pl.cloudId } : {}),
        name: pl.name,
        cloudCoverUrl: pl.cloudCoverUrl || '',
        isFavorite: !!pl.isFavorite,
        ...(Number.isFinite(createdMs) ? { createdAt: createdMs } : {}),
        ...(pl.sourcePluginId ? { sourcePluginId: pl.sourcePluginId } : {}),
        ...(pl.sourceUrl ? { sourceUrl: pl.sourceUrl } : {}),
        song_hashes: songs.map(computeSongHash),
      };
    });

    const data = await fileSyncV2DownloadOps(ciyuanxiId, localReports);
    // 云端删除广播：其他端「删除全部/删除云端」的歌单按 cloudId 真删本地
    trimDeletedCloudPlaylists(data?.deleted_playlist_cloud_ids ?? []);
    const ops = data?.ops ?? [];
    if (ops.length === 0) {
      deps.log('downloadPlaylists(v2): 云端无变更');
      return;
    }

    // "仅删本地（云端保留）"的歌单：跳过 create，防止被同步拉回来
    const downloadSkip = getDownloadSkipPlaylistIds();
    const filteredOps = ops.filter(op => {
      if (op.type !== 'create_playlist') return true;
      const cid = op.playlist?.cloudId ?? '';
      return !cid || !downloadSkip.has(cid);
    });
    if (filteredOps.length === 0) {
      deps.log('downloadPlaylists(v2): 过滤下载跳过后无变更');
      return;
    }

    const target: SyncOpsTarget = {
      matchIndex,
      findByCloudId: cloudId => collections.playlists.find(p => p.cloudId === cloudId),
      findById: id => collections.playlists.find(p => p.id === id),
      isSongKept: (cloudId, path) => !!getCloudKeepSongs(cloudId)[path],
      isSongPendingDeleted: (cloudId, path) => getPendingDeletedSongs(cloudId).has(path),
      createPlaylist: pl => { collections.playlists.push(pl); },
      writePlaylist: (id, next) => {
        const pl = collections.playlists.find(p => p.id === id);
        if (!pl) return;
        pl.songPaths = next.songPaths;
        pl.songs = next.songs;
        const meta = next.meta;
        if (meta.cloudCoverUrl !== undefined) pl.cloudCoverUrl = meta.cloudCoverUrl;
        if (meta.sourcePluginId !== undefined) pl.sourcePluginId = meta.sourcePluginId;
        if (meta.sourceUrl !== undefined) pl.sourceUrl = meta.sourceUrl;
        if (meta.sourceRaw !== undefined) pl.sourceRaw = meta.sourceRaw;
        if (meta.cloudId !== undefined) pl.cloudId = meta.cloudId;
        if (meta.isCloud !== undefined) pl.isCloud = meta.isCloud;
      },
      setExtraSongs: songs => { for (const s of songs) library.setExtraSong(s); },
    };

    const outcome = applySyncOps(filteredOps, target);
    result.downloadedPlaylists = outcome.createdPlaylists + outcome.mergedPlaylists;
    result.downloadedSongs = outcome.addedSongs;
    deps.log(`downloadPlaylists(v2): created=${outcome.createdPlaylists}, merged=${outcome.mergedPlaylists}, added=${outcome.addedSongs}, removed=${outcome.removedSongs}`);
  }

  /** 云端删除广播裁剪：其他端「删除全部/删除云端」的歌单按 cloudId 真删本地。
   * 仅按 cloudId 匹配，无绑定的本地歌单不动（名字跨端不可靠，不作匹配依据）；
   * 裁剪后清该歌单遗留墓碑，并解除「删除本地（云端保留）」的下载跳过。 */
  function trimDeletedCloudPlaylists(cloudIds: string[]): void {
    const victims = new Set(cloudIds.filter(id => id.length > 0));
    if (victims.size === 0) return;
    // 云端已删：本机对应墓碑与下载跳过记录随之失效，无论本地是否存在都清掉
    for (const cid of victims) clearPlaylistSongTombstones(cid);
    removeDownloadSkipPlaylistIds(Array.from(victims));
    let removed = 0;
    for (let i = collections.playlists.length - 1; i >= 0; i--) {
      const cid = collections.playlists[i].cloudId ?? '';
      if (cid && victims.has(cid)) {
        collections.playlists.splice(i, 1);
        removed++;
      }
    }
    if (removed > 0) {
      deps.log(`downloadPlaylists: 按云端删除账本裁剪 ${removed} 个歌单`);
    }
  }

  /** v1 路径：全量快照下载 + 本地合并（回退开关用）。 */
  async function downloadViaSnapshot(ciyuanxiId: string, result: SyncResult): Promise<void> {
    const downloadData = await fileSyncDownload(ciyuanxiId);
    // 云端删除广播：其他端「删除全部/删除云端」的歌单按 cloudId 真删本地
    // （须在空歌单早退之前执行：快照可能只剩账本、playlists 为空）
    trimDeletedCloudPlaylists(downloadData?.deleted_playlist_cloud_ids ?? []);
    if (!downloadData || !downloadData.playlists || downloadData.playlists.length === 0) {
      deps.log('downloadPlaylists: 云端无歌单数据');
      return;
    }

    deps.log(`downloadPlaylists: 云端共 ${downloadData.playlists.length} 个歌单, ${downloadData.stats?.song_total ?? 0} 首歌曲`);

    const matchIndex = buildLibraryMatchIndex(library.songList);

    // 与 v2 一致："仅删本地"的歌单不再从云端拉回
    const downloadSkip = getDownloadSkipPlaylistIds();

    for (let i = 0; i < downloadData.playlists.length; i++) {
      const cloudPl = downloadData.playlists[i];
      if (cloudPl.cloudId && downloadSkip.has(cloudPl.cloudId)) {
        deps.log(`downloadPlaylists: 跳过 "${cloudPl.name}" - 处于仅删本地墓碑中`);
        continue;
      }
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
  }

  /** 覆盖下载（手动「更新至本地」）：云端快照全量替换本地歌单。
   * 不走 v2 diff、不应用墓碑/删除账本，本地独有歌单将被移除；
   * 被替换歌单的 tombstone 随之清除，避免下次上传把覆盖前的删除重放到云端。 */
  async function downloadOverwriteSnapshot(ciyuanxiId: string, result: SyncResult): Promise<void> {
    const downloadData = await fileSyncDownload(ciyuanxiId);
    const cloudPlaylists = downloadData?.playlists ?? [];
    if (cloudPlaylists.length === 0) {
      deps.log('downloadPlaylists(overwrite): 云端无歌单数据');
      return;
    }
    deps.log(`downloadPlaylists(overwrite): 云端共 ${cloudPlaylists.length} 个歌单, ${downloadData?.stats?.song_total ?? 0} 首歌曲`);
    const matchIndex = buildLibraryMatchIndex(library.songList);

    // 本地歌单整体被替换：旧歌单的墓碑与下载跳过记录全部失效，一并清空
    const staleCloudIds = collections.playlists
      .map(pl => pl.cloudId ?? '')
      .filter(Boolean);
    for (const cid of staleCloudIds) clearPlaylistSongTombstones(cid);
    removeDownloadSkipPlaylistIds(staleCloudIds);

    const rebuilt: Playlist[] = [];
    for (let i = 0; i < cloudPlaylists.length; i++) {
      const cloudPl = cloudPlaylists[i];
      deps.onProgress(`正在下载歌单 (${i + 1}/${cloudPlaylists.length})：${cloudPl.name}`);
      const deletedPaths = new Set(cloudPl.deletedSongPaths ?? []);
      const localSongs = (cloudPl.songs ?? [])
        .filter(raw => {
          const p = (raw as any).path as string | undefined;
          return !p || !deletedPaths.has(p);
        })
        .map(raw => {
          const restored = syncPayloadToSong(raw);
          const resolved = resolveLocalPath(matchIndex, restored);
          return resolved === restored.path ? restored : { ...restored, path: resolved };
        });
      rebuilt.push({
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
      });
      for (const song of localSongs) {
        library.setExtraSong(song);
      }
      result.downloadedPlaylists++;
      result.downloadedSongs += localSongs.length;
    }
    collections.playlists.splice(0, collections.playlists.length, ...rebuilt);
    deps.log(`downloadPlaylists(overwrite): 已用云端快照替换本地歌单 ${rebuilt.length} 个`);
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
