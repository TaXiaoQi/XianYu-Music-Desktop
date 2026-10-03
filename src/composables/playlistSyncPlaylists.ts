import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import {
  classifySyncPlaylist,
  fileSyncDownload,
  fileSyncUpload,
  firstRemoteSongCover,
  getCiyuanxiId,
  songToSyncPayload,
  syncPayloadToSong,
  type FileSyncPlaylistData,
  type SyncResult,
} from '../services/domain/playlistSync';
import { signedRequest } from '../services/auth/authService';
import { readImageBase64 } from '../services/tauri/pluginApi';
import {
  getCloudKeepSongs,
  pruneCloudKeepSongs,
  getLocalOnlySongs,
  pruneLocalOnlySongs,
  getPendingDeletedSongs,
  prunePendingDeletedSongs,
} from '../services/domain/playlistSongSyncState';
import {
  lastSyncResult,
  lastSyncTime,
  syncProgress,
  syncing,
} from './playlistSyncState';
import { buildLibraryMatchIndex, resolveLocalPath } from './playlistSyncLibrary';
import type { Playlist, Song } from '../types';

export interface PlaylistSyncCoordinatorDeps {
  collectionsStore: ReturnType<typeof useCollectionsStore>;
  libraryStore: ReturnType<typeof useLibraryStore>;
  canSync: () => boolean;
  isUploadEnabled: () => boolean;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  logSync: (message: string, ...args: unknown[]) => void;
  logSyncError: (message: string, ...args: unknown[]) => void;
}

export function createPlaylistSyncCoordinator({
  collectionsStore,
  libraryStore,
  canSync,
  isUploadEnabled,
  showToast,
  logSync,
  logSyncError,
}: PlaylistSyncCoordinatorDeps) {
function collectPlaylistSongs(playlist: Playlist): Song[] {
  const songs: Song[] = [];

  if (playlist.songs && playlist.songs.length > 0) {
    songs.push(...playlist.songs);
  }

  const songMap = new Map<string, Song>();
  libraryStore.songList.forEach(song => songMap.set(song.path, song));
  for (const path of playlist.songPaths) {
    const song = songMap.get(path);
    if (song && !songs.some(s => s.path === song.path)) {
      songs.push(song);
    }
  }

  logSync(`collectPlaylistSongs: playlist="${playlist.name}", songPaths=${playlist.songPaths.length}, songs.meta=${playlist.songs?.length ?? 0}, collected=${songs.length}`);
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
    logSyncError('uploadPlaylists: 未获取到弦予号，取消上传');
    result.errors.push('未登录或未获取到弦予号');
    return result;
  }

  const playlists = [...collectionsStore.playlists];
  logSync(`uploadPlaylists: 共 ${playlists.length} 个本地歌单待上传`);
  playlists.forEach((pl, idx) => {
    logSync(`  本地歌单[${idx}]: name="${pl.name}", id=${pl.id}, cloudId=${pl.cloudId ?? 'none'}, songPaths=${pl.songPaths.length}, songs.meta=${pl.songs?.length ?? 0}`);
  });
  if (playlists.length === 0) {
    logSync('uploadPlaylists: 无歌单，直接返回');
    return result;
  }

  syncProgress.value = '正在上传歌单到云端...';

  try {
    const playlistData: FileSyncPlaylistData[] = [];
    for (const pl of playlists) {
      const songs = collectPlaylistSongs(pl);
      const cloudCoverUrl = await resolvePlaylistCloudCover(pl, songs);
      if (cloudCoverUrl && cloudCoverUrl !== pl.cloudCoverUrl) {
        collectionsStore.setPlaylistCloudCoverUrl(pl.id, cloudCoverUrl);
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
      playlistData.push({
        id: pl.id,
        name: pl.name,
        type: classifySyncPlaylist(songs),
        cloudId: pl.cloudId,
        cloudCoverUrl,
        isFavorite: pl.isFavorite,
        createdAt: pl.createdAt,
        songs: payloadSongs,
        ...(pl.sourcePluginId ? { sourcePluginId: pl.sourcePluginId } : {}),
        ...(pl.sourceUrl ? { sourceUrl: pl.sourceUrl } : {}),
        ...(pl.sourceRaw ? { sourceRaw: pl.sourceRaw } : {}),
        ...(deletedSongPaths ? { deletedSongPaths } : {}),
      });
    }

    const totalSongs = playlistData.reduce((sum, pl) => sum + pl.songs.length, 0);
    logSync(`uploadPlaylists: 收集完成, 歌单=${playlistData.length}, 总歌曲=${totalSongs}`);

    const uploadResult = await fileSyncUpload(ciyuanxiId, playlistData);
    result.uploadedPlaylists = uploadResult.playlist_count;
    result.uploadedSongs = uploadResult.song_total;
    logSync(`uploadPlaylists 完成: uploadedPlaylists=${result.uploadedPlaylists}, uploadedSongs=${result.uploadedSongs}`);

    if (uploadResult.id_map?.length) {
      let written = 0;
      for (const { id, cloudId } of uploadResult.id_map) {
        if (id && cloudId && collectionsStore.setPlaylistCloudId(id, cloudId)) {
          written++;
        }
      }
      logSync(`uploadPlaylists: 已写回 ${written}/${uploadResult.id_map.length} 个歌单的云端 id`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logSyncError(`uploadPlaylists 异常: ${msg}`, error);
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
    logSyncError('downloadPlaylists: 未获取到弦予号，取消下载');
    result.errors.push('未登录或未获取到弦予号');
    return result;
  }

  syncProgress.value = '正在从云端下载歌单...';

  try {
    const downloadData = await fileSyncDownload(ciyuanxiId);
    if (!downloadData || !downloadData.playlists || downloadData.playlists.length === 0) {
      logSync('downloadPlaylists: 云端无歌单数据');
      return result;
    }

    logSync(`downloadPlaylists: 云端共 ${downloadData.playlists.length} 个歌单, ${downloadData.stats?.song_total ?? 0} 首歌曲`);

    const matchIndex = buildLibraryMatchIndex(libraryStore.songList);

    for (let i = 0; i < downloadData.playlists.length; i++) {
      const cloudPl = downloadData.playlists[i];
      logSync(`downloadPlaylists: [${i + 1}/${downloadData.playlists.length}] 处理歌单 "${cloudPl.name}" (songs=${cloudPl.songs?.length ?? 0})`);
      syncProgress.value = `正在下载歌单 (${i + 1}/${downloadData.playlists.length})：${cloudPl.name}`;

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

      const existing = collectionsStore.playlists.find(p => p.id === cloudPl.id);

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
          libraryStore.setExtraSong(song);
        }
        if (cloudPl.cloudCoverUrl) existing.cloudCoverUrl = cloudPl.cloudCoverUrl;
        if (cloudPl.sourcePluginId) existing.sourcePluginId = cloudPl.sourcePluginId;
        if (cloudPl.sourceUrl) existing.sourceUrl = cloudPl.sourceUrl;
        if (cloudPl.sourceRaw) existing.sourceRaw = cloudPl.sourceRaw;
        existing.isCloud = true;
        if (cloudPl.cloudId) existing.cloudId = cloudPl.cloudId;

        result.downloadedPlaylists++;
        result.downloadedSongs += localSongs.length;
        logSync(`downloadPlaylists: 合并到已有歌单 "${cloudPl.name}", downloaded=${localSongs.length}`);
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

        collectionsStore.playlists.push(newPlaylist);
        for (const song of localSongs) {
          libraryStore.setExtraSong(song);
        }

        result.downloadedPlaylists++;
        result.downloadedSongs += localSongs.length;
        logSync(`downloadPlaylists: 创建新歌单 "${cloudPl.name}", downloaded=${localSongs.length}`);
      }
    }

    logSync(`downloadPlaylists 完成: downloadedPlaylists=${result.downloadedPlaylists}, downloadedSongs=${result.downloadedSongs}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logSyncError(`downloadPlaylists 异常: ${msg}`, error);
    result.errors.push(`下载失败: ${msg}`);
  }

  return result;
}

async function syncPlaylists(): Promise<SyncResult> {
  logSync('========== syncPlaylists 开始 ==========');
  if (!canSync()) {
    logSyncError('syncPlaylists: 未登录或无弦予号，取消同步');
    showToast('请先登录后再同步', 'error');
    return {
      uploadedPlaylists: 0,
      downloadedPlaylists: 0,
      uploadedSongs: 0,
      downloadedSongs: 0,
      errors: ['未登录'],
    };
  }

  syncing.value = true;
  syncProgress.value = '正在同步歌单...';
  lastSyncResult.value = null;

  try {
    let uploadResult: SyncResult = {
      uploadedPlaylists: 0,
      downloadedPlaylists: 0,
      uploadedSongs: 0,
      downloadedSongs: 0,
      errors: [],
    };

    if (isUploadEnabled()) {
      logSync('syncPlaylists: 步骤 1/2 - 开始上传');
      syncProgress.value = '正在上传本地歌单到云端...';
      uploadResult = await uploadPlaylists();
      logSync('syncPlaylists: 步骤 1/2 - 上传完成', uploadResult);
    } else {
      logSync('syncPlaylists: 步骤 1/2 - 上传未开启，跳过');
    }

    logSync('syncPlaylists: 步骤 2/2 - 开始下载');
    syncProgress.value = '正在从云端拉取歌单...';
    const downloadResult = await downloadPlaylists();
    logSync('syncPlaylists: 步骤 2/2 - 下载完成', downloadResult);

    const combined: SyncResult = {
      uploadedPlaylists: uploadResult.uploadedPlaylists,
      downloadedPlaylists: downloadResult.downloadedPlaylists,
      uploadedSongs: uploadResult.uploadedSongs,
      downloadedSongs: downloadResult.downloadedSongs,
      errors: [...uploadResult.errors, ...downloadResult.errors],
    };

    lastSyncResult.value = combined;
    lastSyncTime.value = Date.now();

    logSync(`syncPlaylists 完成: uploaded=${combined.uploadedPlaylists}歌单/${combined.uploadedSongs}歌, downloaded=${combined.downloadedPlaylists}歌单/${combined.downloadedSongs}歌, errors=${combined.errors.length}`);
    if (combined.errors.length > 0) {
      combined.errors.forEach((err, idx) => logSyncError(`syncPlaylists error[${idx}]: ${err}`));
    }

    if (combined.errors.length > 0) {
      showToast(`歌单同步完成（${combined.errors.length} 个错误）`, 'error');
    } else {
      const parts: string[] = [];
      if (combined.uploadedPlaylists > 0) parts.push(`上传 ${combined.uploadedPlaylists} 个歌单`);
      if (combined.downloadedPlaylists > 0) parts.push(`下载 ${combined.downloadedPlaylists} 个歌单`);
      showToast(parts.length > 0 ? `歌单同步完成：${parts.join('，')}` : '歌单已是最新', 'success');
    }

    logSync('========== syncPlaylists 结束 ==========');
    return combined;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logSyncError(`syncPlaylists 异常: ${msg}`, error);
    showToast(`歌单同步失败：${msg}`, 'error');
    return {
      uploadedPlaylists: 0,
      downloadedPlaylists: 0,
      uploadedSongs: 0,
      downloadedSongs: 0,
      errors: [msg],
    };
  } finally {
    logSync('syncPlaylists: finally 块执行, 重置 syncing/syncProgress');
    syncing.value = false;
    syncProgress.value = '';
  }
}

  return {
    uploadPlaylists,
    downloadPlaylists,
    syncPlaylists,
  };
}
