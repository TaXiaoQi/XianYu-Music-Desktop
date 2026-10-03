import { computed, onBeforeUnmount, ref, shallowRef, type Ref } from 'vue';
import type { Song, ArtistCatalogItem, AlbumCatalogItem, Playlist } from '../../types';
import type {
  LxSearchResultItem,
} from '../../services/domain/lxMusicSdk';
import { lxGetPic } from '../../services/domain/lxMusicSdk';
import { parseIntervalToSeconds } from '../../utils/remoteSong';
import { extractDurationMs } from '../../services/domain/pluginResultMappers';
import { pluginGetCover } from '../../services/domain/pluginEngine';
import { ensureLxPluginInstance, lxPluginGetPic } from '../../services/domain/lxPluginEngine';
import type { PluginArtistResult, PluginAlbumResult } from '../../services/domain/pluginEngine';
import type { PluginSource, PluginSearchResult, PluginPlaylistSearchResult } from '../../types';
import { fetchWyTrackMetaByIds } from '../../services/domain/playlistImport';
import { qqFillSongDurations } from '../../services/domain/qqHostSearchFallback';
import type { SearchSources } from './useSearchSources';
import type { SearchTypeKey } from './useSearchQuery';

// ==================== 结果条目（本地/插件统一网格模型）====================
export type CatalogGridEntry =
  | {
      type: 'artist';
      source: 'local';
      key: string;
      item: ArtistCatalogItem;
    }
  | {
      type: 'artist';
      source: 'plugin';
      key: string;
      item: PluginArtistResult;
    }
  | {
      type: 'album';
      source: 'local';
      key: string;
      item: AlbumCatalogItem;
    }
  | {
      type: 'album';
      source: 'plugin';
      key: string;
      item: PluginAlbumResult;
    }
  | {
      type: 'playlist';
      source: 'local';
      key: string;
      item: Playlist;
    }
  | {
      type: 'playlist';
      source: 'plugin';
      key: string;
      item: PluginPlaylistSearchResult;
    };

export type SearchResults = ReturnType<typeof useSearchResults>;

// ==================== 搜索结果状态（聚合/分页/封面回填）====================
export function useSearchResults(options: {
  activeSearchType: Ref<SearchTypeKey>;
  sources: SearchSources;
}) {
  const { activeSearchType } = options;
  const { selectedSourceItem, isLocalSource } = options.sources;

  const searching = ref(false);
  const loadingMore = ref(false);
  const hasMore = ref(false);
  const currentPage = ref(1);
  const lxSearchResults = shallowRef<LxSearchResultItem[]>([]);
  const pluginSearchResults = shallowRef<PluginSearchResult[]>([]);
  const localSearchResults = shallowRef<Song[]>([]);
  const localArtistResults = shallowRef<ArtistCatalogItem[]>([]);
  const localAlbumResults = shallowRef<AlbumCatalogItem[]>([]);
  const localPlaylistResults = shallowRef<Playlist[]>([]);
  const pluginArtistResults = shallowRef<PluginArtistResult[]>([]);
  const pluginAlbumResults = shallowRef<PluginAlbumResult[]>([]);
  const pluginPlaylistResults = shallowRef<PluginPlaylistSearchResult[]>([]);

  const resultCount = computed(() => {
    if (activeSearchType.value === 'track') {
      if (isLocalSource.value) return localSearchResults.value.length;
      if (selectedSourceItem.value?.type === 'lx') return lxSearchResults.value.length;
      return pluginSearchResults.value.length;
    }
    if (isLocalSource.value) {
      if (activeSearchType.value === 'artist') return localArtistResults.value.length;
      if (activeSearchType.value === 'album') return localAlbumResults.value.length;
      if (activeSearchType.value === 'playlist') return localPlaylistResults.value.length;
    }
    if (activeSearchType.value === 'artist') return pluginArtistResults.value.length;
    if (activeSearchType.value === 'album') return pluginAlbumResults.value.length;
    if (activeSearchType.value === 'playlist') return pluginPlaylistResults.value.length;
    return 0;
  });

  const hasNoResults = computed(() => {
    if (activeSearchType.value === 'track') {
      return lxSearchResults.value.length === 0 && pluginSearchResults.value.length === 0 && localSearchResults.value.length === 0;
    }
    if (isLocalSource.value) {
      if (activeSearchType.value === 'artist') return localArtistResults.value.length === 0;
      if (activeSearchType.value === 'album') return localAlbumResults.value.length === 0;
      if (activeSearchType.value === 'playlist') return localPlaylistResults.value.length === 0;
    }
    if (activeSearchType.value === 'artist') return pluginArtistResults.value.length === 0;
    if (activeSearchType.value === 'album') return pluginAlbumResults.value.length === 0;
    if (activeSearchType.value === 'playlist') return pluginPlaylistResults.value.length === 0;
    return true;
  });

  // ==================== 在线歌曲结果转换（SongTable 容器） ====================

  function mfResultToSong(item: PluginSearchResult): Song {
    const artistNames = item.artist ? item.artist.split(/[、,/&]/).filter(Boolean).map(s => s.trim()) : ['未知歌手'];

    let album = item.album || '';
    if (!album && item.rawData) {
      const raw = item.rawData;
      album = raw.al?.name || raw.album?.name || raw.albumName || '';
    }
    album = album || '未知专辑';

    let durationMs = item.duration || 0;
    if ((!durationMs || durationMs <= 0) && item.rawData) {
      durationMs = extractDurationMs(item.rawData);
    }

    return {
      name: item.title,
      title: item.title,
      path: `plugin://${item.platform}/${item.id}`,
      artist: item.artist || '未知歌手',
      artist_names: artistNames,
      effective_artist_names: artistNames,
      album,
      album_artist: item.artist || '未知歌手',
      album_key: `${album}-${item.artist || '未知歌手'}`,
      is_various_artists_album: false,
      collapse_artist_credits: false,
      duration: Math.floor((durationMs || 0) / 1000),
      cover_thumb_path: item.coverUrl || '',
      source_type: 'plugin',
      remote_source_id: `plugin://${item.platform}/${item.id}`,
      rawData: item,
    } as any;
  }

  function lxResultToSong(item: LxSearchResultItem): Song {
    const artistNames = item.singer ? item.singer.split('、').filter(Boolean) : ['未知歌手'];
    const songDuration = parseIntervalToSeconds(item.interval);
    const album = item.albumName || '未知专辑';
    return {
      name: item.name,
      title: item.name,
      path: `lx://${item.source}/${item.songmid}`,
      artist: item.singer || '未知歌手',
      artist_names: artistNames,
      effective_artist_names: artistNames,
      album,
      album_artist: item.singer || '未知歌手',
      album_key: `${album}-${item.singer || '未知歌手'}`,
      is_various_artists_album: false,
      collapse_artist_credits: false,
      duration: songDuration,
      cover_thumb_path: item.img || '',
      source_type: 'remote',
      remote_source_id: `lx://${item.source}/${item.songmid}`,
      _hash: item.hash,
      _types: item._types,
      _copyrightId: item.copyrightId,
      _songmid: item.songmid,
      _source: item.source,
      _songId: item.songId,
      _strMediaMid: item.strMediaMid,
      _albumMid: item.albumMid,
      _albumId: item.albumId,
      rawData: item,
    } as any;
  }

  const onlineTrackSongs = computed<Song[]>(() => {
    if (isLocalSource.value) return localSearchResults.value;
    if (selectedSourceItem.value?.type === 'lx') {
      return lxSearchResults.value.map((item: LxSearchResultItem) => lxResultToSong(item));
    }
    return pluginSearchResults.value.map((item: PluginSearchResult) => mfResultToSong(item));
  });

  // ==================== 网格条目聚合（歌手/专辑/歌单）====================
  const catalogGridItems = computed<CatalogGridEntry[]>(() => {
    if (activeSearchType.value === 'artist') {
      return [
        ...localArtistResults.value.map((item): CatalogGridEntry => ({
          type: 'artist',
          source: 'local',
          key: `artist-local-${item.id}`,
          item,
        })),
        ...pluginArtistResults.value.map((item): CatalogGridEntry => ({
          type: 'artist',
          source: 'plugin',
          key: `artist-plugin-${item.id}`,
          item,
        })),
      ];
    }

    if (activeSearchType.value === 'album') {
      return [
        ...localAlbumResults.value.map((item): CatalogGridEntry => ({
          type: 'album',
          source: 'local',
          key: `album-local-${item.key}`,
          item,
        })),
        ...pluginAlbumResults.value.map((item): CatalogGridEntry => ({
          type: 'album',
          source: 'plugin',
          key: `album-plugin-${item.id}`,
          item,
        })),
      ];
    }

    if (activeSearchType.value === 'playlist') {
      return [
        ...localPlaylistResults.value.map((item): CatalogGridEntry => ({
          type: 'playlist',
          source: 'local',
          key: `playlist-local-${item.id}`,
          item,
        })),
        ...pluginPlaylistResults.value.map((item): CatalogGridEntry => ({
          type: 'playlist',
          source: 'plugin',
          key: `playlist-plugin-${item.id}`,
          item,
        })),
      ];
    }

    return [];
  });

  let coverLoadVersion = 0;
  let coverLoadUiTimer: ReturnType<typeof setInterval> | null = null;

  const clearCoverLoadUiTimer = () => {
    if (coverLoadUiTimer) {
      clearInterval(coverLoadUiTimer);
      coverLoadUiTimer = null;
    }
  };
  let catalogCoverRefreshVersion = 0;
  let catalogCoverRefreshTimer: ReturnType<typeof setInterval> | null = null;

  const stopCatalogCoverRefresh = () => {
    catalogCoverRefreshVersion += 1;
    if (catalogCoverRefreshTimer) {
      clearInterval(catalogCoverRefreshTimer);
      catalogCoverRefreshTimer = null;
    }
  };

  const watchCatalogCoverBackfill = <T,>(
    getItems: () => T[],
    pickUrl: (item: T) => string,
    commit: (items: T[]) => void,
  ) => {
    const version = ++catalogCoverRefreshVersion;
    if (catalogCoverRefreshTimer) clearInterval(catalogCoverRefreshTimer);
    let prev = '';
    catalogCoverRefreshTimer = setInterval(() => {
      if (version !== catalogCoverRefreshVersion) {
        clearInterval(catalogCoverRefreshTimer!);
        catalogCoverRefreshTimer = null;
        return;
      }
      const items = getItems();
      const settled = items.length === 0 || items.every(i => pickUrl(i));
      const snapshot = items.map(i => pickUrl(i) || '').join('|');
      if (snapshot !== prev) {
        prev = snapshot;
        commit([...items]);
      }
      if (settled) {
        clearInterval(catalogCoverRefreshTimer!);
        catalogCoverRefreshTimer = null;
      }
    }, 600);
    setTimeout(() => {
      if (version === catalogCoverRefreshVersion && catalogCoverRefreshTimer) {
        clearInterval(catalogCoverRefreshTimer);
        catalogCoverRefreshTimer = null;
      }
    }, 15000);
  };

  const withTimeoutFallback = async <T,>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      return await Promise.race([
        promise,
        new Promise<T>(resolve => {
          timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  };

  function triggerCoverLoading() {
    const version = ++coverLoadVersion;
    clearCoverLoadUiTimer();
    const items = lxSearchResults.value.filter(item => item.img === null);
    if (items.length === 0) return;
    const CONCURRENCY = 8;
    let nextIdx = 0;
    let hasUpdate = false;
    const worker = async () => {
      while (nextIdx < items.length) {
        if (version !== coverLoadVersion) return;
        const item = items[nextIdx++];
        try {
          const currentSource = selectedSourceItem.value;
          const pluginPicPromise = currentSource?.type === 'lx' && currentSource.source && currentSource.lxSourceId
            ? (async () => {
              await ensureLxPluginInstance(currentSource.source!);
              return lxPluginGetPic(currentSource.source!, currentSource.lxSourceId!, item);
            })()
            : Promise.resolve(null);
          const picUrl = await withTimeoutFallback(
            pluginPicPromise.then(url => url || lxGetPic(item)),
            8000,
            null,
          );
          if (version !== coverLoadVersion) return;
          if (picUrl) {
            item.img = picUrl;
            hasUpdate = true;
          } else {
            item.img = '';
          }
        } catch {
          item.img = '';
        }
      }
    };
    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    const uiTimer = setInterval(() => {
      if (version !== coverLoadVersion) {
        clearInterval(uiTimer);
        if (coverLoadUiTimer === uiTimer) {
          coverLoadUiTimer = null;
        }
        return;
      }
      if (hasUpdate) {
        hasUpdate = false;
        lxSearchResults.value = [...lxSearchResults.value];
      }
    }, 500);
    coverLoadUiTimer = uiTimer;
    Promise.all(workers).then(() => {
      clearInterval(uiTimer);
      if (coverLoadUiTimer === uiTimer) {
        coverLoadUiTimer = null;
      }
      if (version === coverLoadVersion && hasUpdate) {
        lxSearchResults.value = [...lxSearchResults.value];
      }
    });
  }
  const mfCoverAttempted = new WeakSet<PluginSearchResult>();

  const isNeteaseSource = (pluginSource: PluginSource): boolean => {
    if (pluginSource.sources?.some(s => s === 'wy' || /网易云|netease/i.test(s))) return true;
    return /网易云|netease/i.test(pluginSource.name || '');
  };

  async function backfillWyTrackMeta(pluginSource: PluginSource, items: PluginSearchResult[]) {
    if (!isNeteaseSource(pluginSource)) return;

    const version = coverLoadVersion;
    const pending = items.filter(item => (
      (!item.coverUrl || !item.duration) && /^\d+$/.test(String(item.id))
    ));
    if (pending.length === 0) return;

    const patches = await fetchWyTrackMetaByIds(pending.map(item => String(item.id)));
    if (patches.size === 0) return;
    if (version !== coverLoadVersion) return;

    let changed = false;
    for (const item of pending) {
      const patch = patches.get(String(item.id));
      if (!patch) continue;
      if (!item.coverUrl && patch.coverUrl) {
        item.coverUrl = patch.coverUrl;
        changed = true;
      }
      if (!item.duration && patch.durationMs > 0) {
        item.duration = patch.durationMs;
        changed = true;
      }
    }

    if (changed) {
      pluginSearchResults.value = [...pluginSearchResults.value];
    }
  }

  async function backfillQqTrackMeta(pluginSource: PluginSource, items: PluginSearchResult[]) {
    const pending = items.filter(item => !item.duration && item.rawData?.id);
    if (pending.length === 0) return;

    const version = coverLoadVersion;
    await qqFillSongDurations(pluginSource, undefined, pending);
    if (version !== coverLoadVersion) return;
    if (pending.some(item => item.duration)) {
      pluginSearchResults.value = [...pluginSearchResults.value];
    }
  }

  function triggerMfCoverLoading(pluginSource: PluginSource) {
    const version = ++coverLoadVersion;
    clearCoverLoadUiTimer();
    const items = pluginSearchResults.value.filter((item) => {
      if ((item.coverUrl && item.duration) || mfCoverAttempted.has(item)) return false;
      mfCoverAttempted.add(item);
      return true;
    });
    if (items.length === 0) return;

    const CONCURRENCY = 8;
    let nextIdx = 0;
    let hasUpdate = false;

    const worker = async () => {
      while (nextIdx < items.length) {
        if (version !== coverLoadVersion) return;
        const item = items[nextIdx++];
        try {
          const coverUrl = await withTimeoutFallback(
            pluginGetCover(pluginSource, item),
            8000,
            null,
          );
          if (version !== coverLoadVersion) return;
          if (coverUrl && coverUrl !== item.coverUrl) {
            item.coverUrl = coverUrl.startsWith('http://') ? coverUrl.replace('http://', 'https://') : coverUrl;
            hasUpdate = true;
          }
          if (item.duration) hasUpdate = true;
        } catch { /* 已在 WeakSet 中标记，不再重试 */ }
      }
    };

    const workers = Array.from({ length: CONCURRENCY }, () => worker());

    const uiTimer = setInterval(() => {
      if (version !== coverLoadVersion) {
        clearInterval(uiTimer);
        if (coverLoadUiTimer === uiTimer) {
          coverLoadUiTimer = null;
        }
        return;
      }
      if (hasUpdate) {
        hasUpdate = false;
        pluginSearchResults.value = [...pluginSearchResults.value];
      }
    }, 500);
    coverLoadUiTimer = uiTimer;

    Promise.all(workers).then(() => {
      clearInterval(uiTimer);
      if (coverLoadUiTimer === uiTimer) {
        coverLoadUiTimer = null;
      }
      if (version === coverLoadVersion && hasUpdate) {
        pluginSearchResults.value = [...pluginSearchResults.value];
      }
    });
  }

  // 刷新当前类型的插件结果数组（触发封面/代理图重渲染）
  const refreshCatalogResults = () => {
    if (activeSearchType.value === 'artist') pluginArtistResults.value = [...pluginArtistResults.value];
    else if (activeSearchType.value === 'album') pluginAlbumResults.value = [...pluginAlbumResults.value];
    else pluginPlaylistResults.value = [...pluginPlaylistResults.value];
  };

  onBeforeUnmount(() => {
    coverLoadVersion += 1;
    clearCoverLoadUiTimer();
    stopCatalogCoverRefresh();
  });

  return {
    searching,
    loadingMore,
    hasMore,
    currentPage,
    lxSearchResults,
    pluginSearchResults,
    localSearchResults,
    localArtistResults,
    localAlbumResults,
    localPlaylistResults,
    pluginArtistResults,
    pluginAlbumResults,
    pluginPlaylistResults,
    resultCount,
    hasNoResults,
    onlineTrackSongs,
    catalogGridItems,
    triggerCoverLoading,
    triggerMfCoverLoading,
    backfillWyTrackMeta,
    backfillQqTrackMeta,
    watchCatalogCoverBackfill,
    stopCatalogCoverRefresh,
    refreshCatalogResults,
  };
}
