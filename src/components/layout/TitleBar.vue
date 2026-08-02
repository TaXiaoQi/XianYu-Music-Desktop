<script setup lang="ts">
import { Moon, Sun, Bell, X, Clock, Trash2 } from 'lucide-vue-next';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { useThemeSettings } from '../../composables/useThemeSettings';
import { useAnnouncement } from '../../composables/useAnnouncement';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAuthStore } from '../../features/auth/store';
import { useNavigationStore } from '../../shared/stores/navigation';
import { useSettings } from '../../features/settings/useSettings';

const router = useRouter();
const route = useRoute();
const { searchQuery, setSearch, isMiniMode } = usePlayerViewState();
const appWindow = getCurrentWindow();
const { settings } = useSettings();
const { theme, isDarkTheme, toggleThemeMode } = useThemeSettings();
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

const handleSearchBlur = () => {
  // 延迟关闭，以便点击历史项时能先触发
  setTimeout(() => { showHistory.value = false; }, 200);
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

const openAccountPage = () => {
  void router.push('/auth');
};

const minimize = () => { void appWindow.minimize(); };
const toggleMaximize = () => { void appWindow.toggleMaximize(); };
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
</script>

<template>
  <div
    data-tauri-drag-region
    class="h-16 flex items-center gap-3 px-6 select-none shrink-0 relative z-[60]"
  >
    <div class="flex items-center gap-4 relative z-10 shrink-0">
      <button
        @click="goBack"
        class="w-8 h-8 rounded-full bg-white/5 dark:bg-white/5 hover:bg-white/20 dark:hover:bg-white/20 flex items-center justify-center text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white transition-colors focus:outline-none cursor-pointer border border-black/10 dark:border-white/10"
        title="后退"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 -ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
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

      <!-- 搜索历史下拉 -->
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
    </div>

    <div class="flex items-center gap-2 relative z-10 shrink-0">
      <button
        type="button"
        class="p-2 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors cursor-pointer"
        :title="themeToggleTitle"
        :aria-label="themeToggleTitle"
        @click.stop="toggleThemeMode"
      >
        <Sun v-if="isDarkTheme" class="h-5 w-5" :stroke-width="2" />
        <Moon v-else class="h-5 w-5" :stroke-width="2" />
      </button>
      <button
        type="button"
        class="p-2 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors cursor-pointer"
        :class="{ 'opacity-50 pointer-events-none': isFetchingAnnouncement }"
        title="公告"
        aria-label="查看公告"
        @click.stop="manualCheckAnnouncement"
      >
        <Bell class="h-5 w-5" :stroke-width="2" />
      </button>
      <button
        type="button"
        class="rounded-md p-2 transition-all duration-300 ease-out cursor-pointer"
        :class="isSettingsRoute
          ? 'text-[#EC4141] dark:text-[#ff8b8b]'
          : 'text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5'"
        :aria-pressed="isSettingsRoute"
        @click.stop="toggleSettingsPage"
        title="设置"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-5 w-5 transition-transform duration-300 ease-out"
          :style="{ transform: `rotate(${rotation}deg)` }"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
      <button
        type="button"
        class="p-1 rounded-md transition-colors cursor-pointer relative"
        :class="isAuthRoute
          ? 'text-[#EC4141] dark:text-[#ff8b8b]'
          : 'text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5'"
        :title="authStore.isLoggedIn ? (authStore.user?.nickname || authStore.user?.username || '个人中心') : '登录 / 注册'"
        :aria-label="authStore.isLoggedIn ? '个人中心' : '登录 / 注册'"
        @click.stop="openAccountPage"
      >
        <img
          v-if="authStore.isLoggedIn && authStore.user?.avatar"
          :src="authStore.user.avatar"
          alt=""
          class="h-6 w-6 rounded-full object-cover"
        />
        <span
          v-else-if="authStore.isLoggedIn"
          class="grid h-6 w-6 place-items-center rounded-full bg-[#EC4141] text-white text-[11px] font-bold"
        >
          {{ (authStore.user?.nickname || authStore.user?.username || '?').slice(0, 1).toUpperCase() }}
        </span>
        <svg
          v-else
          xmlns="http://www.w3.org/2000/svg"
          class="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      </button>
      <div class="h-4 w-px bg-gray-400/30 mx-2"></div>
      <div class="flex items-center gap-1">
        <button @click.stop="isMiniMode = true" class="p-2 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors cursor-pointer" title="Mini 模式">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" stroke-width="2" /><rect x="12" y="12" width="6" height="4" rx="1" stroke-width="2" /></svg>
        </button>
        <button @click.stop="minimize" class="p-2 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 12H6" /></svg></button>
        <button @click.stop="toggleMaximize" class="p-2 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" stroke-width="2" /></svg></button>
        <button @click.stop="closeWindow" class="p-2 text-gray-900 dark:text-gray-100 hover:text-white hover:bg-[#EC4141] rounded-md transition-colors cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
      </div>
    </div>
  </div>
</template>
