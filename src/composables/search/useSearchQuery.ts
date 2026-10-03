import { computed, onBeforeUnmount, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useNavigationStore } from '../../shared/stores/navigation';
import { useLibraryBrowse } from '../../features/library/useLibraryBrowse';
import { useCollectionsStore } from '../../features/collections/store';
import { libraryApi } from '../../services/tauri/libraryApi';
import {
  lxSearch,
  lxCatalogSearch,
  type LxArtistSearchResult,
  type LxAlbumSearchResult,
  type LxPlaylistSearchResult,
} from '../../services/domain/lxMusicSdk';
import {
  pluginSearch,
  pluginArtistSearch,
  pluginAlbumSearch,
  pluginPlaylistSearch,
  pluginSupportsSearchType,
} from '../../services/domain/pluginEngine';
import type { PluginArtistResult, PluginAlbumResult } from '../../services/domain/pluginEngine';
import { reportSearch, reportInputStats } from '../../services/domain/usageStats';
import type { SearchSources } from './useSearchSources';
import type { SearchResults } from './useSearchResults';

// ==================== 内容类型 ====================
export type SearchTypeKey = 'track' | 'artist' | 'album' | 'playlist';

// ==================== 搜索触发/防抖/取消 ====================
export function useSearchQuery(options: {
  activeSearchType: Ref<SearchTypeKey>;
  sources: SearchSources;
  state: SearchResults;
  isRestoring: () => boolean;
  resetCatalogScroll: () => void;
}) {
  const activeSearchType = options.activeSearchType;
  const { selectedSourceItem, selectedSourceName, isLocalSource } = options.sources;
  const {
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
    triggerCoverLoading,
    triggerMfCoverLoading,
    backfillWyTrackMeta,
    backfillQqTrackMeta,
    watchCatalogCoverBackfill,
    stopCatalogCoverRefresh,
  } = options.state;

  const { searchQuery, searchRequestId } = storeToRefs(useNavigationStore());
  const { artistList, albumList } = useLibraryBrowse();
  const { playlists } = storeToRefs(useCollectionsStore());

  const hasQuery = computed(() => searchQuery.value.trim().length > 0);

  let searchAbortController: AbortController | null = null;

  const performSearch = async () => {
    const query = searchQuery.value.trim();
    if (!query) {
      lxSearchResults.value = [];
      pluginSearchResults.value = [];
      localSearchResults.value = [];
      localArtistResults.value = [];
      localAlbumResults.value = [];
      localPlaylistResults.value = [];
      pluginArtistResults.value = [];
      pluginAlbumResults.value = [];
      pluginPlaylistResults.value = [];
      hasMore.value = false;
      return;
    }

    if (searchAbortController) {
      searchAbortController.abort();
    }
    searchAbortController = new AbortController();
    const activeController = searchAbortController;
    stopCatalogCoverRefresh();

    currentPage.value = 1;
    hasMore.value = false;
    searching.value = true;
    options.resetCatalogScroll();
    try {
      const source = selectedSourceItem.value;
      if (!source) return;

      if (source.type === 'local') {
        pluginSearchResults.value = [];
        lxSearchResults.value = [];
        pluginArtistResults.value = [];
        pluginAlbumResults.value = [];
        pluginPlaylistResults.value = [];
        localSearchResults.value = [];
        localArtistResults.value = [];
        localAlbumResults.value = [];
        localPlaylistResults.value = [];
        const lowerQuery = query.toLowerCase();

        if (activeSearchType.value === 'track') {
          const results = await libraryApi.searchLibrarySongs(query, 200);
          if (!activeController.signal.aborted) {
            localSearchResults.value = results;
          }
        } else if (activeSearchType.value === 'artist') {
          localArtistResults.value = artistList.value.filter(artist =>
            (artist.name || '').toLowerCase().includes(lowerQuery),
          ).slice(0, 200);
        } else if (activeSearchType.value === 'album') {
          localAlbumResults.value = albumList.value.filter(album =>
            (album.name || '').toLowerCase().includes(lowerQuery) ||
            (album.artist || '').toLowerCase().includes(lowerQuery),
          ).slice(0, 200);
        } else if (activeSearchType.value === 'playlist') {
          localPlaylistResults.value = playlists.value.filter(playlist =>
            (playlist.name || '').toLowerCase().includes(lowerQuery),
          ).slice(0, 200);
        }
        hasMore.value = false;
      } else if (source.type === 'lx' && source.lxSourceId) {
        pluginSearchResults.value = [];
        pluginArtistResults.value = [];
        pluginAlbumResults.value = [];
        pluginPlaylistResults.value = [];
        localSearchResults.value = [];
        const pluginId = source.source?.id || source.id;

        if (activeSearchType.value === 'track') {
          const result = await lxSearch(source.lxSourceId, query, 1);
          if (activeController.signal.aborted) return;
          lxSearchResults.value = result.list;
          hasMore.value = result.list.length >= result.limit;
          triggerCoverLoading();
        } else if (activeSearchType.value === 'artist') {
          lxSearchResults.value = [];
          const results = await lxCatalogSearch(source.lxSourceId, query, 'artist', 1) as LxArtistSearchResult[];
          if (activeController.signal.aborted) return;
          for (const item of results) {
            (item as any).platform = source.lxSourceId!;
            (item as any).platformId = item.id;
            (item as any).pluginId = pluginId;
          }
          pluginArtistResults.value = results as unknown as PluginArtistResult[];
          watchCatalogCoverBackfill(
            () => pluginArtistResults.value,
            i => i.avatarUrl,
            next => { pluginArtistResults.value = next; },
          );
          hasMore.value = false;
        } else if (activeSearchType.value === 'album') {
          lxSearchResults.value = [];
          const results = await lxCatalogSearch(source.lxSourceId, query, 'album', 1) as LxAlbumSearchResult[];
          if (activeController.signal.aborted) return;
          for (const item of results) {
            (item as any).platform = source.lxSourceId!;
            (item as any).platformId = item.id;
            (item as any).pluginId = pluginId;
          }
          pluginAlbumResults.value = results as unknown as PluginAlbumResult[];
          watchCatalogCoverBackfill(
            () => pluginAlbumResults.value,
            i => i.coverUrl,
            next => { pluginAlbumResults.value = next; },
          );
          hasMore.value = false;
        } else {
          lxSearchResults.value = [];
          const results = await lxCatalogSearch(source.lxSourceId, query, 'playlist', 1) as LxPlaylistSearchResult[];
          if (activeController.signal.aborted) return;
          pluginPlaylistResults.value = results.map(item => ({
            ...item,
            platform: source.lxSourceId!,
            platformId: item.id,
            pluginId,
          }));
          hasMore.value = false;
        }
      } else if ((source.type === 'musicfree' || source.type === 'anime') && source.source) {
        lxSearchResults.value = [];
        localSearchResults.value = [];
        localArtistResults.value = [];
        localAlbumResults.value = [];
        localPlaylistResults.value = [];

        if (activeSearchType.value === 'track') {
          pluginArtistResults.value = [];
          pluginAlbumResults.value = [];
          pluginPlaylistResults.value = [];
          const results = await pluginSearch(source.source, query, 1, 30);
          if (activeController.signal.aborted) return;
          pluginSearchResults.value = results;
          hasMore.value = results.length >= 30;
          triggerMfCoverLoading(source.source);
          if (source.type === 'musicfree') {
            void backfillWyTrackMeta(source.source, results);
            void backfillQqTrackMeta(source.source, results);
          }
        } else if (activeSearchType.value === 'artist') {
          pluginSearchResults.value = [];
          if (pluginSupportsSearchType(source.source, 'artist')) {
            const results = await pluginArtistSearch(source.source, query, 1);
            if (activeController.signal.aborted) return;
            pluginArtistResults.value = results;
          } else {
            pluginArtistResults.value = [];
          }
          hasMore.value = false;
        } else if (activeSearchType.value === 'album') {
          pluginSearchResults.value = [];
          if (pluginSupportsSearchType(source.source, 'album')) {
            const results = await pluginAlbumSearch(source.source, query, 1);
            if (activeController.signal.aborted) return;
            pluginAlbumResults.value = results;
          } else {
            pluginAlbumResults.value = [];
          }
          hasMore.value = false;
        } else if (activeSearchType.value === 'playlist') {
          pluginSearchResults.value = [];
          if (pluginSupportsSearchType(source.source, 'sheet')) {
            const results = await pluginPlaylistSearch(source.source, query, 1);
            if (activeController.signal.aborted) return;
            pluginPlaylistResults.value = results;
          } else {
            pluginPlaylistResults.value = [];
          }
          hasMore.value = false;
        }
      }
    } catch (err) {
      if (!activeController.signal.aborted) {
        console.warn('[Search] failed:', err);
        lxSearchResults.value = [];
        pluginSearchResults.value = [];
        localSearchResults.value = [];
        localArtistResults.value = [];
        localAlbumResults.value = [];
        localPlaylistResults.value = [];
        pluginArtistResults.value = [];
        pluginAlbumResults.value = [];
        pluginPlaylistResults.value = [];
      }
    } finally {
      if (!activeController.signal.aborted) {
        searching.value = false;
        if (selectedSourceItem.value) {
          reportSearch(query, selectedSourceName.value, resultCount.value);
        }
      }
    }
  };

  const loadMore = async () => {
    if (loadingMore.value || !hasMore.value || searching.value) return;
    const query = searchQuery.value.trim();
    if (!query) return;
    if (isLocalSource.value) {
      hasMore.value = false;
      return;
    }

    loadingMore.value = true;
    const nextPage = currentPage.value + 1;
    try {
      const source = selectedSourceItem.value;
      if (!source) return;

      if (source.type === 'lx' && source.lxSourceId) {
        const result = await lxSearch(source.lxSourceId, query, nextPage);
        if (result.list.length > 0) {
          currentPage.value = nextPage;
          lxSearchResults.value = [...lxSearchResults.value, ...result.list];
          hasMore.value = result.list.length >= result.limit;
          triggerCoverLoading();
        } else {
          hasMore.value = false;
        }
      } else if ((source.type === 'musicfree' || source.type === 'anime') && source.source) {
        const results = await pluginSearch(source.source, query, nextPage, 30);
        if (results.length > 0) {
          currentPage.value = nextPage;
          pluginSearchResults.value = [...pluginSearchResults.value, ...results];
          hasMore.value = results.length >= 30;
          triggerMfCoverLoading(source.source);
          if (source.type === 'musicfree') {
            void backfillWyTrackMeta(source.source, results);
            void backfillQqTrackMeta(source.source, results);
          }
        } else {
          hasMore.value = false;
        }
      }
    } catch (err) {
      console.warn('[Search] loadMore failed:', err);
      hasMore.value = false;
    } finally {
      loadingMore.value = false;
    }
  };

  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastQueryLength = 0;
  watch(searchQuery, (newVal) => {
    const newLen = (newVal || '').length;
    if (newLen > lastQueryLength) {
      reportInputStats(newLen - lastQueryLength);
    }
    lastQueryLength = newLen;
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      performSearch();
    }, 400);
  });

  // 显式重搜信号（如失败页同关键词回车重搜）：立即执行，无需 debounce
  watch(searchRequestId, () => {
    if (!searchQuery.value.trim()) return;
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    performSearch();
  });

  watch(options.sources.selectedSourceId, () => {
    if (options.isRestoring()) return;
    performSearch();
  });

  watch(activeSearchType, () => {
    if (options.isRestoring()) return;
    performSearch();
  });

  onBeforeUnmount(() => {
    searchAbortController?.abort();
    searchAbortController = null;
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
  });

  return {
    searchQuery,
    searchRequestId,
    hasQuery,
    performSearch,
    loadMore,
  };
}
