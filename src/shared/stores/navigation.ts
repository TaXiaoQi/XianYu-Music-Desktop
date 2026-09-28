import { ref, watch } from 'vue';
import { defineStore } from 'pinia';

/** 应用内可导航的主视图集合。 */
export type NavigationViewMode =
  | 'all' | 'folder' | 'artist' | 'album' | 'playlist'
  | 'recent' | 'favorites' | 'statistics'
  | 'leaderboard' | 'dailyRecommend' | 'topLists';

const SEARCH_HISTORY_KEY = 'search_history';
// 搜索历史最多保留条数。
const MAX_HISTORY_ITEMS = 20;

/** 启动时从 localStorage 恢复搜索历史；坏数据一律按空处理。 */
function readStoredSearchHistory(): string[] {
  try {
    const stored = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (stored === null || stored === '') return [];

    const decoded: unknown = JSON.parse(stored);
    if (!Array.isArray(decoded)) return [];

    const validEntries: string[] = [];
    for (const entry of decoded) {
      if (typeof entry === 'string') validEntries.push(entry);
    }
    return validEntries;
  } catch {
    return [];
  }
}

/** 组装导航域的全部状态与动作（以 ref 对象呈现，交由 Pinia 解包）。 */
function composeNavigationState() {
  const state = {
    currentViewMode: ref<NavigationViewMode>('all'),
    filterCondition: ref(''),
    searchQuery: ref(''),
    // 显式重搜信号：searchQuery 值未变化（如失败页同关键词回车重搜）时，watch(searchQuery) 不触发，
    // 靠递增此计数强制 Search 页重新执行一次 performSearch。
    searchRequestId: ref(0),
    localMusicTab: ref<'default' | 'artist' | 'album'>('default'),
    currentArtistFilter: ref(''),
    currentAlbumFilter: ref(''),
    currentFolderFilter: ref(''),
    favTab: ref<'songs' | 'playlists' | 'albums'>('songs'),
    activeRootPath: ref<string | null>(null),
    searchHistory: ref<string[]>(readStoredSearchHistory()),
  };

  const setSearch = (query: string) => {
    state.searchQuery.value = query;
  };

  const requestSearch = () => {
    state.searchRequestId.value += 1;
  };

  /** 新关键词置顶去重入库，并裁剪到上限条数。 */
  const addSearchHistory = (query: string) => {
    const keyword = query.trim();
    if (keyword === '') return;

    const deduped = state.searchHistory.value.filter(entry => entry !== keyword);
    state.searchHistory.value = [keyword, ...deduped].slice(0, MAX_HISTORY_ITEMS);
  };

  const removeSearchHistory = (query: string) => {
    state.searchHistory.value = state.searchHistory.value.filter(entry => entry !== query);
  };

  const clearSearchHistory = () => {
    state.searchHistory.value = [];
  };

  // 历史列表一旦变化就整体落盘；写失败（如隐私模式）静默忽略。
  watch(state.searchHistory, (entries) => {
    try {
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(entries));
    } catch { /* ignore */ }
  });

  return { ...state, setSearch, requestSearch, addSearchHistory, removeSearchHistory, clearSearchHistory };
}

export const useNavigationStore = defineStore('navigation', composeNavigationState);
