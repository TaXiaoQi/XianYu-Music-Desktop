import type { Song } from '../../../types';
import { downloadFavoritesWithLedger, uploadFavorites } from '../favoritesSync';
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

interface FavoritesSyncCollectionsPort {
  favoritePaths: string[];
  favoriteSongMeta: Record<string, Song>;
  setFavoritePaths(paths: string[]): void;
  setFavoriteSongMetaMap(map: Record<string, Song>): void;
}

interface FavoritesSyncLibraryPort {
  songList: Song[];
  songLookup: Map<string, Song>;
  setExtraSongs(songs: Song[]): void;
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

  async function uploadFavoritesOnly(options?: { overwrite?: boolean }): Promise<void> {
    // 覆盖上传（手动「同步至服务器」）：本地收藏全集即云端目标状态，
    // 忽略「仅保留本地」墓碑，清掉墓碑缓存；自动同步不带 options，仍走合并
    const overwrite = options?.overwrite === true;
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
      if (songs.length === 0 && !overwrite) {
        deps.log('uploadFavoritesOnly: 本地收藏为空，跳过上传');
        deps.notify('本地收藏为空，跳过上传', 'info');
        return;
      }
      if (overwrite) {
        // 覆盖上传：本地收藏全集（可为空，空即清空云端收藏）替换云端
        removeLocalOnlyPaths(Array.from(getLocalOnlyPaths()));
        removeCloudKeepPaths(Array.from(getCloudKeepPaths()));
        const result = await uploadFavorites(ciyuanxiId, songs, { merge: false });
        persistSyncedFavoritePaths(songs.map(s => s.path));
        deps.setLastTime(Date.now());
        deps.setLastResult({
          uploadedPlaylists: 0,
          downloadedPlaylists: 0,
          uploadedSongs: result.song_count,
          downloadedSongs: 0,
          errors: [],
        });
        deps.log(`uploadFavoritesOnly(overwrite) 完成: uploaded=${result.song_count}`);
        deps.notify(`已覆盖上传 ${result.song_count} 首收藏歌曲`, 'success');
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

  async function downloadFavoritesOnly(options?: { overwrite?: boolean }): Promise<void> {
    // 覆盖下载（手动「更新至本地」）：云端收藏全集替换本地，不应用删除账本与墓碑；
    // 云端为空时结果即本地清空。自动同步不带 options，仍走合并
    const overwrite = options?.overwrite === true;
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
      const { songs: offlineList, deletedPaths } = await downloadFavoritesWithLedger(ciyuanxiId);

      // 云端删除广播裁剪：其他端「删除全部/删除云端」的收藏真删本地；
      // 「仅保留本地」墓碑中的路径是本机故意留下的，跳过。同时从已同步
      // 集合移除，避免下次上传把删除重推导一遍。
      // （覆盖下载不裁剪：云端收藏即本地目标状态，账本无意义）
      if (!overwrite && deletedPaths.length > 0) {
        const localOnly = getLocalOnlyPaths();
        const victims = deletedPaths.filter(p => !localOnly.has(p));
        if (victims.length > 0) {
          const victimSet = new Set(victims);
          collections.setFavoritePaths(collections.favoritePaths.filter(p => !victimSet.has(p)));
          const nextMeta: Record<string, Song> = {};
          for (const [p, meta] of Object.entries(collections.favoriteSongMeta)) {
            if (!victimSet.has(p)) nextMeta[p] = meta;
          }
          collections.setFavoriteSongMetaMap(nextMeta);
          persistSyncedFavoritePaths(loadSyncedFavoritePaths().filter(p => !victimSet.has(p)));
          deps.log(`downloadFavoritesOnly: 按云端删除账本裁剪 ${victims.length} 首收藏`);
        }
      }

      const matchIndex = buildLibraryMatchIndex(library.songList);
      const matchedList = offlineList.map(song => {
        const resolved = resolveLocalPath(matchIndex, song);
        return resolved === song.path ? song : { ...song, path: resolved };
      });

      if (overwrite) {
        // 覆盖下载：云端收藏全集替换本地，墓碑缓存一并清空
        removeLocalOnlyPaths(Array.from(getLocalOnlyPaths()));
        removeCloudKeepPaths(Array.from(getCloudKeepPaths()));
        const lookup = library.songLookup;
        const metaMap: Record<string, Song> = {};
        const extraSongs: Song[] = [];
        for (const song of matchedList) {
          if (!lookup.has(song.path)) {
            metaMap[song.path] = song;
            extraSongs.push(song);
          }
        }
        collections.setFavoritePaths(matchedList.map(s => s.path));
        collections.setFavoriteSongMetaMap(metaMap);
        // 不在曲库的在线收藏需补挂进曲库索引，否则收藏页按索引解析时会被全部过滤显示 0 首。
        if (extraSongs.length > 0) {
          library.setExtraSongs(extraSongs);
        }
        persistSyncedFavoritePaths(matchedList.map(s => s.path));
        deps.setLastTime(Date.now());
        deps.setLastResult({
          uploadedPlaylists: 0,
          downloadedPlaylists: 0,
          uploadedSongs: 0,
          downloadedSongs: matchedList.length,
          errors: [],
        });
        deps.log(`downloadFavoritesOnly(overwrite) 完成: total=${matchedList.length}, cloud=${offlineList.length}`);
        deps.notify(matchedList.length > 0 ? `已覆盖下载 ${matchedList.length} 首收藏歌曲` : '云端暂无收藏，本地收藏已清空', 'success');
        return;
      }

      const cloudKeep = getCloudKeepPaths();
      const lookup = library.songLookup;
      const existingPaths = new Set(collections.favoritePaths);
      const mergedPaths = [...collections.favoritePaths];
      // 以现有元数据表为底合并，避免整体替换清掉既有在线收藏元数据。
      const metaMap: Record<string, Song> = { ...collections.favoriteSongMeta };
      const extraSongs: Song[] = [];
      // 统计实际新增数：云端原始条数含双端各自上传的同曲重复条目，
      // 直接展示会造成「本地 33 首却显示下载 64 首」的口径错位。
      let added = 0;
      for (const song of matchedList) {
        if (cloudKeep.has(song.path)) continue;
        if (existingPaths.has(song.path)) continue;
        existingPaths.add(song.path);
        mergedPaths.push(song.path);
        if (!lookup.has(song.path)) {
          metaMap[song.path] = song;
          extraSongs.push(song);
        }
        added++;
      }
      collections.setFavoritePaths(mergedPaths);
      collections.setFavoriteSongMetaMap(metaMap);
      // 不在曲库的在线收藏需补挂进曲库索引，否则收藏页按索引解析时会被全部过滤显示 0 首。
      if (extraSongs.length > 0) {
        library.setExtraSongs(extraSongs);
      }

      deps.setLastTime(Date.now());
      deps.setLastResult({
        uploadedPlaylists: 0,
        downloadedPlaylists: 0,
        uploadedSongs: 0,
        downloadedSongs: added,
        errors: [],
      });
      deps.log(`downloadFavoritesOnly 完成: added=${added}, cloud=${offlineList.length}`);
      deps.notify(added > 0 ? `已下载 ${added} 首收藏歌曲` : '收藏已是最新', 'success');
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
