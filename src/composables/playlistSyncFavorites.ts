import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import {
  uploadFavorites as uploadFavoritesToCloud,
  downloadFavorites as downloadFavoritesFromCloud,
} from '../services/domain/favoritesSync';
import {
  loadSyncedFavoritePaths,
  persistSyncedFavoritePaths,
  getCloudKeepPaths,
  removeCloudKeepPaths,
  getLocalOnlyPaths,
  removeLocalOnlyPaths,
} from '../services/domain/favoritesSyncState';
import {
  lastFavoritesSyncResult,
  lastFavoritesSyncTime,
  favoritesSyncProgress,
  favoritesSyncing,
} from './playlistSyncState';
import { buildLibraryMatchIndex, resolveLocalPath } from './playlistSyncLibrary';
import type { Song } from '../types';
import { getCiyuanxiId } from '../services/domain/playlistSync';
import { useToast } from './toast';

export interface FavoriteSyncCoordinatorDeps {
  collectionsStore: ReturnType<typeof useCollectionsStore>;
  libraryStore: ReturnType<typeof useLibraryStore>;
  canSync: () => boolean;
  isFavoritesUploadEnabled: () => boolean;
  showToast: ReturnType<typeof useToast>['showToast'];
  logSync: (message: string, ...args: unknown[]) => void;
  logSyncError: (message: string, ...args: unknown[]) => void;
}

export function createFavoriteSyncCoordinator({
  collectionsStore,
  libraryStore,
  canSync,
  isFavoritesUploadEnabled,
  showToast,
  logSync,
  logSyncError,
}: FavoriteSyncCoordinatorDeps) {
function collectFavoriteSongs(): Song[] {
  const lookup = libraryStore.songLookup;
  return collectionsStore.favoritePaths
    .map(path => lookup.get(path) || collectionsStore.favoriteSongMeta[path])
    .filter((song): song is Song => !!song);
}

async function uploadFavoritesOnly(): Promise<void> {
  logSync('========== uploadFavoritesOnly 开始 ==========');
  if (!canSync()) {
    logSyncError('uploadFavoritesOnly: 未登录或无弦予号');
    showToast('请先登录后再同步', 'error');
    return;
  }

  if (!isFavoritesUploadEnabled()) {
    logSync('uploadFavoritesOnly: 收藏上传未开启');
    showToast('收藏同步已关闭，请在设置中开启', 'info');
    return;
  }

  favoritesSyncing.value = true;
  favoritesSyncProgress.value = '正在上传收藏到云端...';

  try {
    const songs = collectFavoriteSongs();
    const ciyuanxiId = getCiyuanxiId();
    if (!ciyuanxiId) {
      showToast('未获取到弦予号', 'error');
      return;
    }
    if (songs.length === 0) {
      logSync('uploadFavoritesOnly: 本地收藏为空，跳过上传');
      showToast('本地收藏为空，跳过上传', 'info');
      return;
    }
    const localOnly = getLocalOnlyPaths();
    const payload = songs.filter(s => !localOnly.has(s.path));
    const currentPaths = new Set(songs.map(s => s.path));
    removeLocalOnlyPaths(Array.from(localOnly).filter(p => !currentPaths.has(p)));
    const cloudKeep = getCloudKeepPaths();
    removeCloudKeepPaths(Array.from(cloudKeep).filter(p => currentPaths.has(p)));
    const result = await uploadFavoritesToCloud(ciyuanxiId, payload, {
      deletePaths: loadSyncedFavoritePaths().filter(p => !currentPaths.has(p) && !cloudKeep.has(p)),
    });
    persistSyncedFavoritePaths(songs.map(s => s.path));
    lastFavoritesSyncTime.value = Date.now();
    lastFavoritesSyncResult.value = {
      uploadedPlaylists: 0,
      downloadedPlaylists: 0,
      uploadedSongs: result.song_count,
      downloadedSongs: 0,
      errors: [],
    };
    logSync(`uploadFavoritesOnly 完成: uploaded=${result.song_count}`);
    showToast(result.song_count > 0 ? `已上传 ${result.song_count} 首收藏歌曲` : '收藏已是最新', 'success');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logSyncError(`uploadFavoritesOnly 异常: ${msg}`, error);
    showToast(`收藏上传失败：${msg}`, 'error');
  } finally {
    favoritesSyncing.value = false;
    favoritesSyncProgress.value = '';
  }
}

async function downloadFavoritesOnly(): Promise<void> {
  logSync('========== downloadFavoritesOnly 开始 ==========');
  if (!canSync()) {
    logSyncError('downloadFavoritesOnly: 未登录或无弦予号');
    showToast('请先登录后再同步', 'error');
    return;
  }

  favoritesSyncing.value = true;
  favoritesSyncProgress.value = '正在从云端下载收藏...';

  try {
    const ciyuanxiId = getCiyuanxiId();
    if (!ciyuanxiId) {
      showToast('未获取到弦予号', 'error');
      return;
    }
    const offlineList = await downloadFavoritesFromCloud(ciyuanxiId);
    const count = offlineList.length;

    const matchIndex = buildLibraryMatchIndex(libraryStore.songList);
    const matchedList = offlineList.map(song => {
      const resolved = resolveLocalPath(matchIndex, song);
      return resolved === song.path ? song : { ...song, path: resolved };
    });

    const cloudKeep = getCloudKeepPaths();
    const lookup = libraryStore.songLookup;
    const existingPaths = new Set(collectionsStore.favoritePaths);
    const mergedPaths = [...collectionsStore.favoritePaths];
    const metaMap: Record<string, Song> = {};
    for (const song of matchedList) {
      if (cloudKeep.has(song.path)) continue;
      if (existingPaths.has(song.path)) continue;
      existingPaths.add(song.path);
      mergedPaths.push(song.path);
      if (!lookup.has(song.path)) {
        metaMap[song.path] = song;
      }
    }
    collectionsStore.setFavoritePaths(mergedPaths);
    if (Object.keys(metaMap).length > 0) {
      collectionsStore.setFavoriteSongMetaMap(metaMap);
    }

    lastFavoritesSyncTime.value = Date.now();
    lastFavoritesSyncResult.value = {
      uploadedPlaylists: 0,
      downloadedPlaylists: 0,
      uploadedSongs: 0,
      downloadedSongs: count,
      errors: [],
    };
    logSync(`downloadFavoritesOnly 完成: downloaded=${count}`);
    showToast(count > 0 ? `已下载 ${count} 首收藏歌曲` : '云端暂无收藏数据', 'success');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logSyncError(`downloadFavoritesOnly 异常: ${msg}`, error);
    showToast(`收藏下载失败：${msg}`, 'error');
  } finally {
    favoritesSyncing.value = false;
    favoritesSyncProgress.value = '';
  }
}

async function syncFavorites(): Promise<void> {
  logSync('========== syncFavorites 开始 ==========');
  if (!canSync()) {
    logSyncError('syncFavorites: 未登录或无弦予号');
    showToast('请先登录后再同步', 'error');
    return;
  }

  favoritesSyncing.value = true;
  favoritesSyncProgress.value = '正在从云端下载收藏...';

  try {
    await downloadFavoritesOnly();
    favoritesSyncProgress.value = '正在上传收藏到云端...';
    await uploadFavoritesOnly();
  } finally {
    favoritesSyncing.value = false;
    favoritesSyncProgress.value = '';
  }
}

  return {
    uploadFavoritesOnly,
    downloadFavoritesOnly,
    syncFavorites,
  };
}
