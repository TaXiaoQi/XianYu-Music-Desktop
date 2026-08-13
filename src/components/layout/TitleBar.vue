<script setup lang="ts">
import { X, Clock, Trash2 } from 'lucide-vue-next';
import { computed, onMounted, onUnmounted, provide, ref } from 'vue';
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
import { normalizeTopBarLayout } from '../../features/settings/topBarItems';
import { useUiStore } from '../../shared/stores/ui';
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
    return isDarkTheme.value ? '切换深色字体' : '切换浅色字体';
  }

  return isDarkTheme.value ? '切换浅色' : '切换深色';
});

// --- 顶部栏容器化布局 ---
const layout = computed(() => normalizeTopBarLayout(topBarLayout.value));
const leftControls = computed(() => layout.value.left);
const rightControls = computed(() => layout.value.right);

const accountTitle = computed(() =>
  authStore.isLoggedIn
    ? (authStore.user?.nickname || authStore.user?.username || '个人中心')
    : '登录 / 注册',
);
const accountAvatar = computed(() => (authStore.isLoggedIn ? authStore.user?.avatar ?? null : null));
const accountInitial = computed(() =>
  (authStore.user?.nickname || authStore.user?.username || '?').slice(0, 1).toUpperCase(),
);

// --- 搜索历史 ---
const showHistory = ref(false);
const searchInputRef = ref<HTMLInputElement | null>(null);

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
        placeholder="搜索音乐..."
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
        title="听歌识曲"
        aria-label="听歌识曲"
      >
        <TopBarControlIcon item-key="recognize" class="h-5 w-5" />
      </button>

      <!-- 搜索历史下拉 -->
      <Transition name="search-history-fade">
        <div v-if="showHistory && navigationStore.searchHistory.length" class="absolute top-full left-2 right-2 mt-1 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-black/5 dark:border-white/10 z-50 max-h-60 overflow-y-auto overflow-x-hidden">
        <div class="px-3 py-2 border-b border-black/5 dark:border-white/5 flex items-center justify-between">
          <div class="flex items-center text-xs text-black/50 dark:text-white/50 font-medium tracking-wide">
            <Clock class="h-3.5 w-3.5 mr-1.5" />
            搜索历史
          </div>
          <button @click="handleClearHistory" class="text-[11px] text-black/40 dark:text-white/40 hover:text-[#EC4141] flex items-center transition-colors cursor-pointer">
            <Trash2 class="h-3 w-3 mr-0.5" />
            清空
          </button>
        </div>
        <div class="py-1">
          <button
            v-for="item in navigationStore.searchHistory"
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
        </div>
      </div>
      </Transition>
    </div>

    <div class="flex items-center gap-2 relative z-10 shrink-0">
      <TopBarControlItem v-for="key in rightControls" :key="key" :item-key="key" />
      <div class="h-4 w-px bg-gray-400/30 mx-2"></div>
      <div class="flex items-center gap-1">
        <button @click.stop="isMiniMode = true" class="p-2 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors cursor-pointer" title="Mini 模式">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" stroke-width="2" /><rect x="12" y="12" width="6" height="4" rx="1" stroke-width="2" /></svg>
        </button>
        <button @click.stop="minimize" class="p-2 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 12H6" /></svg></button>
        <button
          @click.stop="toggleMaximize"
          :disabled="isMaximizeDisabled"
          :title="isMaximizeDisabled ? '全屏模式下不可用' : '最大化'"
          :class="[
            'p-2 rounded-md transition-colors',
            isMaximizeDisabled
              ? 'opacity-40 cursor-not-allowed text-gray-400 dark:text-gray-500'
              : 'text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer',
          ]"
        ><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" stroke-width="2" /></svg></button>
        <button @click.stop="closeWindow" class="p-2 text-gray-900 dark:text-gray-100 hover:text-white hover:bg-[#EC4141] rounded-md transition-colors cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
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
</style>