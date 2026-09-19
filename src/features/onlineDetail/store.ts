
import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { PluginPlaylistSearchResult, PluginSource } from '../../types';
import router from '../../router';

export type OnlineDetailType = 'artist' | 'album' | 'playlist' | 'user';

export type SourceSearchType = 'track' | 'artist' | 'album' | 'playlist';

export interface SearchResultsSnapshot {
  hasMore: boolean;
  currentPage: number;
  lists: Record<string, unknown[]>;
  scrollTop?: number;
}

export interface SearchPageCache {
  selectedSourceId: string;
  activeSearchType: SourceSearchType;
  snapshot: SearchResultsSnapshot;
}

export interface TopListsCache {
  sourceList: Array<{ id: string; name: string; source: PluginSource }>;
  selectedSourceId: string;
  topLists: PluginPlaylistSearchResult[];
  gridScrollTop: number;
  gridViewportHeight: number;
  gridWidth: number;
}

export interface OnlineDetailStateCache {
  songs: any[];
  albums: any[];
  activeTab: string;
  scrollTop: number;
  userFavorites?: any[];
  userPlaylists?: Array<{ id: string; name: string; cloudCoverUrl?: string; songs?: any[] }>;
}

export interface OnlineDetailContext {
  type: OnlineDetailType;
  title: string;
  subtitle: string;
  coverUrl: string;
  description?: string;
  pluginSource?: PluginSource;
  rawData: any;
  platformId?: string;
  engineType?: 'musicfree' | 'lx';
  lxSourceId?: string;
  origin?: 'toplist';
}

export interface OnlineDetailFrame {
  context: OnlineDetailContext;
  state?: OnlineDetailStateCache;
  d: number;
}

export const useOnlineDetailStore = defineStore('onlineDetail', () => {
  const searchPageCache = ref<SearchPageCache | null>(null);
  const topListsCache = ref<TopListsCache | null>(null);
  const detailStack = ref<OnlineDetailFrame[]>([]);
  const currentDetail = ref<OnlineDetailFrame | null>(null);
  let navToken = 0;

  const openDetail = (context: OnlineDetailContext, state?: OnlineDetailStateCache): number => {
    const d = navToken + 1;
    if (currentDetail.value && router.currentRoute.value.path === '/online-detail') {
      detailStack.value.push(
        state ? { ...currentDetail.value, state } : currentDetail.value,
      );
    } else {
      detailStack.value = [];
    }
    currentDetail.value = { context, d };
    navToken = d;
    return d;
  };

  const setTopFrameState = (state: OnlineDetailStateCache) => {
    const top = detailStack.value[detailStack.value.length - 1];
    if (top) detailStack.value.splice(detailStack.value.length - 1, 1, { ...top, state });
  };

  const popDetail = (): OnlineDetailFrame | null => {
    const frame = detailStack.value.pop() ?? null;
    if (frame) currentDetail.value = frame;
    return frame;
  };

  const canPopDetail = (): boolean => detailStack.value.length > 0;

  const clearDetailFlow = () => {
    detailStack.value = [];
    currentDetail.value = null;
  };

  const setSearchPageCache = (cache: SearchPageCache | null) => {
    searchPageCache.value = cache;
  };

  const consumeSearchPageCache = (): SearchPageCache | null => {
    const cache = searchPageCache.value;
    searchPageCache.value = null;
    return cache;
  };

  const clearSearchPageCache = () => {
    searchPageCache.value = null;
  };

  const setTopListsCache = (cache: TopListsCache | null) => {
    topListsCache.value = cache;
  };

  const consumeTopListsCache = (): TopListsCache | null => {
    const cache = topListsCache.value;
    topListsCache.value = null;
    return cache;
  };

  const clearTopListsCache = () => {
    topListsCache.value = null;
  };

  return {
    searchPageCache,
    topListsCache,
    detailStack,
    currentDetail,
    openDetail,
    setTopFrameState,
    popDetail,
    canPopDetail,
    clearDetailFlow,
    setSearchPageCache,
    consumeSearchPageCache,
    clearSearchPageCache,
    setTopListsCache,
    consumeTopListsCache,
    clearTopListsCache,
  };
});

export function openOnlineDetail(context: OnlineDetailContext, state?: OnlineDetailStateCache): number {
  const inFlow = router.currentRoute.value.path === '/online-detail';
  const store = useOnlineDetailStore();
  const d = store.openDetail(context, state);
  void (inFlow ? router.replace : router.push)({
    path: '/online-detail',
    query: { type: context.type, d: String(d) },
  });
  return d;
}
