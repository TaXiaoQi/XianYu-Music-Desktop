import type { Song } from '../../../types';
import { downloadFavorites, uploadFavorites } from '../favoritesSync';
import { getCiyuanxiId } from '../playlistSyncSong';
import {
  getCloudKeepPaths,
  getLocalOnlyPaths,
  loadSyncedFavoritePaths,
  persistSyncedFavoritePaths,
  removeCloudKeepPaths,
  removeLocalOnlyPaths,
} from '../favoritesSyncState';
import type { SyncResult } from '../playlistSync';
import type { ToastKind } from './toastKind';
import { buildLibraryMatchIndex, resolveLocalPath } from './libraryMatch';

// ==================== 端口（由 UI 层注入 store 实例与状态） ====================

export interface FavoritesSyncCollectionsPort {
  favoritePaths: string[];
  favoriteSongMeta: Record<string, Song>;
  setFavoritePaths(paths: string[]): void;
  setFavoriteSongMetaMap(map: Record<string, Song>): void;
}

export interface FavoritesSyncLibraryPort {
  songList: Song[];
  songLookup: Map<string, Song>;
}

export interface FavoritesSyncFlowDeps {
  canSync(): boolean;
  isUploadEnabled(): boolean;
  collections: FavoritesSyncCollectionsPort;
  library: FavoritesSyncLibraryPort;
  onProgress(msg: string): void;
  notify(msg: string, kind: ToastKind): void;
  setSyncing(v: boolean): void;
  setLastResult(result: SyncResult | null): void;
  setLastTime(time: number): void;
  log(msg: string, ...args: unknown[]): void;
  logError(msg: string, ...args: unknown[]): void;
}

// ==================== 流程（业务决策与 IO，UI 状态经端口写入） ====================

export function createFavoritesSyncFlow(deps: FavoritesSyncFlowDeps) {
  const { collections, library } = deps;

  function collectFavoriteSongs(): Song[] {
    const lookup = library.songLookup;
    return collections.favoritePaths
      .map(path => lookup.get(path) || collections.favoriteSongMeta[path])
      .filter((song): song is Song => !!song);
  }

  async function uploadFavoritesOnly(): Promise<void> {
    deps.log('========== uploadFavoritesOnly 开始 ==========');
    if (!deps.canSync()) {
      deps.logError('uploadFavoritesOnly: 未登录或无弦予号');
      deps.notify('请先登录后再同步', 'error');
      return;
    }

    if (!deps.isUploadEnabled()) {
      deps.log('uploadFavoritesOnly: 收藏上传未开启');
      deps.notify('收藏同步已关闭，请在设置中开启', 'info');
      return;
    }

    deps.setSyncing(true);
    deps.onProgress('正在上传收藏到云端...');

    try {
      const songs = collectFavoriteSongs();
      const ciyuanxiId = getCiyuanxiId();
      if (!ciyuanxiId) {
        deps.notify('未获取到弦予号', 'error');
        return;
      }
      if (songs.length === 0) {
        deps.log('uploadFavoritesOnly: 本地收藏为空，跳过上传');
        deps.notify('本地收藏为空，跳过上传', 'info');
        return;
      }
      const localOnly = getLocalOnlyPaths();
      const payload = songs.filter(s => !localOnly.has(s.path));
      const currentPaths = new Set(songs.map(s => s.path));
      removeLocalOnlyPaths(Array.from(localOnly).filter(p => !currentPaths.has(p)));
      const cloudKeep = getCloudKeepPaths();
      removeCloudKeepPaths(Array.from(cloudKeep).filter(p => currentPaths.has(p)));
      const result = await uploadFavorites(ciyuanxiId, payload, {
        deletePaths: loadSyncedFavoritePaths().filter(p => !currentPaths.has(p) && !cloudKeep.has(p)),
      });
      persistSyncedFavoritePaths(songs.map(s => s.path));
      deps.setLastTime(Date.now());
      deps.setLastResult({
        uploadedPlaylists: 0,
        downloadedPlaylists: 0,
        uploadedSongs: result.song_count,
        downloadedSongs: 0,
        errors: [],
      });
      deps.log(`uploadFavoritesOnly 完成: uploaded=${result.song_count}`);
      deps.notify(result.song_count > 0 ? `已上传 ${result.song_count} 首收藏歌曲` : '收藏已是最新', 'success');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      deps.logError(`uploadFavoritesOnly 异常: ${msg}`, error);
      deps.notify(`收藏上传失败：${msg}`, 'error');
    } finally {
      deps.setSyncing(false);
      deps.onProgress('');
    }
  }

  async function downloadFavoritesOnly(): Promise<void> {
    deps.log('========== downloadFavoritesOnly 开始 ==========');
    if (!deps.canSync()) {
      deps.logError('downloadFavoritesOnly: 未登录或无弦予号');
      deps.notify('请先登录后再同步', 'error');
      return;
    }

    deps.setSyncing(true);
    deps.onProgress('正在从云端下载收藏...');

    try {
      const ciyuanxiId = getCiyuanxiId();
      if (!ciyuanxiId) {
        deps.notify('未获取到弦予号', 'error');
        return;
      }
      const offlineList = await downloadFavorites(ciyuanxiId);
      const count = offlineList.length;

      const matchIndex = buildLibraryMatchIndex(library.songList);
      const matchedList = offlineList.map(song => {
        const resolved = resolveLocalPath(matchIndex, song);
        return resolved === song.path ? song : { ...song, path: resolved };
      });

      const cloudKeep = getCloudKeepPaths();
      const lookup = library.songLookup;
      const existingPaths = new Set(collections.favoritePaths);
      const mergedPaths = [...collections.favoritePaths];
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
      collections.setFavoritePaths(mergedPaths);
      if (Object.keys(metaMap).length > 0) {
        collections.setFavoriteSongMetaMap(metaMap);
      }

      deps.setLastTime(Date.now());
      deps.setLastResult({
        uploadedPlaylists: 0,
        downloadedPlaylists: 0,
        uploadedSongs: 0,
        downloadedSongs: count,
        errors: [],
      });
      deps.log(`downloadFavoritesOnly 完成: downloaded=${count}`);
      deps.notify(count > 0 ? `已下载 ${count} 首收藏歌曲` : '云端暂无收藏数据', 'success');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      deps.logError(`downloadFavoritesOnly 异常: ${msg}`, error);
      deps.notify(`收藏下载失败：${msg}`, 'error');
    } finally {
      deps.setSyncing(false);
      deps.onProgress('');
    }
  }

  async function syncFavorites(): Promise<void> {
    deps.log('========== syncFavorites 开始 ==========');
    if (!deps.canSync()) {
      deps.logError('syncFavorites: 未登录或无弦予号');
      deps.notify('请先登录后再同步', 'error');
      return;
    }

    deps.setSyncing(true);
    deps.onProgress('正在从云端下载收藏...');

    try {
      await downloadFavoritesOnly();
      deps.onProgress('正在上传收藏到云端...');
      await uploadFavoritesOnly();
    } finally {
      deps.setSyncing(false);
      deps.onProgress('');
    }
  }

  return {
    collectFavoriteSongs,
    uploadFavoritesOnly,
    downloadFavoritesOnly,
    syncFavorites,
  };
}
