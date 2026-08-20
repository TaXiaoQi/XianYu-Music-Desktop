<script setup lang="ts">
import { X, Clock, Trash2, Flame } from 'lucide-vue-next';
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { useThemeSettings } from '../../composables/useThemeSettings';
import { useAnnouncement } from '../../composables/useAnnouncement';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { windowApi } from '../../services/tauri/windowApi';
import { useAuthStore } from '../../features/auth/store';
import { useNavigationStore } from '../../shared/stores/navigation';
import { useSettings } from '../../features/settings/useSettings';
import { useI18n } from '../../features/i18n';
import { normalizeTopBarLayout } from '../../features/settings/topBarItems';
import { useUiStore } from '../../shared/stores/ui';
import { fetchHotSearch, type HotSearchItem } from '../../services/usageStats';
import SongRecognitionPanel from '../overlays/SongRecognitionPanel.vue';
import TopBarControlItem from './TopBarControlItem.vue';
import TopBarControlIcon from './TopBarControlIcon.vue';

const router = useRouter();
const route = useRoute();

// 听歌识曲面板（UI 已就绪，识别逻辑后面实现）
const showRecognition = ref(false);
const toggleRecognition = () => {
  showRecognition.value = !showRecognition.value;
};
const { searchQuery, setSearch, isMiniMode } = usePlayerViewState();
const appWindow = getCurrentWindow();
const { settings, topBarLayout } = useSettings();
const { t } = useI18n();
const { theme, isDarkTheme, toggleThemeMode, setThemeMode } = useThemeSettings();
const uiStore = useUiStore();
const { manualCheckAnnouncement, isFetchingAnnouncement } = useAnnouncement();
const authStore = useAuthStore();
const navigationStore = useNavigationStore();
const rotation = ref(0); // For settings icon animation
const lastNonSettingsRoute = ref(route.path === '/settings' ? '/' : route.fullPath);
const isSettingsRoute = computed(() => route.path === '/settings');
const isAuthRoute = computed(() => route.path === '/auth');
const hasCustomBackground = computed(() => (
  theme.value.mode === 'custom' && Boolean(theme.value.customBackground.imagePath)
));
const themeToggleTitle = computed(() => {
  if (hasCustomBackground.value) {
    return isDarkTheme.value ? t('topbar.darkText') : t('topbar.lightText');
  }

  return isDarkTheme.value ? t('topbar.lightTheme') : t('topbar.darkTheme');
});

// --- 顶部栏容器化布局 ---
const layout = computed(() => normalizeTopBarLayout(topBarLayout.value));
const leftControls = computed(() => layout.value.left);
const rightControls = computed(() => layout.value.right);

const accountTitle = computed(() =>
  authStore.isLoggedIn
    ? (authStore.user?.nickname || authStore.user?.username || t('topbar.profile'))
    : t('topbar.login'),
);
const accountAvatar = computed(() => (authStore.isLoggedIn ? authStore.user?.avatar ?? null : null));
const accountInitial = computed(() =>
  (authStore.user?.nickname || authStore.user?.username || '?').slice(0, 1).toUpperCase(),
);

// --- 搜索历史 ---
const showHistory = ref(false);
const searchInputRef = ref<HTMLInputElement | null>(null);

// --- 热搜（大家都在搜） ---
const searchTab = ref<'hot' | 'history'>('hot');
const hotSearchList = ref<HotSearchItem[]>([]);
const hotSearchLoading = ref(false);
let hotSearchLoadedAt = 0;
const HOT_SEARCH_CACHE_MS = 5 * 60 * 1000;

// 逐条渐进展示：面板保持完整形态，内容一条条浮现，避免等云端返回后整体跳动
const revealedCount = ref(0);
let revealTimer: ReturnType<typeof setTimeout> | null = null;

const clearRevealTimer = () => {
  if (revealTimer) {
    clearTimeout(revealTimer);
    revealTimer = null;
  }
};

// 重置计数并让列表逐条出现（条数少也逐条，保证每次都有进入动画）
// 首条做一点延迟，避免逐条下滑与面板整体淡入重叠、抢走"淡进淡出"的视觉
const REVEAL_START_DELAY_MS = 140;
const startReveal = (count: number) => {
  clearRevealTimer();
  revealedCount.value = 0;
  if (count <= 0) return;
  let i = 0;
  const begin = () => {
    i += 1;
    revealedCount.value = i;
    if (i < count) revealTimer = setTimeout(begin, 50);
  };
  revealTimer = setTimeout(begin, REVEAL_START_DELAY_MS);
};

const visibleHotList = computed(() => hotSearchList.value.slice(0, revealedCount.value));
const visibleHistoryList = computed(() =>
  navigationStore.searchHistory.slice(0, revealedCount.value),
);

// 切换 Tab：重新逐条出现当前 Tab 的内容
const switchSearchTab = (tab: 'hot' | 'history') => {
  searchTab.value = tab;
  startReveal(tab === 'hot' ? hotSearchList.value.length : navigationStore.searchHistory.length);
};

// 搜索记录变化时（当前为记录 Tab）重新逐条出现
watch(
  () => navigationStore.searchHistory.length,
  (count) => {
    if (searchTab.value === 'history') startReveal(count);
  },
);

const loadHotSearch = async () => {
  if (hotSearchLoading.value) return;
  const now = Date.now();
  if (hotSearchList.value.length && now - hotSearchLoadedAt < HOT_SEARCH_CACHE_MS) {
    // 缓存命中：直接复用数据，在热搜 Tab 下逐条浮现
    if (searchTab.value === 'hot') startReveal(hotSearchList.value.length);
    return;
  }
  hotSearchLoading.value = true;
  // 仅在热搜 Tab 激活时重置逐条动画；历史 Tab 的动画由 handleSearchFocus/switchSearchTab 管理，
  // 这里清掉会把刚启动的历史记录逐条浮现打断（revealedCount 卡在 0 → 面板空白）
  if (searchTab.value === 'hot') {
    clearRevealTimer();
    revealedCount.value = 0;
  }
  const list = await fetchHotSearch(10);
  hotSearchList.value = list;
  hotSearchLoadedAt = Date.now();
  hotSearchLoading.value = false;
  if (searchTab.value === 'hot') startReveal(list.length);
};

const handleInput = (e: Event) => {
  setSearch((e.target as HTMLInputElement).value);
};

const handleSearchEnter = () => {
  const query = searchQuery.value.trim();
  if (!query) return;
  navigationStore.addSearchHistory(query);
  showHistory.value = false;
  void router.push('/search');
};

const handleSearchFocus = () => {
  showHistory.value = true;
  // 每次重新打开面板都逐条出现当前 Tab 内容；热搜由 loadHotSearch 就绪后触发
  if (searchTab.value === 'history') startReveal(navigationStore.searchHistory.length);
  void loadHotSearch();
};

let searchBlurTimer: ReturnType<typeof setTimeout> | null = null;

const handleSearchBlur = () => {
  // 延迟关闭，以便点击历史项时能先触发
  searchBlurTimer = setTimeout(() => { showHistory.value = false; searchBlurTimer = null; }, 200);
};

const handleSelectHistory = (item: string) => {
  setSearch(item);
  navigationStore.addSearchHistory(item);
  showHistory.value = false;
  void router.push('/search');
};

const handleRemoveHistory = (e: MouseEvent, item: string) => {
  e.stopPropagation();
  navigationStore.removeSearchHistory(item);
};

const handleClearHistory = () => {
  navigationStore.clearSearchHistory();
};

const goBack = () => { router.back(); };

const toggleSettingsPage = () => {
  if (isSettingsRoute.value) {
    void router.push(lastNonSettingsRoute.value);
  } else {
    lastNonSettingsRoute.value = route.fullPath;
    void router.push('/settings');
  }
};

const openColorScheme = () => {
  // 切换到自定义皮肤并直接打开自定义配色弹窗
  setThemeMode('custom');
  uiStore.showCustomSkinModal = true;
};

const openAccountPage = () => {
  void router.push('/auth');
};

// 给 TopBarControlItem 提供渲染上下文
provide('topBarContext', {
  isDarkTheme,
  goBack,
  toggleRecognition,
  themeToggleTitle,
  toggleThemeMode,
  isFetchingAnnouncement,
  manualCheckAnnouncement,
  isSettingsRoute,
  settingsRotation: rotation,
  toggleSettingsPage,
  isAuthRoute,
  isLoggedIn: computed(() => authStore.isLoggedIn),
  accountTitle,
  accountAvatar,
  accountInitial,
  openAccountPage,
  openColorScheme,
});

const minimize = () => { void appWindow.minimize(); };
const { isImmersiveFullscreen, fullscreenAnimState } = storeToRefs(useUiStore());
// 系统全屏（沉浸模式）进行中或已激活时禁用最大化按钮，避免与全屏窗口状态冲突
const isMaximizeDisabled = computed(
  () => isImmersiveFullscreen.value || fullscreenAnimState.value !== null,
);
const toggleMaximize = () => {
  if (isMaximizeDisabled.value) return;
  void windowApi.smartToggleMaximize();
};
const closeWindow = async () => {
  if (settings.value.closeToTray) {
    await appWindow.hide();
  } else {
    await appWindow.close();
  }
};

onMounted(() => {
  // 启动时尝试恢复登录态（非阻塞）
  if (!authStore.initialized) {
    void authStore.restoreSession();
  }
});

onUnmounted(() => {
  if (searchBlurTimer) {
    clearTimeout(searchBlurTimer);
    searchBlurTimer = null;
  }
});
</script>

<template>
  <div
    data-tauri-drag-region
    class="h-16 flex items-center gap-3 px-6 select-none shrink-0 relative z-[60]"
  >
    <div class="flex items-center gap-4 relative z-10 shrink-0">
      <TopBarControlItem v-for="key in leftControls" :key="key" :item-key="key" />
    </div>

    <div class="group flex-1 min-w-0 max-w-[32rem] mx-auto bg-white/5 dark:bg-white/5 hover:bg-white/10 dark:hover:bg-white/10 focus-within:bg-white/20 dark:focus-within:bg-white/10 focus-within:ring-2 focus-within:ring-[#EC4141]/20 pl-5 pr-4 py-2.5 rounded-full flex items-center transition-all border border-black/10 dark:border-white/20 z-10 relative">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0 text-gray-900 dark:text-gray-100 mr-3 group-focus-within:text-[#EC4141]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        ref="searchInputRef"
        type="text"
        :placeholder="t('topbar.search')"
        class="bg-transparent outline-none min-w-0 w-full placeholder-gray-700 dark:placeholder-gray-300 text-gray-800 dark:text-gray-100 text-sm font-medium"
        :value="searchQuery"
        @input="handleInput"
        @keydown.enter="handleSearchEnter"
        @focus="handleSearchFocus"
        @blur="handleSearchBlur"
      />
      <button v-if="searchQuery" @click="setSearch('')" class="text-gray-500 dark:text-gray-400 hover:text-[#EC4141] ml-2 shrink-0 cursor-pointer">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
        </svg>
      </button>

      <div class="w-px h-5 bg-black/10 dark:bg-white/15 mx-2 shrink-0"></div>

      <!-- 听歌识曲（随搜索框固定） -->
      <button
        @click.stop="toggleRecognition"
        class="text-gray-500 dark:text-gray-400 hover:text-[#EC4141] ml-1 shrink-0 cursor-pointer transition-colors"
        :title="t('topbar.recognize')"
        :aria-label="t('topbar.recognize')"
      >
        <TopBarControlIcon item-key="recognize" class="h-5 w-5" />
      </button>

      <!-- 搜索历史下拉（热搜 / 记录 双 Tab） -->
      <Transition name="search-history-fade">
        <div v-if="showHistory" @mousedown.prevent class="absolute top-full left-2 right-2 mt-1 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-black/5 dark:border-white/10 z-50 h-72 overflow-y-auto overflow-x-hidden">
          <!-- 顶部 Tab 切换：热搜左 / 记录右 -->
          <div class="px-3 pt-2 pb-1.5 border-b border-black/5 dark:border-white/5 flex items-center gap-1 sticky top-0 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl">
            <button
              @click="switchSearchTab('hot')"
              :class="searchTab === 'hot' ? 'bg-[#EC4141]/10 text-[#EC4141] font-medium' : 'text-black/50 dark:text-white/50 hover:text-black/70 dark:hover:text-white/70'"
              class="px-3 py-1 rounded-full text-xs transition-colors cursor-pointer"
            >{{ t('topbar.hotSearch') }}</button>
            <button
              @click="switchSearchTab('history')"
              :class="searchTab === 'history' ? 'bg-[#EC4141]/10 text-[#EC4141] font-medium' : 'text-black/50 dark:text-white/50 hover:text-black/70 dark:hover:text-white/70'"
              class="px-3 py-1 rounded-full text-xs transition-colors cursor-pointer"
            >{{ t('topbar.history') }}</button>
          </div>

          <!-- 热搜页 -->
          <div v-if="searchTab === 'hot'" class="py-1">
            <div class="px-3 py-1.5 flex items-center text-xs text-black/40 dark:text-white/40 font-medium tracking-wide">
              <Flame class="h-3.5 w-3.5 mr-1.5 text-[#EC4141]" />
              {{ t('topbar.everyoneSearching') }}
            </div>
            <div v-if="hotSearchLoading && !hotSearchList.length" class="px-3 py-4 text-center text-xs text-black/40 dark:text-white/40">
              {{ t('topbar.hotSearchLoading') }}
            </div>
            <div v-else-if="!hotSearchList.length" class="px-3 py-4 text-center text-xs text-black/40 dark:text-white/40">
              {{ t('topbar.hotSearchEmpty') }}
            </div>
            <TransitionGroup v-else tag="div" name="hot-reveal">
              <button
                v-for="(item, index) in visibleHotList"
                :key="item.keyword"
                class="w-full text-left px-3 py-1.5 text-sm text-black/70 dark:text-white/70 hover:text-[#EC4141] hover:bg-[#EC4141]/5 dark:hover:bg-[#EC4141]/10 flex items-center gap-2 cursor-pointer transition-colors group"
                @click="handleSelectHistory(item.keyword)"
              >
                <span
                  :class="index < 3 ? 'text-[#EC4141]' : 'text-black/30 dark:text-white/30'"
                  class="w-4 shrink-0 text-center text-xs font-bold"
                >{{ index + 1 }}</span>
                <span class="truncate">{{ item.keyword }}</span>
              </button>
            </TransitionGroup>
          </div>

          <!-- 记录页 -->
          <div v-else class="py-1">
            <div class="px-3 py-1.5 flex items-center justify-between">
              <div class="flex items-center text-xs text-black/50 dark:text-white/50 font-medium tracking-wide">
                <Clock class="h-3.5 w-3.5 mr-1.5" />
                {{ t('topbar.searchHistory') }}
              </div>
              <button @click="handleClearHistory" class="text-[11px] text-black/40 dark:text-white/40 hover:text-[#EC4141] flex items-center transition-colors cursor-pointer">
                <Trash2 class="h-3 w-3 mr-0.5" />
                {{ t('topbar.clearHistory') }}
              </button>
            </div>
            <div v-if="!navigationStore.searchHistory.length" class="px-3 py-4 text-center text-xs text-black/40 dark:text-white/40">
              {{ t('topbar.historyEmpty') }}
            </div>
            <TransitionGroup
              v-else
              tag="div"
              name="hot-reveal"
            >
              <button
                v-for="item in visibleHistoryList"
                :key="item"
                class="w-full text-left px-3 py-1.5 text-sm text-black/70 dark:text-white/70 hover:text-[#EC4141] hover:bg-[#EC4141]/5 dark:hover:bg-[#EC4141]/10 flex items-center justify-between gap-2 cursor-pointer transition-colors group"
                @click="handleSelectHistory(item)"
              >
                <span class="truncate">{{ item }}</span>
                <span
                  class="text-black/30 dark:text-white/30 group-hover:text-[#EC4141] p-0.5 shrink-0 transition-colors"
                  @click.stop="handleRemoveHistory($event, item)"
                >
                  <X class="h-3 w-3" />
                </span>
              </button>
            </TransitionGroup>
          </div>
        </div>
      </Transition>
    </div>

    <div class="flex items-center gap-2 relative z-10 shrink-0">
      <TopBarControlItem v-for="key in rightControls" :key="key" :item-key="key" />
      <div class="h-4 w-px bg-gray-400/30 mx-2"></div>
      <div class="flex items-center gap-1">
        <button @click.stop="isMiniMode = true" class="p-2 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors cursor-pointer" :title="t('topbar.miniMode')">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" stroke-width="2" /><rect x="12" y="12" width="6" height="4" rx="1" stroke-width="2" /></svg>
        </button>
        <button @click.stop="minimize" class="p-2 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors cursor-pointer" :title="t('topbar.minimize')"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 12H6" /></svg></button>
        <button
          @click.stop="toggleMaximize"
          :disabled="isMaximizeDisabled"
          :title="isMaximizeDisabled ? t('topbar.maximizeUnavailable') : t('topbar.maximize')"
          :class="[
            'p-2 rounded-md transition-colors',
            isMaximizeDisabled
              ? 'opacity-40 cursor-not-allowed text-gray-400 dark:text-gray-500'
              : 'text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer',
          ]"
        ><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" stroke-width="2" /></svg></button>
        <button @click.stop="closeWindow" class="p-2 text-gray-900 dark:text-gray-100 hover:text-white hover:bg-[#EC4141] rounded-md transition-colors cursor-pointer" :title="t('topbar.close')"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
      </div>
    </div>
  </div>

  <SongRecognitionPanel v-if="showRecognition" @close="showRecognition = false" />
</template>

<style scoped>
.search-history-fade-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.search-history-fade-leave-active {
  transition: opacity 0.1s ease, transform 0.1s ease;
}

.search-history-fade-enter-from,
.search-history-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.hot-reveal-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.hot-reveal-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
