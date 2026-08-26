import { ref, type Ref } from 'vue';

import type { Song } from '../types';
import { useToast } from './toast';
import { checkDownloadExists, getDownloadRecord } from '../services/domain/downloadHistory';
import { getStoredPlugins, pluginArtistSearch, pluginAlbumSearch } from '../services/domain/pluginEngine';
import { openOnlineDetail } from '../features/onlineDetail/store';

/**
 * 判断是否为在线歌曲（覆盖 lx://、plugin://、remote:// 协议及 source_type 字段）。
 * 比 isDownloadableOnlineSong 更宽泛，用于右键菜单的在线/本地菜单切换。
 * remote:// (WebDAV) 歌曲虽不支持"下载至本地"，但仍属于在线歌曲，应使用在线菜单。
 */
const isOnlineSong = (song: Song | null | undefined): boolean => {
  if (!song) return false;
  const path = song.path ?? '';
  return path.startsWith('lx://')
      || path.startsWith('plugin://')
      || path.startsWith('remote://')
      || song.source_type === 'remote'
      || song.source_type === 'plugin';
};

interface UseSongContextActionsOptions {
  isBatchMode: Ref<boolean>;
  deleteFromDisk?: (song: Song) => Promise<unknown>;
}

export function useSongContextActions({
  isBatchMode,
  deleteFromDisk,
}: UseSongContextActionsOptions) {
  const { showToast } = useToast();

  const showContextMenu = ref(false);
  const contextMenuX = ref(0);
  const contextMenuY = ref(0);
  const contextMenuTargetSong = ref<Song | null>(null);
  /** 已下载在线歌曲的本地文件路径（供右键菜单执行文件操作） */
  const contextMenuResolvedPath = ref<string | undefined>(undefined);
  /** 在线歌曲未下载时使用在线搜索右键菜单 */
  const contextMenuIsOnlineSearch = ref(false);
  const showSongPhysicalDeleteConfirm = ref(false);
  const songToPhysicalDelete = ref<Song | null>(null);

  const handleContextMenu = (event: MouseEvent, song: Song) => {
    if (isBatchMode.value) return;

    contextMenuTargetSong.value = song;
    contextMenuX.value = event.clientX;
    contextMenuY.value = event.clientY;

    // 在线歌曲：已下载且文件存在 → 本地菜单（索引至本地文件），未下载 → 在线菜单
    if (isOnlineSong(song)) {
      const record = getDownloadRecord(song.path);
      if (record) {
        // 有缓存记录，先按本地菜单显示，异步验证文件是否真实存在
        contextMenuResolvedPath.value = record.filePath;
        contextMenuIsOnlineSearch.value = false;
        showContextMenu.value = true;

        // 文件已被删除（用户手动删除等）→ 切换为在线菜单
        void checkDownloadExists(song.path).then((validRecord) => {
          if (!validRecord && contextMenuTargetSong.value?.path === song.path) {
            contextMenuResolvedPath.value = undefined;
            contextMenuIsOnlineSearch.value = true;
          }
        });
        return;
      }

      // 无缓存记录 → 直接在线菜单
      contextMenuResolvedPath.value = undefined;
      contextMenuIsOnlineSearch.value = true;
      showContextMenu.value = true;
      return;
    }

    // 本地歌曲 → 本地菜单
    contextMenuResolvedPath.value = undefined;
    contextMenuIsOnlineSearch.value = false;
    showContextMenu.value = true;
  };

  const handleSongPhysicalDelete = (song: Song) => {
    songToPhysicalDelete.value = song;
    showSongPhysicalDeleteConfirm.value = true;
    showContextMenu.value = false;
  };

  const executeSongPhysicalDelete = async () => {
    if (!songToPhysicalDelete.value) {
      return;
    }

    if (deleteFromDisk) {
      await deleteFromDisk(songToPhysicalDelete.value);
    }
    showSongPhysicalDeleteConfirm.value = false;
    songToPhysicalDelete.value = null;
  };

  /** 在线歌曲"查看歌手"：解析插件源后搜索并跳转在线详情页 */
  const handleOnlineViewArtist = async (song: Song) => {
    const artistName = song.effective_artist_names?.[0] || song.artist_names?.[0] || song.artist || '';
    if (!artistName || artistName === '未知歌手') {
      showToast('当前歌曲缺少歌手信息', 'info');
      return;
    }

    // plugin:// 歌曲：从 rawData.pluginId 解析插件源
    const pluginId = song.rawData?.pluginId;
    if (!pluginId) {
      showToast('当前音源暂不支持查看歌手', 'info');
      return;
    }

    const plugins = getStoredPlugins();
    const pluginSource = plugins.find(p => p.id === pluginId && p.enabled);
    if (!pluginSource) {
      showToast('当前音源暂不支持查看歌手', 'info');
      return;
    }

    try {
      const results = await pluginArtistSearch(pluginSource, artistName, 1);
      if (results.length === 0) {
        showToast('未找到该歌手', 'info');
        return;
      }
      const artist = results[0];
      openOnlineDetail({
        type: 'artist',
        title: artist.name,
        subtitle: artist.description || (artist.songCount ? `${artist.songCount} 首歌曲` : ''),
        description: artist.description || '',
        coverUrl: artist.avatarUrl,
        pluginSource,
        rawData: artist.rawData,
        platformId: artist.platformId || artist.id,
      });
    } catch (e: any) {
      showToast(`查看歌手失败: ${e?.message || e}`, 'error');
    }
  };

  /** 在线歌曲"查看专辑"：解析插件源后搜索并跳转在线详情页 */
  const handleOnlineViewAlbum = async (song: Song) => {
    const albumName = song.album || '';
    if (!albumName || albumName === '未知专辑') {
      showToast('当前歌曲缺少专辑信息', 'info');
      return;
    }

    const pluginId = song.rawData?.pluginId;
    if (!pluginId) {
      showToast('当前音源暂不支持查看专辑', 'info');
      return;
    }

    const plugins = getStoredPlugins();
    const pluginSource = plugins.find(p => p.id === pluginId && p.enabled);
    if (!pluginSource) {
      showToast('当前音源暂不支持查看专辑', 'info');
      return;
    }

    try {
      const results = await pluginAlbumSearch(pluginSource, albumName, 1);
      if (results.length === 0) {
        showToast('未找到该专辑', 'info');
        return;
      }
      const album = results[0];
      openOnlineDetail({
        type: 'album',
        title: album.name,
        subtitle: album.artist,
        coverUrl: album.coverUrl,
        pluginSource,
        rawData: album.rawData,
        platformId: album.platformId || album.id,
      });
    } catch (e: any) {
      showToast(`查看专辑失败: ${e?.message || e}`, 'error');
    }
  };

  return {
    showContextMenu,
    contextMenuX,
    contextMenuY,
    contextMenuTargetSong,
    contextMenuResolvedPath,
    contextMenuIsOnlineSearch,
    showSongPhysicalDeleteConfirm,
    songToPhysicalDelete,
    handleContextMenu,
    handleSongPhysicalDelete,
    executeSongPhysicalDelete,
    handleOnlineViewArtist,
    handleOnlineViewAlbum,
  };
}
