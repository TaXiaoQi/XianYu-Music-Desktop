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
  cloudSongToSong,
  deleteCloudPlaylist,
  fileSyncDownload,
  fileSyncUpload,
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
import {
  uploadSettings as uploadSettingsToCloud,
  downloadSettings as downloadSettingsFromCloud,
  areSettingsEqual,
  type SettingsSyncResult,
} from '../services/settingsSync';
import {
  showSettingsConflict,
  type SyncCategoryChoices,
} from './useSettingsConflict';
import {
  getAutoSyncScheduler,
} from '../services/autoSync';
import { playerStorage } from '../services/storage/playerStorage';
import { mergeAppSettings, createDefaultAppSettings } from '../features/settings/store';
import type { AutoSyncConfig, Playlist, Song } from '../types';

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

  // 设置同步独立状态
  const settingsSyncing = ref(false);
  const settingsSyncProgress = ref('');
  const lastSettingsSyncTime = ref<number | null>(null);
  const lastSettingsSyncResult = ref<SettingsSyncResult | null>(null);

  // 自动同步状态
  const autoSyncStatus = ref('');
  const autoSyncDelayed = ref(false);
  let autoSyncInitialized = false;

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

  /** 检查设置上传是否在设置中启用 */
  function isSettingsUploadEnabled(): boolean {
    return settingsStore.settings.upload.settings;
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
   * 仅上传设置到云端
   */
  async function uploadSettingsOnly(): Promise<void> {
    logSync('========== uploadSettingsOnly 开始 ==========');
    if (!canSync()) {
      logSyncError('uploadSettingsOnly: 未登录或无弦予号');
      showToast('请先登录后再同步', 'error');
      return;
    }

    if (!isSettingsUploadEnabled()) {
      logSync('uploadSettingsOnly: 设置同步未开启');
      showToast('设置同步已关闭，请在设置中开启', 'info');
      return;
    }

    settingsSyncing.value = true;
    settingsSyncProgress.value = '正在上传设置到云端...';

    try {
      const result = await uploadSettingsToCloud(settingsStore.settings);
      lastSettingsSyncTime.value = Date.now();
      lastSettingsSyncResult.value = result;
      logSync(`uploadSettingsOnly 完成: uploaded=${result.uploaded}, errors=${result.errors.length}`);

      if (result.errors.length > 0) {
        showToast(`设置上传完成（${result.errors.length} 个错误）`, 'error');
      } else if (result.uploaded) {
        showToast('设置已上传到云端', 'success');
      } else {
        showToast('设置上传失败', 'info');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logSyncError(`uploadSettingsOnly 异常: ${msg}`, error);
      showToast(`设置上传失败：${msg}`, 'error');
    } finally {
      settingsSyncing.value = false;
      settingsSyncProgress.value = '';
    }
  }

  /**
   * 仅从云端下载设置
   */
  async function downloadSettingsOnly(): Promise<void> {
    logSync('========== downloadSettingsOnly 开始 ==========');
    if (!canSync()) {
      logSyncError('downloadSettingsOnly: 未登录或无弦予号');
      showToast('请先登录后再同步', 'error');
      return;
    }

    settingsSyncing.value = true;
    settingsSyncProgress.value = '正在从云端下载设置...';

    try {
      const { settings: cloudSettings, result } = await downloadSettingsFromCloud();
      lastSettingsSyncTime.value = Date.now();
      lastSettingsSyncResult.value = result;
      logSync(`downloadSettingsOnly 完成: downloaded=${result.downloaded}, errors=${result.errors.length}`);

      if (result.errors.length > 0) {
        showToast(`设置下载完成（${result.errors.length} 个错误）`, 'error');
      } else if (cloudSettings) {
        // 合并云端设置到本地：以本地默认值为 base，用云端 patch 覆盖
        // 保留本地设备相关字段（downloadPath 等）
        const currentSettings = settingsStore.settings;
        const merged = mergeAppSettings(createDefaultAppSettings(), cloudSettings as any);
        // 恢复本地设备相关字段
        merged.download.downloadPath = currentSettings.download.downloadPath;
        merged.upload = currentSettings.upload; // upload 设置不同步，保持本地
        merged.organizeRoot = currentSettings.organizeRoot; // organizeRoot 是设备相关路径
        settingsStore.replaceSettings(merged);

        // 持久化到 localStorage
        playerStorage.writeSettings(merged);

        showToast('设置已从云端恢复', 'success');
      } else {
        showToast('云端暂无设置数据', 'info');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logSyncError(`downloadSettingsOnly 异常: ${msg}`, error);
      showToast(`设置下载失败：${msg}`, 'error');
    } finally {
      settingsSyncing.value = false;
      settingsSyncProgress.value = '';
    }
  }

  /**
   * 双向同步设置：先比较本地与云端，一致则跳过，不一致则弹窗让用户选择
   */
  async function syncSettings(): Promise<SettingsSyncResult> {
    logSync('========== syncSettings 开始 ==========');
    if (!canSync()) {
      logSyncError('syncSettings: 未登录或无弦予号，取消同步');
      showToast('请先登录后再同步', 'error');
      return { uploaded: false, downloaded: false, errors: ['未登录'] };
    }

    settingsSyncing.value = true;
    settingsSyncProgress.value = '正在同步设置...';
    lastSettingsSyncResult.value = null;

    try {
      // 第一步：下载云端设置用于比较
      logSync('syncSettings: 步骤 1/2 - 下载云端设置进行比较');
      settingsSyncProgress.value = '正在从云端获取设置...';
      const { settings: cloudSettings, uploadedAt, result: downloadResult } = await downloadSettingsFromCloud();
      logSync('syncSettings: 步骤 1/2 - 云端设置下载完成', downloadResult);

      // 云端无数据：直接上传本地设置（首次同步）
      if (!cloudSettings) {
        if (isSettingsUploadEnabled()) {
          logSync('syncSettings: 云端无数据，上传本地设置');
          settingsSyncProgress.value = '正在上传本地设置到云端...';
          const uploadResult = await uploadSettingsToCloud(settingsStore.settings);
          lastSettingsSyncResult.value = uploadResult;
          lastSettingsSyncTime.value = Date.now();
          if (uploadResult.errors.length > 0) {
            showToast(`设置同步完成（${uploadResult.errors.length} 个错误）`, 'error');
          } else {
            showToast('设置已上传到云端', 'success');
          }
          logSync('========== syncSettings 结束（首次上传） ==========');
          return uploadResult;
        }
        logSync('syncSettings: 云端无数据且上传未开启，跳过');
        lastSettingsSyncResult.value = downloadResult;
        lastSettingsSyncTime.value = Date.now();
        showToast('云端暂无设置数据', 'info');
        return downloadResult;
      }

      // 第二步：比较本地与云端设置
      const localSettings = settingsStore.settings;
      const isEqual = areSettingsEqual(localSettings, cloudSettings);

      if (isEqual) {
        logSync('syncSettings: 本地与云端设置一致，跳过同步');
        lastSettingsSyncResult.value = { uploaded: false, downloaded: false, errors: [] };
        lastSettingsSyncTime.value = Date.now();
        showToast('本地与云端设置一致，无需同步', 'info');
        logSync('========== syncSettings 结束（一致跳过） ==========');
        return { uploaded: false, downloaded: false, errors: [] };
      }

      // 设置不一致：弹窗让用户选择
      logSync('syncSettings: 本地与云端设置不一致，等待用户选择');
      settingsSyncProgress.value = '检测到设置不一致，等待用户选择...';
      const choice = await showSettingsConflict(uploadedAt ?? undefined);

      if (choice === 'cancel') {
        logSync('syncSettings: 用户取消同步');
        lastSettingsSyncResult.value = { uploaded: false, downloaded: false, errors: [] };
        lastSettingsSyncTime.value = Date.now();
        showToast('已取消设置同步', 'info');
        logSync('========== syncSettings 结束（用户取消） ==========');
        return { uploaded: false, downloaded: false, errors: [] };
      }

      // 用户按类别选择了保留本地或云端
      const choices = choice as SyncCategoryChoices;
      const errors: string[] = [];
      let uploaded = false;
      let downloaded = false;

      // --- 设置 ---
      if (choices.settings === 'local') {
        if (isSettingsUploadEnabled()) {
          logSync('syncSettings: 设置 → 保留本地，上传覆盖云端');
          settingsSyncProgress.value = '正在上传本地设置到云端...';
          const r = await uploadSettingsToCloud(localSettings);
          uploaded = r.uploaded;
          errors.push(...r.errors);
        } else {
          logSync('syncSettings: 设置 → 保留本地，但上传未开启，跳过');
        }
      } else {
        logSync('syncSettings: 设置 → 保留云端，下载覆盖本地');
        settingsSyncProgress.value = '正在从云端恢复设置...';
        const merged = mergeAppSettings(createDefaultAppSettings(), cloudSettings as any);
        merged.download.downloadPath = localSettings.download.downloadPath;
        merged.upload = localSettings.upload;
        merged.organizeRoot = localSettings.organizeRoot;
        settingsStore.replaceSettings(merged);
        playerStorage.writeSettings(merged);
        downloaded = true;
        errors.push(...downloadResult.errors);
      }

      // --- 歌单 ---
      if (choices.playlists === 'local') {
        if (isUploadEnabled()) {
          logSync('syncSettings: 歌单 → 保留本地，上传到云端');
          settingsSyncProgress.value = '正在上传本地歌单到云端...';
          try {
            await uploadPlaylists();
          } catch (e) {
            errors.push(e instanceof Error ? e.message : String(e));
          }
        } else {
          logSync('syncSettings: 歌单 → 保留本地，但上传未开启，跳过');
        }
      } else {
        logSync('syncSettings: 歌单 → 保留云端，下载到本地');
        settingsSyncProgress.value = '正在从云端下载歌单...';
        try {
          await downloadPlaylists();
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }

      // --- 插件 ---
      if (choices.plugins === 'local') {
        if (isPluginUploadEnabled()) {
          logSync('syncSettings: 插件 → 保留本地，上传到云端');
          settingsSyncProgress.value = '正在上传本地插件到云端...';
          try {
            await uploadPluginsToCloud();
          } catch (e) {
            errors.push(e instanceof Error ? e.message : String(e));
          }
        } else {
          logSync('syncSettings: 插件 → 保留本地，但上传未开启，跳过');
        }
      } else {
        logSync('syncSettings: 插件 → 保留云端，下载到本地');
        settingsSyncProgress.value = '正在从云端下载插件...';
        try {
          await downloadPluginsFromCloud();
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }

      const combinedResult: SettingsSyncResult = { uploaded, downloaded, errors };
      lastSettingsSyncResult.value = combinedResult;
      lastSettingsSyncTime.value = Date.now();

      if (errors.length > 0) {
        showToast(`同步完成（${errors.length} 个错误）`, 'error');
      } else {
        showToast('同步完成', 'success');
      }
      logSync('========== syncSettings 结束（按类别同步） ==========');
      return combinedResult;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logSyncError(`syncSettings 异常: ${msg}`, error);
      showToast(`设置同步失败：${msg}`, 'error');
      return { uploaded: false, downloaded: false, errors: [msg] };
    } finally {
      settingsSyncing.value = false;
      settingsSyncProgress.value = '';
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

  /**
   * 根据上传设置执行自动同步
   * 按用户开启的同步项依次执行
   */
  async function performAutoSync(): Promise<void> {
    logSync('performAutoSync: 开始自动同步');
    const upload = settingsStore.settings.upload;
    let hasError = false;

    if (upload.playlists) {
      try {
        logSync('performAutoSync: 同步歌单');
        await syncPlaylists();
      } catch (e) {
        logSyncError('performAutoSync: 同步歌单失败', e);
        hasError = true;
      }
    }

    if (upload.plugins) {
      try {
        logSync('performAutoSync: 同步插件');
        await syncPlugins();
      } catch (e) {
        logSyncError('performAutoSync: 同步插件失败', e);
        hasError = true;
      }
    }

    if (upload.settings) {
      try {
        logSync('performAutoSync: 同步设置');
        await syncSettings();
      } catch (e) {
        logSyncError('performAutoSync: 同步设置失败', e);
        hasError = true;
      }
    }

    logSync('performAutoSync: 自动同步完成');
    if (hasError) {
      throw new Error('部分同步项失败');
    }
  }

  /** 更新自动同步配置 */
  function patchAutoSyncConfig(patch: Partial<AutoSyncConfig>) {
    settingsStore.patchSettings({
      autoSync: patch,
    });
    // 配置变更后重启调度器
    getAutoSyncScheduler().restart();
  }

  /** 初始化自动同步调度器 */
  function initAutoSync() {
    if (autoSyncInitialized) return;
    autoSyncInitialized = true;

    const scheduler = getAutoSyncScheduler();
    scheduler.init({
      getConfig: () => settingsStore.settings.autoSync,
      updateConfig: (patch) => settingsStore.patchSettings({ autoSync: patch }),
      canSync: () => canSync(),
      onSync: performAutoSync,
      onSyncStart: () => {
        autoSyncStatus.value = '正在自动同步...';
        autoSyncDelayed.value = false;
      },
      onSyncComplete: (success) => {
        autoSyncStatus.value = success ? '自动同步完成' : '自动同步未完成';
        setTimeout(() => {
          autoSyncStatus.value = '';
        }, 5000);
      },
      onDelayed: (delaySeconds, attempt) => {
        autoSyncDelayed.value = true;
        const delayMin = Math.ceil(delaySeconds / 60);
        autoSyncStatus.value = `服务器繁忙，自动延后 ${delayMin} 分钟（第 ${attempt} 次）`;
        showToast(`服务器当前同步用户过多，已自动延后 ${delayMin} 分钟`, 'info');
      },
    });

    // 如果已登录且已启用，启动调度器
    if (canSync() && settingsStore.settings.autoSync.enabled) {
      scheduler.start();
    }
  }

  /** 手动触发自动同步检查 */
  function checkAutoSync() {
    const scheduler = getAutoSyncScheduler();
    if (settingsStore.settings.autoSync.enabled && canSync()) {
      scheduler.restart();
    } else {
      scheduler.stop();
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
    settingsSyncing,
    settingsSyncProgress,
    lastSettingsSyncTime,
    lastSettingsSyncResult,
    autoSyncStatus,
    autoSyncDelayed,
    canSync,
    isUploadEnabled,
    isPluginUploadEnabled,
    isSettingsUploadEnabled,
    syncPlaylists,
    syncPlugins,
    syncSettings,
    uploadOnly,
    downloadOnly,
    uploadPluginsOnly,
    downloadPluginsOnly,
    uploadSettingsOnly,
    downloadSettingsOnly,
    uploadPlaylists,
    downloadPlaylists,
    deleteCloudPlaylistLocal,
    initAutoSync,
    checkAutoSync,
    patchAutoSyncConfig,
    performAutoSync,
  };
}
