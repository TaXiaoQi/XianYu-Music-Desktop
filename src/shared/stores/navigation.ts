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
  | 'statistics';

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
  const localMusicTab = ref<'default' | 'artist' | 'album'>('default');
  const currentArtistFilter = ref('');
  const currentAlbumFilter = ref('');
  const currentFolderFilter = ref('');
  const favTab = ref<'songs' | 'artists' | 'albums'>('songs');
  const favDetailFilter = ref<{ type: 'artist' | 'album'; name: string } | null>(null);
  const recentTab = ref<'songs' | 'playlists' | 'albums'>('songs');
  const activeRootPath = ref<string | null>(null);

  const searchHistory = ref<string[]>(loadSearchHistory());

  const setSearch = (query: string) => {
    searchQuery.value = query;
  };

  const addSearchHistory = (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    // 去重：移除已存在的相同记录
    const filtered = searchHistory.value.filter(item => item !== trimmed);
    // 放到最前面
    searchHistory.value = [trimmed, ...filtered].slice(0, MAX_HISTORY_ITEMS);
  };

  const removeSearchHistory = (query: string) => {
    searchHistory.value = searchHistory.value.filter(item => item !== query);
  };

  const clearSearchHistory = () => {
    searchHistory.value = [];
  };

  // 持久化到 localStorage
  watch(searchHistory, (val) => {
    try {
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(val));
    } catch { /* ignore */ }
  }, { deep: true });

  return {
    currentViewMode,
    filterCondition,
    searchQuery,
    localMusicTab,
    currentArtistFilter,
    currentAlbumFilter,
    currentFolderFilter,
    favTab,
    favDetailFilter,
    recentTab,
    activeRootPath,
    searchHistory,
    setSearch,
    addSearchHistory,
    removeSearchHistory,
    clearSearchHistory,
  };
});
