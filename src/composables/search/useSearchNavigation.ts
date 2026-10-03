import { ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Song, ArtistCatalogItem, AlbumCatalogItem, Playlist, PluginPlaylistSearchResult } from '../../types';
import { pluginArtistSearch, pluginAlbumSearch } from '../../services/domain/pluginEngine';
import type { PluginArtistResult, PluginAlbumResult } from '../../services/domain/pluginEngine';
import { openOnlineDetail } from '../../features/onlineDetail/store';
import { useLibraryStore } from '../../features/library/store';
import { useAddToPlaylistDialog } from '../../features/collections/addToPlaylistDialog';
import { useToast } from '../toast';
import type { CatalogGridEntry } from './useSearchResults';
import type { SearchSources } from './useSearchSources';

// ==================== 右键菜单 / 歌手专辑歌单导航 ====================
export function useSearchNavigation(options: { sources: SearchSources }) {
  const router = useRouter();
  const libraryStore = useLibraryStore();
  const { openAddToPlaylistDialog } = useAddToPlaylistDialog();
  const { showToast } = useToast();
  const { selectedSourceItem, pluginSourceList } = options.sources;

  const showContextMenu = ref(false);
  const contextMenuX = ref(0);
  const contextMenuY = ref(0);
  const contextMenuTargetSong = ref<Song | null>(null);

  const openAddToPlaylistSelection = () => {
    const song = contextMenuTargetSong.value;
    if (!song) return;

    libraryStore.setExtraSong(song);

    openAddToPlaylistDialog([song.path], { songs: [song] });
  };

  // ==================== 在线搜索右键：歌手/专辑导航 ====================

  const handleOnlineViewArtist = async (song: Song) => {
    const artistName = song.effective_artist_names?.[0] || song.artist_names?.[0] || song.artist || '';
    if (!artistName || artistName === '未知歌手') {
      showToast('当前歌曲缺少歌手信息', 'info');
      return;
    }

    const pluginSource = selectedSourceItem.value?.source;
    if (!pluginSource) {
      showToast('当前音源不支持查看歌手', 'info');
      return;
    }

    if (selectedSourceItem.value?.type === 'musicfree') {
      try {
        const results = await pluginArtistSearch(pluginSource, artistName, 1);
        if (results.length === 0) {
          showToast('未找到该歌手', 'info');
          return;
        }
        const artist = results[0];
        pushDetail({
          type: 'artist',
          title: artist.name,
          subtitle: artist.description || (artist.songCount ? `${artist.songCount} 首歌曲` : ''),
          coverUrl: artist.avatarUrl,
          pluginSource,
          rawData: artist.rawData,
          platformId: artist.platformId || artist.id,
          engineType: 'musicfree',
        });
      } catch (e: any) {
        showToast(`查看歌手失败: ${e?.message || e}`, 'error');
      }
      return;
    }

    showToast('当前音源暂不支持查看歌手', 'info');
  };

  const handleOnlineViewAlbum = async (song: Song) => {
    const albumName = song.album || '';
    if (!albumName || albumName === '未知专辑') {
      showToast('当前歌曲缺少专辑信息', 'info');
      return;
    }

    const pluginSource = selectedSourceItem.value?.source;
    if (!pluginSource) {
      showToast('当前音源不支持查看专辑', 'info');
      return;
    }

    if (selectedSourceItem.value?.type === 'musicfree') {
      try {
        const results = await pluginAlbumSearch(pluginSource, albumName, 1);
        if (results.length === 0) {
          showToast('未找到该专辑', 'info');
          return;
        }
        const album = results[0];
        pushDetail({
          type: 'album',
          title: album.name,
          subtitle: album.artist,
          coverUrl: album.coverUrl,
          pluginSource,
          rawData: album.rawData,
          platformId: album.platformId || album.id,
          engineType: 'musicfree',
        });
      } catch (e: any) {
        showToast(`查看专辑失败: ${e?.message || e}`, 'error');
      }
      return;
    }

    showToast('当前音源暂不支持查看专辑', 'info');
  };

  const handleTrackContextMenu = (e: MouseEvent, song: Song) => {
    e.preventDefault();
    contextMenuTargetSong.value = song;
    contextMenuX.value = e.clientX;
    contextMenuY.value = e.clientY;
    showContextMenu.value = true;
  };

  const handleCatalogEntryClick = (entry: CatalogGridEntry) => {
    if (entry.type === 'artist') {
      if (entry.source === 'local') handleArtistClick(entry.item);
      else handlePluginArtistClick(entry.item);
      return;
    }

    if (entry.type === 'album') {
      if (entry.source === 'local') handleAlbumClick(entry.item);
      else handlePluginAlbumClick(entry.item);
      return;
    }

    if (entry.source === 'local') handlePlaylistClick(entry.item);
    else handlePluginPlaylistClick(entry.item);
  };

  // ==================== 本地歌手/专辑/歌单导航 ====================

  const handleArtistClick = (artist: ArtistCatalogItem) => {
    void router.push({ path: '/', query: { view: 'artist', filter: artist.name } });
  };

  const handleAlbumClick = (album: AlbumCatalogItem) => {
    void router.push({ path: '/', query: { view: 'album', filter: album.key } });
  };

  const handlePlaylistClick = (playlist: Playlist) => {
    void router.push({ path: '/', query: { view: 'playlist', filter: playlist.id } });
  };

  // ==================== 插件歌手/专辑/歌单导航 ====================

  function pushDetail(context: Parameters<typeof openOnlineDetail>[0]) {
    openOnlineDetail(context);
  }

  function findPluginSource(pluginId: string) {
    const item = pluginSourceList.value.find(s => s.id === pluginId && s.type === 'musicfree');
    return item?.source;
  }

  const handlePluginArtistClick = (artist: PluginArtistResult) => {
    if (selectedSourceItem.value?.type === 'lx') {
      const lxSourceId = selectedSourceItem.value.lxSourceId!;
      pushDetail({
        type: 'artist',
        title: artist.name,
        subtitle: artist.description || (artist.songCount ? `${artist.songCount} 首歌曲` : ''),
        description: artist.description || '',
        coverUrl: artist.avatarUrl,
        pluginSource: selectedSourceItem.value.source!,
        rawData: artist.rawData,
        platformId: artist.platformId || artist.id,
        engineType: 'lx',
        lxSourceId,
      });
      return;
    }
    const pluginSource = findPluginSource(artist.pluginId);
    if (!pluginSource) {
      void router.push({ path: '/search', query: { q: artist.name } });
      return;
    }
    pushDetail({
      type: 'artist',
      title: artist.name,
      subtitle: artist.description || (artist.songCount ? `${artist.songCount} 首歌曲` : ''),
      description: artist.description || '',
      coverUrl: artist.avatarUrl,
      pluginSource,
      rawData: artist.rawData,
      platformId: artist.platformId || artist.id,
      engineType: 'musicfree',
    });
  };

  const handlePluginAlbumClick = (album: PluginAlbumResult) => {
    if (selectedSourceItem.value?.type === 'lx') {
      const lxSourceId = selectedSourceItem.value.lxSourceId!;
      pushDetail({
        type: 'album',
        title: album.name,
        subtitle: album.artist,
        coverUrl: album.coverUrl,
        pluginSource: selectedSourceItem.value.source!,
        rawData: album.rawData,
        platformId: album.platformId || album.id,
        engineType: 'lx',
        lxSourceId,
      });
      return;
    }
    const pluginSource = findPluginSource(album.pluginId);
    if (!pluginSource) {
      void router.push({ path: '/search', query: { q: album.name } });
      return;
    }
    pushDetail({
      type: 'album',
      title: album.name,
      subtitle: album.artist,
      coverUrl: album.coverUrl,
      pluginSource,
      rawData: album.rawData,
      platformId: album.platformId || album.id,
      engineType: 'musicfree',
    });
  };

  const handlePluginPlaylistClick = (playlist: PluginPlaylistSearchResult) => {
    if (selectedSourceItem.value?.type === 'lx') {
      const lxSourceId = selectedSourceItem.value.lxSourceId!;
      pushDetail({
        type: 'playlist',
        title: playlist.title,
        subtitle: playlist.trackCount ? `${playlist.trackCount} 首` : (playlist.artist || ''),
        coverUrl: playlist.coverUrl,
        pluginSource: selectedSourceItem.value.source!,
        rawData: playlist.rawData,
        platformId: playlist.platformId || playlist.id,
        engineType: 'lx',
        lxSourceId,
      });
      return;
    }
    const pluginSource = findPluginSource(playlist.pluginId);
    if (!pluginSource) {
      void router.push({ path: '/search', query: { q: playlist.title } });
      return;
    }
    pushDetail({
      type: 'playlist',
      title: playlist.title,
      subtitle: playlist.trackCount ? `${playlist.trackCount} 首` : (playlist.artist || ''),
      coverUrl: playlist.coverUrl,
      pluginSource,
      rawData: playlist.rawData,
      platformId: playlist.platformId || playlist.id,
      engineType: 'musicfree',
    });
  };

  return {
    showContextMenu,
    contextMenuX,
    contextMenuY,
    contextMenuTargetSong,
    handleTrackContextMenu,
    openAddToPlaylistSelection,
    handleOnlineViewArtist,
    handleOnlineViewAlbum,
    handleCatalogEntryClick,
  };
}
