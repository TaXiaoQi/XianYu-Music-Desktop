import { ref, watch } from 'vue';
import { defineStore } from 'pinia';

export type NavigationViewMode =
  | 'all'
  | 'folder'
  | 'artist'
  | 'album'
  | 'playlist'
  | 'recent'
  | 'favorites'
  | 'statistics'
  | 'dailyRecommend'
  | 'topLists';

const SEARCH_HISTORY_KEY = 'search_history';
const MAX_HISTORY_ITEMS = 20;

function loadSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(v => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export const useNavigationStore = defineStore('navigation', () => {
  const currentViewMode = ref<NavigationViewMode>('all');
  const filterCondition = ref('');
  const searchQuery = ref('');
  // 显式重搜信号：searchQuery 值未变化（如失败页同关键词回车重搜）时，watch(searchQuery) 不触发，
  // 靠递增此计数强制 Search 页重新执行一次 performSearch。
  const searchRequestId = ref(0);
  const localMusicTab = ref<'default' | 'artist' | 'album'>('default');
  const currentArtistFilter = ref('');
  const currentAlbumFilter = ref('');
  const currentFolderFilter = ref('');
  const favTab = ref<'songs' | 'playlists' | 'albums'>('songs');
  const activeRootPath = ref<string | null>(null);

  const searchHistory = ref<string[]>(loadSearchHistory());

  const setSearch = (query: string) => {
    searchQuery.value = query;
  };

  const requestSearch = () => {
    searchRequestId.value += 1;
  };

  const addSearchHistory = (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const filtered = searchHistory.value.filter(item => item !== trimmed);
    searchHistory.value = [trimmed, ...filtered].slice(0, MAX_HISTORY_ITEMS);
  };

  const removeSearchHistory = (query: string) => {
    searchHistory.value = searchHistory.value.filter(item => item !== query);
  };

  const clearSearchHistory = () => {
    searchHistory.value = [];
  };

  watch(searchHistory, (val) => {
    try {
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(val));
    } catch { /* ignore */ }
  });

  return {
    currentViewMode,
    filterCondition,
    searchQuery,
    searchRequestId,
    localMusicTab,
    currentArtistFilter,
    currentAlbumFilter,
    currentFolderFilter,
    favTab,
    activeRootPath,
    searchHistory,
    setSearch,
    requestSearch,
    addSearchHistory,
    removeSearchHistory,
    clearSearchHistory,
  };
});
