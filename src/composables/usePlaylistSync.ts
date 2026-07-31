/**
 * 歌单同步组合式函数
 *
 * 提供本地歌单与云端歌单之间的双向同步能力：
 * - `uploadPlaylists()`：将本地歌单上传到云端
 * - `downloadPlaylists()`：从云端拉取歌单到本地
 * - `syncPlaylists()`：双向同步（先上传后下载）
 *
 * 同步策略：
 * - 上传：本地歌单 → 云端。若本地歌单已有 cloudId 则增量同步歌曲，否则先创建云端歌单。
 * - 下载：云端歌单 → 本地。按 cloudId 匹配本地歌单，匹配不到则新建本地歌单。
 * - 歌曲以 song_hash 去重，云端已存在则跳过。
 */

import { ref } from 'vue';
import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import { useAuthStore } from '../features/auth/store';
import { useSettingsStore } from '../features/settings/store';
import { useToast } from './toast';
import {
  batchAddSongsToCloudPlaylist,
  cloudSongToSong,
  createCloudPlaylist,
  deleteCloudPlaylist,
  fileSyncDownload,
  fileSyncUpload,
  getCloudPlaylistDetail,
  getCiyuanxiId,
  songToCloudPayload,
  type CloudSong,
  type FileSyncPlaylistData,
  type SyncResult,
} from '../services/playlistSync';
import {
  uploadPlugins as uploadPluginsToCloud,
  downloadPlugins as downloadPluginsFromCloud,
  type PluginSyncResult,
} from '../services/pluginSync';
import type { Playlist, Song } from '../types';

export type SyncDirection = 'upload' | 'download' | 'sync';

/** 日志前缀，方便在控制台筛选歌单同步相关日志 */
const LOG = '[usePlaylistSync]';

function logSync(msg: string, ...args: unknown[]) {
  console.log(`${LOG} ${msg}`, ...args);
}

function logSyncError(msg: string, ...args: unknown[]) {
  console.error(`${LOG} ${msg}`, ...args);
}

export function usePlaylistSync() {
  const collectionsStore = useCollectionsStore();
  const libraryStore = useLibraryStore();
  const authStore = useAuthStore();
  const settingsStore = useSettingsStore();
  const { showToast } = useToast();

  const syncing = ref(false);
  const syncProgress = ref('');
  const lastSyncTime = ref<number | null>(null);
  const lastSyncResult = ref<SyncResult | null>(null);

  // 插件同步独立状态（与歌单同步分开）
  const pluginSyncing = ref(false);
  const pluginSyncProgress = ref('');
  const lastPluginSyncTime = ref<number | null>(null);
  const lastPluginSyncResult = ref<PluginSyncResult | null>(null);

  /** 检查是否可以同步（已登录 + 开启了歌单上传） */
  function canSync(): boolean {
    return authStore.isLoggedIn && !!authStore.user?.ciyuanxi_id;
  }

  /** 检查歌单上传是否在设置中启用 */
  function isUploadEnabled(): boolean {
    return settingsStore.settings.upload.playlists;
  }

  /** 检查插件上传是否在设置中启用 */
  function isPluginUploadEnabled(): boolean {
    return settingsStore.settings.upload.plugins;
  }

  /**
   * 收集歌单中的所有歌曲（合并本地库歌曲与在线歌曲元信息）
   */
  function collectPlaylistSongs(playlist: Playlist): Song[] {
    const songs: Song[] = [];

    // 1. 在线歌曲（songs 数组）
    if (playlist.songs && playlist.songs.length > 0) {
      songs.push(...playlist.songs);
    }

    // 2. 本地库歌曲（通过 songPaths 从 libraryStore 查找）
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

  /**
   * 上传单个歌单到云端
   */
  async function uploadSinglePlaylist(
    ciyuanxiId: string,
    playlist: Playlist,
  ): Promise<{ uploaded: number; created: boolean; error?: string }> {
    logSync(`uploadSinglePlaylist 开始: name="${playlist.name}", id=${playlist.id}, cloudId=${playlist.cloudId ?? 'none'}`);
    try {
      const songs = collectPlaylistSongs(playlist);
      const songPayloads = songs.map(songToCloudPayload);
      logSync(`uploadSinglePlaylist: songs=${songs.length}, payloads=${songPayloads.length}`);

      // 警告：歌单有 songPaths 但收集到 0 首歌曲，可能是 songs 元数据被清空且歌曲不在本地库
      if (songs.length === 0 && playlist.songPaths.length > 0) {
        logSyncError(`uploadSinglePlaylist: ⚠ 歌单 "${playlist.name}" 有 ${playlist.songPaths.length} 个 songPaths 但收集到 0 首歌曲！songs.meta=${playlist.songs?.length ?? 0}。可能原因： songs 元数据丢失且歌曲不在本地库中`);
      }

      // 已有 cloudId（且 > 0）：增量同步（只添加云端没有的歌曲）
      if (playlist.cloudId && playlist.cloudId > 0) {
        logSync(`uploadSinglePlaylist: 增量同步模式, cloudId=${playlist.cloudId}`);

        // 获取云端歌单详情，找出云端已有的歌曲 hash
        // 如果获取详情失败（超时、404 等），降级处理：
        //   - HTTP 404 等"歌单不存在"错误 → 重新创建云端歌单
        //   - 超时 / 网络错误 → 全量上传到现有 cloudId（服务器端按 song_hash 去重）
        let existingHashes = new Set<string>();
        let needRecreate = false;
        try {
          const detail = await getCloudPlaylistDetail(ciyuanxiId, playlist.cloudId);
          existingHashes = new Set(detail.songs.map(s => s.song_hash));
          logSync(`uploadSinglePlaylist: 云端已有 ${existingHashes.size} 首歌曲`);
        } catch (detailError) {
          const detailMsg = detailError instanceof Error ? detailError.message : String(detailError);
          logSyncError(`uploadSinglePlaylist: 获取云端歌单详情失败, cloudId=${playlist.cloudId}, error=${detailMsg}`, detailError);

          // 判断是否为"歌单不存在"类错误（404 / 非 JSON 响应 / WAF），需重新创建
          // 注意：超时/网络错误不算"不存在"，歌单可能仍在云端
          if (detailMsg.includes('404') || detailMsg.includes('非 JSON') || detailMsg.includes('WAF')) {
            logSync(`uploadSinglePlaylist: 云端歌单可能已被删除, 降级为重新创建云端歌单`);
            needRecreate = true;
          } else {
            // 超时或网络错误：跳过增量，全量上传到现有 cloudId
            logSync(`uploadSinglePlaylist: 获取详情失败但歌单可能仍存在, 降级为全量上传到 cloudId=${playlist.cloudId}`);
          }
        }

        if (needRecreate) {
          // 云端歌单不存在，重新创建
          logSync(`uploadSinglePlaylist: 重新创建云端歌单, name="${playlist.name}"`);
          const createResult = await createCloudPlaylist(
            ciyuanxiId,
            playlist.name,
            '',
            playlist.cloudCoverUrl || '',
          );
          const newCloudId = createResult.playlist_id;
          if (!newCloudId || newCloudId <= 0) {
            const errMsg = `歌单"${playlist.name}"重新创建云端歌单失败: 后端返回无效的 playlist_id=${newCloudId}`;
            logSyncError(`uploadSinglePlaylist: ${errMsg}`);
            return { uploaded: 0, created: false, error: errMsg };
          }
          logSync(`uploadSinglePlaylist: 新云端歌单已创建, cloudId=${newCloudId}（原 cloudId=${playlist.cloudId}）`);
          collectionsStore.setPlaylistCloudId(playlist.id, newCloudId);

          if (songPayloads.length > 0) {
            const result = await batchAddSongsToCloudPlaylist(
              ciyuanxiId,
              newCloudId,
              songPayloads,
            );
            logSync(`uploadSinglePlaylist 完成: 重新创建并上传, added=${result.added}, created=true`);
            return { uploaded: result.added, created: true };
          }
          logSync(`uploadSinglePlaylist 完成: 重新创建, 无歌曲, created=true`);
          return { uploaded: 0, created: true };
        }

        // 筛选出云端没有的歌曲（全量上传模式下 existingHashes 为空，即全部上传）
        const newPayloads = songPayloads.filter(p => !existingHashes.has(p.song_hash));
        logSync(`uploadSinglePlaylist: 需新增 ${newPayloads.length} 首歌曲`);

        if (newPayloads.length > 0) {
          const result = await batchAddSongsToCloudPlaylist(
            ciyuanxiId,
            playlist.cloudId,
            newPayloads,
          );
          logSync(`uploadSinglePlaylist 完成: added=${result.added}, created=false`);
          return { uploaded: result.added, created: false };
        }
        logSync(`uploadSinglePlaylist 完成: 无新歌曲需上传, created=false`);
        return { uploaded: 0, created: false };
      }

      // 没有 cloudId（或 cloudId 无效）：创建新云端歌单
      logSync(`uploadSinglePlaylist: 创建新云端歌单模式`);
      const createResult = await createCloudPlaylist(
        ciyuanxiId,
        playlist.name,
        '',
        playlist.cloudCoverUrl || '',
      );

      const cloudId = createResult.playlist_id;
      logSync(`uploadSinglePlaylist: createCloudPlaylist 返回:`, createResult);

      // 校验返回的 playlist_id 是否有效
      if (!cloudId || cloudId <= 0) {
        const errMsg = `歌单"${playlist.name}"创建云端歌单失败: 后端返回无效的 playlist_id=${cloudId}`;
        logSyncError(`uploadSinglePlaylist: ${errMsg}`);
        return { uploaded: 0, created: false, error: errMsg };
      }

      logSync(`uploadSinglePlaylist: 新云端歌单已创建, cloudId=${cloudId}`);
      collectionsStore.setPlaylistCloudId(playlist.id, cloudId);

      // 批量添加歌曲
      if (songPayloads.length > 0) {
        const result = await batchAddSongsToCloudPlaylist(
          ciyuanxiId,
          cloudId,
          songPayloads,
        );
        logSync(`uploadSinglePlaylist 完成: added=${result.added}, created=true`);
        return { uploaded: result.added, created: true };
      }
      logSync(`uploadSinglePlaylist 完成: 无歌曲, created=true`);
      return { uploaded: 0, created: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logSyncError(`uploadSinglePlaylist 异常: name="${playlist.name}", error=${msg}`, error);
      return { uploaded: 0, created: false, error: `歌单"${playlist.name}"同步失败: ${msg}` };
    }
  }

  /**
   * 上传所有本地歌单到云端（文件存储模式）
   * 一次性将所有歌单+歌曲打包分块上传到服务器文件存储，不经过数据库
   */
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
      // 收集所有歌单数据
      const playlistData: FileSyncPlaylistData[] = playlists.map(pl => ({
        id: pl.id,
        name: pl.name,
        cloudId: pl.cloudId,
        cloudCoverUrl: pl.cloudCoverUrl,
        isFavorite: pl.isFavorite,
        songs: collectPlaylistSongs(pl).map(songToCloudPayload),
      }));

      const totalSongs = playlistData.reduce((sum, pl) => sum + pl.songs.length, 0);
      logSync(`uploadPlaylists: 收集完成, 歌单=${playlistData.length}, 总歌曲=${totalSongs}`);

      // 文件存储上传：分块发送，服务器合并为 JSON 文件
      const uploadResult = await fileSyncUpload(ciyuanxiId, playlistData);
      result.uploadedPlaylists = uploadResult.playlist_count;
      result.uploadedSongs = uploadResult.song_total;
      logSync(`uploadPlaylists 完成: uploadedPlaylists=${result.uploadedPlaylists}, uploadedSongs=${result.uploadedSongs}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logSyncError(`uploadPlaylists 异常: ${msg}`, error);
      result.errors.push(`上传失败: ${msg}`);
    }

    return result;
  }

  /**
   * 下载单个云端歌单到本地
   */
  async function downloadSinglePlaylist(
    ciyuanxiId: string,
    cloudPlaylistId: number,
    cloudName: string,
  ): Promise<{ downloaded: number; created: boolean; error?: string }> {
    logSync(`downloadSinglePlaylist 开始: name="${cloudName}", cloudId=${cloudPlaylistId}`);
    try {
      const detail = await getCloudPlaylistDetail(ciyuanxiId, cloudPlaylistId);
      const cloudSongs: CloudSong[] = detail.songs;
      logSync(`downloadSinglePlaylist: 云端歌曲数=${cloudSongs.length}`);

      // 转换为本地 Song 对象
      const localSongs = cloudSongs.map(cloudSongToSong);

      // 尝试匹配本地歌单（通过 cloudId）
      const existing = collectionsStore.getPlaylistByCloudId(cloudPlaylistId);
      logSync(`downloadSinglePlaylist: 本地匹配结果=${existing ? `已有(id=${existing.id})` : '无'}`);

      if (existing) {
        // 已有本地歌单：合并歌曲列表
        // 注意：不能直接替换 existing.songs，否则当云端歌单为空时会清空本地歌曲元数据
        const localSongPaths = new Set(existing.songPaths);
        const onlineSongs: Song[] = [];
        const newPaths: string[] = [];

        for (const song of localSongs) {
          if (song.path.startsWith('cloud://') === false) {
            // 在线歌曲有有效 URL
            onlineSongs.push(song);
          }
          if (!localSongPaths.has(song.path)) {
            newPaths.push(song.path);
          }
        }

        logSync(`downloadSinglePlaylist: 合并到已有歌单, newPaths=${newPaths.length}, onlineSongs=${onlineSongs.length}, existingSongs=${existing.songs?.length ?? 0}`);

        // 更新本地歌单的歌曲路径
        existing.songPaths = [...existing.songPaths, ...newPaths];

        // 合并歌曲元数据：保留本地已有歌曲，添加新的在线歌曲
        // 这样即使云端歌单为空，也不会丢失本地歌曲元数据
        const existingSongPaths = new Set((existing.songs ?? []).map(s => s.path));
        const mergedSongs = [...(existing.songs ?? [])];
        for (const song of onlineSongs) {
          if (!existingSongPaths.has(song.path)) {
            mergedSongs.push(song);
            existingSongPaths.add(song.path);
          }
        }
        existing.songs = mergedSongs.length > 0 ? mergedSongs : undefined;
        existing.cloudCoverUrl = detail.playlist.cover_url || existing.cloudCoverUrl;

        logSync(`downloadSinglePlaylist 完成: downloaded=${localSongs.length}, created=false`);
        return { downloaded: localSongs.length, created: false };
      }

      // 没有本地歌单：创建新的
      const playlistId = Date.now().toString() + Math.random().toString().slice(2);
      const onlineSongs = localSongs.filter(s => !s.path.startsWith('cloud://'));
      const allPaths = localSongs.map(s => s.path);

      const newPlaylist: Playlist = {
        id: playlistId,
        name: cloudName,
        songPaths: allPaths,
        songs: onlineSongs.length > 0 ? onlineSongs : undefined,
        cloudId: cloudPlaylistId,
        cloudCoverUrl: detail.playlist.cover_url || '',
        isFavorite: detail.playlist.is_favorite === 1,
      };

      collectionsStore.playlists.push(newPlaylist);
      logSync(`downloadSinglePlaylist: 已创建新本地歌单 id=${playlistId}, paths=${allPaths.length}, onlineSongs=${onlineSongs.length}`);

      // 将在线歌曲元信息加入 libraryStore 的 extraSongPool
      for (const song of onlineSongs) {
        libraryStore.setExtraSong(song);
      }

      logSync(`downloadSinglePlaylist 完成: downloaded=${localSongs.length}, created=true`);
      return { downloaded: localSongs.length, created: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logSyncError(`downloadSinglePlaylist 异常: name="${cloudName}", error=${msg}`, error);
      return { downloaded: 0, created: false, error: `歌单"${cloudName}"下载失败: ${msg}` };
    }
  }

  /**
   * 从云端下载所有歌单到本地（文件存储模式）
   * 一次请求获取完整歌单数据，不经过数据库
   */
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

      for (let i = 0; i < downloadData.playlists.length; i++) {
        const cloudPl = downloadData.playlists[i];
        logSync(`downloadPlaylists: [${i + 1}/${downloadData.playlists.length}] 处理歌单 "${cloudPl.name}" (songs=${cloudPl.songs?.length ?? 0})`);
        syncProgress.value = `正在下载歌单 (${i + 1}/${downloadData.playlists.length})：${cloudPl.name}`;

        const cloudSongs: CloudSong[] = cloudPl.songs ?? [];
        const localSongs = cloudSongs.map(cloudSongToSong);

        // 尝试匹配本地歌单（通过原 id）
        const existing = collectionsStore.playlists.find(p => p.id === cloudPl.id);

        if (existing) {
          // 已有本地歌单：合并歌曲列表
          const localSongPaths = new Set(existing.songPaths);
          const onlineSongs: Song[] = [];
          const newPaths: string[] = [];

          for (const song of localSongs) {
            if (!song.path.startsWith('cloud://')) {
              onlineSongs.push(song);
            }
            if (!localSongPaths.has(song.path)) {
              newPaths.push(song.path);
            }
          }

          existing.songPaths = [...existing.songPaths, ...newPaths];

          const existingSongPaths = new Set((existing.songs ?? []).map(s => s.path));
          const mergedSongs = [...(existing.songs ?? [])];
          for (const song of onlineSongs) {
            if (!existingSongPaths.has(song.path)) {
              mergedSongs.push(song);
              existingSongPaths.add(song.path);
            }
          }
          existing.songs = mergedSongs.length > 0 ? mergedSongs : undefined;
          if (cloudPl.cloudCoverUrl) existing.cloudCoverUrl = cloudPl.cloudCoverUrl;

          result.downloadedPlaylists++;
          result.downloadedSongs += localSongs.length;
          logSync(`downloadPlaylists: 合并到已有歌单 "${cloudPl.name}", downloaded=${localSongs.length}`);
        } else {
          // 创建新本地歌单
          const onlineSongs = localSongs.filter(s => !s.path.startsWith('cloud://'));
          const allPaths = localSongs.map(s => s.path);

          const newPlaylist: Playlist = {
            id: cloudPl.id,
            name: cloudPl.name,
            songPaths: allPaths,
            songs: onlineSongs.length > 0 ? onlineSongs : undefined,
            cloudId: cloudPl.cloudId,
            cloudCoverUrl: cloudPl.cloudCoverUrl || '',
            isFavorite: cloudPl.isFavorite,
          };

          collectionsStore.playlists.push(newPlaylist);
          for (const song of onlineSongs) {
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

  /**
   * 双向同步歌单：先上传本地歌单，再下载云端歌单
   */
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
      // 第一步：上传
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

      // 第二步：下载
      logSync('syncPlaylists: 步骤 2/2 - 开始下载');
      syncProgress.value = '正在从云端拉取歌单...';
      const downloadResult = await downloadPlaylists();
      logSync('syncPlaylists: 步骤 2/2 - 下载完成', downloadResult);

      // 合并结果
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

  /**
   * 双向同步插件：先上传本地插件，再下载云端插件
   */
  async function syncPlugins(): Promise<PluginSyncResult> {
    logSync('========== syncPlugins 开始 ==========');
    if (!canSync()) {
      logSyncError('syncPlugins: 未登录或无弦予号，取消同步');
      showToast('请先登录后再同步', 'error');
      return { uploadedPlugins: 0, downloadedPlugins: 0, errors: ['未登录'] };
    }

    pluginSyncing.value = true;
    pluginSyncProgress.value = '正在同步插件...';
    lastPluginSyncResult.value = null;

    try {
      // 第一步：上传
      let uploadResult: PluginSyncResult = {
        uploadedPlugins: 0,
        downloadedPlugins: 0,
        errors: [],
      };
      if (isPluginUploadEnabled()) {
        logSync('syncPlugins: 步骤 1/2 - 开始上传插件');
        pluginSyncProgress.value = '正在上传插件到云端...';
        uploadResult = await uploadPluginsToCloud();
        logSync('syncPlugins: 步骤 1/2 - 上传插件完成', uploadResult);
      } else {
        logSync('syncPlugins: 步骤 1/2 - 插件上传未开启，跳过');
      }

      // 第二步：下载
      logSync('syncPlugins: 步骤 2/2 - 开始下载插件');
      pluginSyncProgress.value = '正在从云端恢复插件...';
      const downloadResult = await downloadPluginsFromCloud();
      logSync('syncPlugins: 步骤 2/2 - 下载插件完成', downloadResult);

      // 合并结果
      const combined: PluginSyncResult = {
        uploadedPlugins: uploadResult.uploadedPlugins,
        downloadedPlugins: downloadResult.downloadedPlugins,
        errors: [...uploadResult.errors, ...downloadResult.errors],
      };

      lastPluginSyncResult.value = combined;
      lastPluginSyncTime.value = Date.now();

      logSync(`syncPlugins 完成: uploaded=${combined.uploadedPlugins}, downloaded=${combined.downloadedPlugins}, errors=${combined.errors.length}`);
      if (combined.errors.length > 0) {
        combined.errors.forEach((err, idx) => logSyncError(`syncPlugins error[${idx}]: ${err}`));
      }

      if (combined.errors.length > 0) {
        showToast(`插件同步完成（${combined.errors.length} 个错误）`, 'error');
      } else {
        const parts: string[] = [];
        if (combined.uploadedPlugins > 0) parts.push(`上传 ${combined.uploadedPlugins} 个插件`);
        if (combined.downloadedPlugins > 0) parts.push(`恢复 ${combined.downloadedPlugins} 个插件`);
        showToast(parts.length > 0 ? `插件同步完成：${parts.join('，')}` : '插件已是最新', 'success');
      }

      logSync('========== syncPlugins 结束 ==========');
      return combined;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logSyncError(`syncPlugins 异常: ${msg}`, error);
      showToast(`插件同步失败：${msg}`, 'error');
      return { uploadedPlugins: 0, downloadedPlugins: 0, errors: [msg] };
    } finally {
      pluginSyncing.value = false;
      pluginSyncProgress.value = '';
    }
  }

  /**
   * 仅上传本地歌单
   */
  async function uploadOnly(): Promise<void> {
    logSync('========== uploadOnly 开始 ==========');
    if (!canSync()) {
      logSyncError('uploadOnly: 未登录或无弦予号');
      showToast('请先登录后再同步', 'error');
      return;
    }

    if (!isUploadEnabled()) {
      logSync('uploadOnly: 上传未开启');
      showToast('歌单同步已关闭，请在设置中开启', 'info');
      return;
    }

    syncing.value = true;
    syncProgress.value = '正在上传歌单到云端...';

    try {
      const result = await uploadPlaylists();
      lastSyncTime.value = Date.now();
      lastSyncResult.value = result;
      logSync(`uploadOnly 完成: uploadedPlaylists=${result.uploadedPlaylists}, uploadedSongs=${result.uploadedSongs}, errors=${result.errors.length}`);

      if (result.errors.length > 0) {
        showToast(`上传完成（${result.errors.length} 个错误）`, 'error');
      } else if (result.uploadedPlaylists > 0) {
        showToast(`已上传 ${result.uploadedPlaylists} 个歌单（${result.uploadedSongs} 首歌曲）`, 'success');
      } else {
        showToast('歌单已同步，无需上传', 'info');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logSyncError(`uploadOnly 异常: ${msg}`, error);
      showToast(`上传失败：${msg}`, 'error');
    } finally {
      logSync('uploadOnly: finally 块执行, 重置 syncing/syncProgress');
      syncing.value = false;
      syncProgress.value = '';
    }
  }

  /**
   * 仅下载云端歌单
   */
  async function downloadOnly(): Promise<void> {
    logSync('========== downloadOnly 开始 ==========');
    if (!canSync()) {
      logSyncError('downloadOnly: 未登录或无弦予号');
      showToast('请先登录后再同步', 'error');
      return;
    }

    syncing.value = true;
    syncProgress.value = '正在从云端下载歌单...';

    try {
      const result = await downloadPlaylists();
      lastSyncTime.value = Date.now();
      lastSyncResult.value = result;
      logSync(`downloadOnly 完成: downloadedPlaylists=${result.downloadedPlaylists}, downloadedSongs=${result.downloadedSongs}, errors=${result.errors.length}`);

      if (result.errors.length > 0) {
        showToast(`下载完成（${result.errors.length} 个错误）`, 'error');
      } else if (result.downloadedPlaylists > 0) {
        showToast(`已下载 ${result.downloadedPlaylists} 个歌单（${result.downloadedSongs} 首歌曲）`, 'success');
      } else {
        showToast('云端暂无歌单', 'info');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logSyncError(`downloadOnly 异常: ${msg}`, error);
      showToast(`下载失败：${msg}`, 'error');
    } finally {
      logSync('downloadOnly: finally 块执行, 重置 syncing/syncProgress');
      syncing.value = false;
      syncProgress.value = '';
    }
  }

  /**
   * 删除云端歌单（同时清除本地 cloudId 绑定）
   */
  async function deleteCloudPlaylistLocal(playlistId: string): Promise<boolean> {
    const ciyuanxiId = getCiyuanxiId();
    if (!ciyuanxiId) {
      showToast('请先登录', 'error');
      return false;
    }

    const playlist = collectionsStore.getPlaylistById(playlistId);
    if (!playlist?.cloudId) {
      showToast('该歌单未同步到云端', 'info');
      return false;
    }

    try {
      await deleteCloudPlaylist(ciyuanxiId, playlist.cloudId);
      collectionsStore.setPlaylistCloudId(playlistId, 0);
      showToast('已从云端删除歌单', 'success');
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      showToast(`删除云端歌单失败：${msg}`, 'error');
      return false;
    }
  }

  /**
   * 仅上传插件到云端
   */
  async function uploadPluginsOnly(): Promise<void> {
    logSync('========== uploadPluginsOnly 开始 ==========');
    if (!canSync()) {
      logSyncError('uploadPluginsOnly: 未登录或无弦予号');
      showToast('请先登录后再同步', 'error');
      return;
    }

    if (!isPluginUploadEnabled()) {
      logSync('uploadPluginsOnly: 插件上传未开启');
      showToast('插件同步已关闭，请在设置中开启', 'info');
      return;
    }

    pluginSyncing.value = true;
    pluginSyncProgress.value = '正在上传插件到云端...';

    try {
      const result = await uploadPluginsToCloud();
      lastPluginSyncTime.value = Date.now();
      lastPluginSyncResult.value = result;
      logSync(`uploadPluginsOnly 完成: uploadedPlugins=${result.uploadedPlugins}, errors=${result.errors.length}`);

      if (result.errors.length > 0) {
        showToast(`插件上传完成（${result.errors.length} 个错误）`, 'error');
      } else if (result.uploadedPlugins > 0) {
        showToast(`已上传 ${result.uploadedPlugins} 个插件`, 'success');
      } else {
        showToast('插件已同步，无需上传', 'info');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logSyncError(`uploadPluginsOnly 异常: ${msg}`, error);
      showToast(`插件上传失败：${msg}`, 'error');
    } finally {
      pluginSyncing.value = false;
      pluginSyncProgress.value = '';
    }
  }

  /**
   * 仅从云端下载插件
   */
  async function downloadPluginsOnly(): Promise<void> {
    logSync('========== downloadPluginsOnly 开始 ==========');
    if (!canSync()) {
      logSyncError('downloadPluginsOnly: 未登录或无弦予号');
      showToast('请先登录后再同步', 'error');
      return;
    }

    pluginSyncing.value = true;
    pluginSyncProgress.value = '正在从云端下载插件...';

    try {
      const result = await downloadPluginsFromCloud();
      lastPluginSyncTime.value = Date.now();
      lastPluginSyncResult.value = result;
      logSync(`downloadPluginsOnly 完成: downloadedPlugins=${result.downloadedPlugins}, errors=${result.errors.length}`);

      if (result.errors.length > 0) {
        showToast(`插件下载完成（${result.errors.length} 个错误）`, 'error');
      } else if (result.downloadedPlugins > 0) {
        showToast(`已恢复 ${result.downloadedPlugins} 个插件`, 'success');
      } else {
        showToast('云端暂无插件', 'info');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logSyncError(`downloadPluginsOnly 异常: ${msg}`, error);
      showToast(`插件下载失败：${msg}`, 'error');
    } finally {
      pluginSyncing.value = false;
      pluginSyncProgress.value = '';
    }
  }

  return {
    syncing,
    syncProgress,
    lastSyncTime,
    lastSyncResult,
    pluginSyncing,
    pluginSyncProgress,
    lastPluginSyncTime,
    lastPluginSyncResult,
    canSync,
    isUploadEnabled,
    isPluginUploadEnabled,
    syncPlaylists,
    syncPlugins,
    uploadOnly,
    downloadOnly,
    uploadPluginsOnly,
    downloadPluginsOnly,
    uploadPlaylists,
    downloadPlaylists,
    deleteCloudPlaylistLocal,
  };
}
