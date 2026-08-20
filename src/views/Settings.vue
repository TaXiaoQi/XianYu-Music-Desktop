<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue';
import { Search, X } from 'lucide-vue-next';
import { useRoute, useRouter } from 'vue-router';

// 懒加载设置子组件：用户通常只访问 1-2 个设置页，按需加载可显著减少首屏 JS 体积和解析时间
const SettingsAbout = defineAsyncComponent(() => import("../components/settings/SettingsAbout.vue"));
const SettingsAccount = defineAsyncComponent(() => import("../components/settings/SettingsAccount.vue"));
const SettingsDesktopLyrics = defineAsyncComponent(() => import("../components/settings/SettingsDesktopLyrics.vue"));
const SettingsGeneral = defineAsyncComponent(() => import("../components/settings/SettingsGeneral.vue"));
const SettingsLibrary = defineAsyncComponent(() => import("../components/settings/SettingsLibrary.vue"));
const SettingsPlugins = defineAsyncComponent(() => import("../components/settings/SettingsPlugins.vue"));
const SettingsShortcuts = defineAsyncComponent(() => import("../components/settings/SettingsShortcuts.vue"));
const SettingsTheme = defineAsyncComponent(() => import("../components/settings/SettingsTheme.vue"));
const SettingsToolbox = defineAsyncComponent(() => import("../components/settings/SettingsToolbox.vue"));
const SettingsAudioOutput = defineAsyncComponent(() => import("../components/settings/SettingsAudioOutput.vue"));
const SettingsDownload = defineAsyncComponent(() => import("../components/settings/SettingsDownload.vue"));
const SettingsDebug = defineAsyncComponent(() => import("../components/settings/SettingsDebug.vue"));
const SettingsAdvanced = defineAsyncComponent(() => import("../components/settings/SettingsAdvanced.vue"));
import { useDeveloperMode } from '../features/settings/developerMode';
import {
  searchSettings,
  type SettingsSearchItem,
  type SettingsTabId,
} from '../features/settings/searchIndex';
import { clamp } from '../utils/math';
import { useI18n } from '../features/i18n';

type SettingsViewTabId = SettingsTabId | 'debug';

const VALID_TABS: SettingsViewTabId[] = ['general', 'theme', 'desktopLyrics', 'audioOutput', 'download', 'toolbox', 'library', 'plugins', 'shortcuts', 'account', 'advanced', 'debug', 'about'];

const route = useRoute();
const router = useRouter();
const { isDeveloperMode } = useDeveloperMode();
const { t } = useI18n();

const canOpenTab = (tab: string): tab is SettingsViewTabId => (
  VALID_TABS.includes(tab as SettingsViewTabId) && (tab !== 'debug' || isDeveloperMode.value)
);

const initialTab = (() => {
  const q = route.query.tab as string | undefined;
  return (q && canOpenTab(q)) ? q : 'general';
})();

const activeTab = ref<SettingsViewTabId>(initialTab);
const mainRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const settingsQuery = ref('');
const activeSearchResultIndex = ref(0);
const searchResults = computed(() => searchSettings(settingsQuery.value));
let highlightTimer: ReturnType<typeof setTimeout> | null = null;

// --- 侧边栏拖拽调整宽度逻辑 ---
const STORAGE_KEY_SIDEBAR_WIDTH = 'settings_sidebar_width';
const DEFAULT_SIDEBAR_WIDTH = 160;
const MIN_SIDEBAR_WIDTH = 120;
const MAX_SIDEBAR_WIDTH = 320;

const loadInitialSidebarWidth = (): number => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_SIDEBAR_WIDTH);
    if (saved) {
      const parsed = Number.parseInt(saved, 10);
      if (!Number.isNaN(parsed)) {
        return clamp(parsed, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
      }
    }
  } catch {}
  return DEFAULT_SIDEBAR_WIDTH;
};

const sidebarWidth = ref(loadInitialSidebarWidth());
const isResizingSidebar = ref(false);
let dragStartX = 0;
let dragStartWidth = 0;

const startSidebarResize = (e: PointerEvent) => {
  e.preventDefault();
  isResizingSidebar.value = true;
  dragStartX = e.clientX;
  dragStartWidth = sidebarWidth.value;

  window.addEventListener('pointermove', handleSidebarResizeMove);
  window.addEventListener('pointerup', stopSidebarResize);
  window.addEventListener('pointercancel', stopSidebarResize);
};

const handleSidebarResizeMove = (e: PointerEvent) => {
  if (!isResizingSidebar.value) return;
  const deltaX = e.clientX - dragStartX;
  const nextWidth = clamp(dragStartWidth + deltaX, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
  sidebarWidth.value = nextWidth;
};

const stopSidebarResize = () => {
  if (!isResizingSidebar.value) return;
  isResizingSidebar.value = false;
  window.removeEventListener('pointermove', handleSidebarResizeMove);
  window.removeEventListener('pointerup', stopSidebarResize);
  window.removeEventListener('pointercancel', stopSidebarResize);
  try {
    localStorage.setItem(STORAGE_KEY_SIDEBAR_WIDTH, sidebarWidth.value.toString());
  } catch {}
};

const resetSidebarWidth = () => {
  sidebarWidth.value = DEFAULT_SIDEBAR_WIDTH;
  try {
    localStorage.setItem(STORAGE_KEY_SIDEBAR_WIDTH, DEFAULT_SIDEBAR_WIDTH.toString());
  } catch {}
};

// 支持外部通过 ?tab=xxx 跳转到指定标签
watch(() => route.query.tab, (q) => {
  const next = (q as string | undefined) ?? '';
  if (next && canOpenTab(next) && next !== activeTab.value) {
    activeTab.value = next;
  }
});

// 切换 tab 时同步 URL query，便于分享/刷新保持
watch(activeTab, (t) => {
  if (route.query.tab !== t) {
    void router.replace({ query: { ...route.query, tab: t } });
  }
});

watch(isDeveloperMode, (enabled) => {
  if (!enabled && activeTab.value === 'debug') {
    activeTab.value = 'about';
  }
});

// <transition mode="out-in"> 完成新内容淡入后的回调：重置滚动 + 通知搜索跳转等待
let resolveTabEnter: (() => void) | null = null;

const onSettingsAfterEnter = () => {
  if (mainRef.value) {
    mainRef.value.scrollTop = 0;
  }
  if (resolveTabEnter) {
    const fn = resolveTabEnter;
    resolveTabEnter = null;
    fn();
  }
};

const waitForTabEnter = (): Promise<void> => {
  if (resolveTabEnter) {
    resolveTabEnter();
    resolveTabEnter = null;
  }
  return new Promise<void>((resolve) => {
    resolveTabEnter = resolve;
  });
};

watch(settingsQuery, () => {
  activeSearchResultIndex.value = 0;
});

const normalizeElementText = (element: Element) => (
  element.textContent?.replace(/\s+/g, ' ').trim() ?? ''
);

const findSearchTarget = (targetText: string): HTMLElement | null => {
  const root = contentRef.value;
  if (!root) return null;

  const normalizedTarget = targetText.replace(/\s+/g, ' ').trim();
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('*'))
    .map(element => ({ element, text: normalizeElementText(element) }))
    .filter(candidate => candidate.text.includes(normalizedTarget));

  candidates.sort((a, b) => {
    const exactDifference = Number(a.text !== normalizedTarget) - Number(b.text !== normalizedTarget);
    return exactDifference || a.text.length - b.text.length;
  });

  return candidates[0]?.element ?? null;
};

const getHighlightContainer = (target: HTMLElement): HTMLElement => {
  const root = contentRef.value;
  let current = target;

  while (current.parentElement && current.parentElement !== root) {
    const parent = current.parentElement;
    const textLength = normalizeElementText(parent).length;
    if (parent.getBoundingClientRect().height > 180 || textLength > 480) break;
    current = parent;
  }

  return current;
};

const revealSearchResult = async (item: SettingsSearchItem) => {
  const needSwitch = activeTab.value !== item.tab;
  if (needSwitch) {
    // 先创建 promise，再切换 tab，等 transition 淡出+淡入完成后继续
    const enterPromise = waitForTabEnter();
    activeTab.value = item.tab;
    await enterPromise;
  }
  settingsQuery.value = '';

  if (!item.target) {
    mainRef.value?.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  const target = findSearchTarget(item.target);
  if (!target) {
    mainRef.value?.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  const highlightTarget = getHighlightContainer(target);
  document.querySelector('.settings-search-highlight')?.classList.remove('settings-search-highlight');
  highlightTarget.classList.add('settings-search-highlight');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });

  if (highlightTimer) clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    highlightTarget.classList.remove('settings-search-highlight');
    highlightTimer = null;
  }, 2200);
};

const clearSettingsSearch = () => {
  settingsQuery.value = '';
};

const handleSearchKeydown = (event: KeyboardEvent) => {
  const results = searchResults.value;
  if (!settingsQuery.value || results.length === 0) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    activeSearchResultIndex.value = (activeSearchResultIndex.value + 1) % results.length;
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeSearchResultIndex.value = (activeSearchResultIndex.value - 1 + results.length) % results.length;
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const result = results[activeSearchResultIndex.value];
    if (result) void revealSearchResult(result);
  } else if (event.key === 'Escape') {
    clearSettingsSearch();
  }
};

onBeforeUnmount(() => {
  if (highlightTimer) clearTimeout(highlightTimer);
  stopSidebarResize();
});

const baseTabs = computed<Array<{ id: SettingsViewTabId; name: string }>>(() => [
  { id: 'account', name: t('settings.account') },
  { id: 'general', name: t('settings.general') },
  { id: 'plugins', name: t('settings.plugins') },
  { id: 'theme', name: t('settings.theme') },
  { id: 'audioOutput', name: t('settings.playback') },
  { id: 'download', name: t('settings.download') },
  { id: 'library', name: t('settings.library') },
  { id: 'toolbox', name: t('settings.toolbox') },
  { id: 'desktopLyrics', name: t('settings.desktopLyrics') },
  { id: 'shortcuts', name: t('settings.shortcuts') },
  { id: 'advanced', name: t('settings.advanced') },
  { id: 'about', name: t('settings.about') },
]);

const tabs = computed(() => {
  if (!isDeveloperMode.value) return baseTabs.value;
  const aboutIndex = baseTabs.value.findIndex(tab => tab.id === 'about');
  return [
    ...baseTabs.value.slice(0, aboutIndex),
    { id: 'debug' as const, name: t('settings.debug') },
    ...baseTabs.value.slice(aboutIndex),
  ];
});
</script>

<template>
  <div
    class="flex h-full flex-1 overflow-hidden transition-colors duration-300"
    :class="{ 'select-none': isResizingSidebar }"
  >
    <aside
      class="relative z-10 flex shrink-0 flex-col border-r border-black/10 p-2.5 dark:border-white/10"
      :style="{ width: `${sidebarWidth}px` }"
    >
      <div class="relative mb-3 shrink-0">
        <Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-white/40" />
        <input
          v-model="settingsQuery"
          type="search"
          autocomplete="off"
          :placeholder="t('settings.search')"
          :aria-label="t('settings.search')"
          class="settings-search-input h-8 w-full rounded-lg border border-black/10 bg-white/45 pl-8 pr-7 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
          @keydown="handleSearchKeydown"
        />
        <button
          v-if="settingsQuery"
          type="button"
          class="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-md text-gray-400 transition hover:bg-black/5 hover:text-gray-700 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/80"
          :aria-label="t('settings.clearSearch')"
          @click="clearSettingsSearch"
        >
          <X class="h-3 w-3" />
        </button>
      </div>

      <div
        v-if="settingsQuery"
        class="custom-scrollbar min-h-0 flex-1 -mr-2.5 overflow-y-auto overflow-x-hidden"
        aria-live="polite"
      >
        <div class="mb-2 px-1 text-[11px] font-medium text-gray-500 dark:text-white/45">
          {{ searchResults.length > 0 ? t('settings.results', { count: searchResults.length }) : t('settings.noResults') }}
        </div>
        <div v-if="searchResults.length" class="space-y-1">
          <button
            v-for="(result, index) in searchResults"
            :key="result.id"
            type="button"
            class="w-full rounded-lg px-2.5 py-2 text-left transition"
            :class="index === activeSearchResultIndex
              ? 'bg-[#EC4141]/10 text-[#EC4141] ring-1 ring-inset ring-[#EC4141]/15'
              : 'text-gray-700 hover:bg-black/5 dark:text-gray-200 dark:hover:bg-white/5'"
            @mouseenter="activeSearchResultIndex = index"
            @click="revealSearchResult(result)"
          >
            <div class="truncate text-xs font-medium">{{ result.label }}</div>
            <div class="mt-0.5 truncate text-[10px] opacity-60">{{ result.tabName }} · {{ result.section }}</div>
          </button>
        </div>
        <div v-else class="px-2 py-6 text-center text-xs leading-5 text-gray-400 dark:text-white/35">
          {{ t('settings.searchHint') }}
        </div>
      </div>

      <nav v-else class="custom-scrollbar flex-1 -mr-2.5 space-y-1 overflow-y-auto overflow-x-hidden">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="relative flex w-full cursor-pointer items-center rounded-md px-3 py-2 text-left text-xs sm:text-sm transition-all duration-300 active:scale-[0.97]"
          :class="activeTab === tab.id ? 'translate-x-0.5 bg-black/10 font-semibold text-black shadow-sm dark:bg-white/10 dark:text-white' : 'font-medium text-gray-800 hover:translate-x-0.5 hover:bg-black/5 hover:text-black dark:text-gray-200 dark:hover:bg-white/5 dark:hover:text-white'"
          @click="activeTab = tab.id"
        >
          <div
            v-if="activeTab === tab.id"
            class="absolute left-0 top-1/2 h-4 w-1 -translate-y-1/2 rounded-r-md bg-[#EC4141]"
          ></div>
          {{ tab.name }}
        </button>
      </nav>

      <!-- 侧边栏宽度可拖拽手柄 -->
      <div
        class="group absolute -right-1 top-0 bottom-0 z-20 w-2 cursor-col-resize touch-none flex items-center justify-center"
        :title="t('settings.resizeHint')"
        @pointerdown="startSidebarResize"
        @dblclick="resetSidebarWidth"
      >
        <div
          class="h-full w-0.5 transition-colors duration-200"
          :class="isResizingSidebar ? 'bg-[#EC4141]' : 'group-hover:bg-[#EC4141]/60 bg-transparent'"
        ></div>
      </div>
    </aside>

    <main ref="mainRef" class="custom-scrollbar relative h-full min-w-0 flex-1 overflow-y-auto py-6">
      <div ref="contentRef" class="w-full px-4 pb-16 sm:px-6 md:px-8 xl:px-12">
        <transition name="settings-fade" mode="out-in" @after-enter="onSettingsAfterEnter">
          <SettingsGeneral v-if="activeTab === 'general'" key="general" />
          <SettingsPlugins v-else-if="activeTab === 'plugins'" key="plugins" />
          <SettingsAccount v-else-if="activeTab === 'account'" key="account" />
          <SettingsTheme v-else-if="activeTab === 'theme'" key="theme" />
          <SettingsDesktopLyrics v-else-if="activeTab === 'desktopLyrics'" key="desktopLyrics" />
          <SettingsAudioOutput v-else-if="activeTab === 'audioOutput'" key="audioOutput" />
          <SettingsDownload v-else-if="activeTab === 'download'" key="download" />
          <SettingsToolbox v-else-if="activeTab === 'toolbox'" key="toolbox" />
          <SettingsLibrary v-else-if="activeTab === 'library'" key="library" />
          <SettingsShortcuts v-else-if="activeTab === 'shortcuts'" key="shortcuts" />
          <SettingsAdvanced v-else-if="activeTab === 'advanced'" key="advanced" />
          <SettingsDebug v-else-if="activeTab === 'debug'" key="debug" />
          <SettingsAbout v-else-if="activeTab === 'about'" key="about" />
          <div v-else key="fallback" class="flex h-[50vh] flex-col items-center justify-center space-y-4 text-gray-400">
            <div class="text-4xl opacity-50">{{ t('settings.building') }}</div>
            <div>{{ t('settings.buildingHint') }}</div>
          </div>
        </transition>
      </div>
    </main>
  </div>
</template>

<style>
.settings-search-input::-webkit-search-cancel-button {
  display: none;
  -webkit-appearance: none;
  appearance: none;
}

.settings-search-input::-ms-clear,
.settings-search-input::-ms-reveal {
  display: none;
  width: 0;
  height: 0;
}

/* 设置页切换动画：与主页 page-fade 一致，out-in 模式（先淡出旧内容，再淡入新内容） */
.settings-fade-enter-active,
.settings-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.settings-fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.settings-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

@keyframes settings-search-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(236, 65, 65, 0);
  }
  20%, 75% {
    box-shadow: 0 0 0 2px rgba(236, 65, 65, 0.48), 0 8px 24px rgba(236, 65, 65, 0.12);
  }
}

.settings-search-highlight {
  border-radius: 12px;
  animation: settings-search-pulse 2.2s ease-out;
}
</style>
