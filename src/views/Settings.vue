<script setup lang="ts"> // 实现
import { computed, defineAsyncComponent, h, onBeforeUnmount, onErrorCaptured, onMounted, ref, watch, type Component } from 'vue';
import { Search, X } from 'lucide-vue-next'; // 实现
import { useRoute, useRouter } from 'vue-router'; // 实现

const settingsLoaders = {
  about: () => import("../components/settings/SettingsAbout.vue").then(m => m.default),
  account: () => import("../components/settings/SettingsAccount.vue").then(m => m.default),
  desktopLyrics: () => import("../components/settings/SettingsDesktopLyrics.vue").then(m => m.default),
  sleepTimer: () => import("../components/settings/SettingsSleepTimer.vue").then(m => m.default),
  general: () => import("../components/settings/SettingsGeneral.vue").then(m => m.default),
  library: () => import("../components/settings/SettingsLibrary.vue").then(m => m.default),
  plugins: () => import("../components/settings/SettingsPlugins.vue").then(m => m.default),
  shortcuts: () => import("../components/settings/SettingsShortcuts.vue").then(m => m.default),
  theme: () => import("../components/settings/SettingsTheme.vue").then(m => m.default),
  toolbox: () => import("../components/settings/SettingsToolbox.vue").then(m => m.default),
  audioOutput: () => import("../components/settings/SettingsAudioOutput.vue").then(m => m.default),
  download: () => import("../components/settings/SettingsDownload.vue").then(m => m.default),
  debug: () => import("../components/settings/SettingsDebug.vue").then(m => m.default),
  network: () => import("../components/settings/SettingsNetwork.vue").then(m => m.default),
  advanced: () => import("../components/settings/SettingsAdvanced.vue").then(m => m.default),
  linkage: () => import("../components/settings/SettingsLinkage.vue").then(m => m.default),
  feedback: () => import("../components/settings/SettingsFeedback.vue").then(m => m.default),
};

const SettingsPageLoading = {
  name: 'SettingsPageLoading',
  render: () =>
    h(
      'div',
      { class: 'flex h-[45vh] items-center justify-center text-gray-400 dark:text-white/40' },
      h('div', { class: 'h-7 w-7 animate-spin rounded-full border-2 border-current border-t-transparent' }),
    ),
};

const lazySettings = (loader: () => Promise<Component>) => defineAsyncComponent({
  loader,
  loadingComponent: SettingsPageLoading,
  delay: 0,
  onError: (_error, retry, fail, attempts) => {
    if (attempts <= 2) {
      retry();
    } else {
      fail();
    }
  },
});

const SettingsAbout = lazySettings(settingsLoaders.about);
const SettingsAccount = lazySettings(settingsLoaders.account);
const SettingsDesktopLyrics = lazySettings(settingsLoaders.desktopLyrics);
const SettingsSleepTimer = lazySettings(settingsLoaders.sleepTimer);
const SettingsGeneral = lazySettings(settingsLoaders.general);
const SettingsLibrary = lazySettings(settingsLoaders.library);
const SettingsPlugins = lazySettings(settingsLoaders.plugins);
const SettingsShortcuts = lazySettings(settingsLoaders.shortcuts);
const SettingsTheme = lazySettings(settingsLoaders.theme);
const SettingsToolbox = lazySettings(settingsLoaders.toolbox);
const SettingsAudioOutput = lazySettings(settingsLoaders.audioOutput);
const SettingsDownload = lazySettings(settingsLoaders.download);
const SettingsDebug = lazySettings(settingsLoaders.debug);
const SettingsNetwork = lazySettings(settingsLoaders.network);
const SettingsAdvanced = lazySettings(settingsLoaders.advanced);
const SettingsLinkage = lazySettings(settingsLoaders.linkage);
const SettingsFeedback = lazySettings(settingsLoaders.feedback);
import { useDeveloperMode } from '../features/settings/developerMode'; // 实现
import {
  searchSettings, // 实现
  type SettingsSearchItem, // 实现
  type SettingsTabId, // 实现
} from '../features/settings/searchIndex'; // 实现
import { clamp } from '../utils/math';
import { useI18n } from '../features/i18n'; // 实现

type SettingsViewTabId = SettingsTabId | 'debug'; // 实现

const VALID_TABS: SettingsViewTabId[] = ['general', 'theme', 'desktopLyrics', 'sleepTimer', 'audioOutput', 'download', 'toolbox', 'library', 'plugins', 'shortcuts', 'account', 'network', 'advanced', 'linkage', 'feedback', 'debug', 'about'];

const route = useRoute(); // 实现
const router = useRouter(); // 实现
const { isDeveloperMode } = useDeveloperMode(); // 实现
const { t } = useI18n(); // 实现

const canOpenTab = (tab: string): tab is SettingsViewTabId => ( // 实现
  VALID_TABS.includes(tab as SettingsViewTabId) && (tab !== 'debug' || isDeveloperMode.value) // 实现
);

const initialTab = (() => { // 实现
  const q = route.query.tab as string | undefined; // 实现
  return (q && canOpenTab(q)) ? q : 'general'; // 实现
})();

const activeTab = ref<SettingsViewTabId>(initialTab); // 实现

const tabRenderError = ref<Error | null>(null);
onErrorCaptured((error) => {
  tabRenderError.value = error instanceof Error ? error : new Error(String(error));
  return false;
});
const mainRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const settingsQuery = ref(''); // 实现
const activeSearchResultIndex = ref(0); // 实现
const searchResults = computed(() => searchSettings(settingsQuery.value)); // 实现
let highlightTimer: ReturnType<typeof setTimeout> | null = null; // 实现

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

let pushedTab: SettingsViewTabId = initialTab;
watch(() => route.query.tab, (q) => { // 实现
  const next = (q as string | undefined) ?? ''; // 实现
  if (next && canOpenTab(next) && next !== pushedTab) {
    pushedTab = next;
    activeTab.value = next; // 实现
  }
});

watch(activeTab, (t) => { // 实现
  tabRenderError.value = null;
  if (pushedTab !== t) {
    pushedTab = t;
    void router.replace({ query: { ...route.query, tab: t } }); // 实现
  }
});

watch(isDeveloperMode, (enabled) => { // 实现
  if (!enabled && activeTab.value === 'debug') { // 实现
    activeTab.value = 'about'; // 实现
  }
});

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

watch(settingsQuery, () => { // 实现
  activeSearchResultIndex.value = 0; // 实现
});

const normalizeElementText = (element: Element) => ( // 实现
  element.textContent?.replace(/\s+/g, ' ').trim() ?? '' // 实现
);

const findSearchTarget = (targetText: string): HTMLElement | null => { // 实现
  const root = contentRef.value; // 实现
  if (!root) return null; // 实现

  const normalizedTarget = targetText.replace(/\s+/g, ' ').trim(); // 实现
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('*')) // 实现
    .map(element => ({ element, text: normalizeElementText(element) })) // 实现
    .filter(candidate => candidate.text.includes(normalizedTarget)); // 实现

  candidates.sort((a, b) => { // 实现
    const exactDifference = Number(a.text !== normalizedTarget) - Number(b.text !== normalizedTarget); // 实现
    return exactDifference || a.text.length - b.text.length; // 实现
  });

  return candidates[0]?.element ?? null; // 实现
};

const getHighlightContainer = (target: HTMLElement): HTMLElement => { // 实现
  const root = contentRef.value; // 实现
  let current = target; // 实现

  while (current.parentElement && current.parentElement !== root) { // 实现
    const parent = current.parentElement; // 实现
    const textLength = normalizeElementText(parent).length; // 实现
    if (parent.getBoundingClientRect().height > 180 || textLength > 480) break; // 实现
    current = parent; // 实现
  }

  return current; // 实现
};

const revealSearchResult = async (item: SettingsSearchItem) => { // 实现
  const needSwitch = activeTab.value !== item.tab;
  if (needSwitch) {
    const enterPromise = waitForTabEnter();
    activeTab.value = item.tab;
    await enterPromise;
  }
  settingsQuery.value = ''; // 实现

  if (!item.target) { // 实现
    mainRef.value?.scrollTo({ top: 0, behavior: 'smooth' }); // 实现
    return;
  }

  const target = findSearchTarget(item.target); // 实现
  if (!target) { // 实现
    mainRef.value?.scrollTo({ top: 0, behavior: 'smooth' }); // 实现
    return;
  }

  const highlightTarget = getHighlightContainer(target); // 实现
  document.querySelector('.settings-search-highlight')?.classList.remove('settings-search-highlight'); // 实现
  highlightTarget.classList.add('settings-search-highlight'); // 实现
  target.scrollIntoView({ behavior: 'smooth', block: 'center' }); // 实现

  if (highlightTimer) clearTimeout(highlightTimer); // 实现
  highlightTimer = setTimeout(() => { // 实现
    highlightTarget.classList.remove('settings-search-highlight'); // 实现
    highlightTimer = null; // 实现
  }, 2200);
};

const clearSettingsSearch = () => { // 实现
  settingsQuery.value = ''; // 实现
};

const handleSearchKeydown = (event: KeyboardEvent) => { // 实现
  const results = searchResults.value; // 实现
  if (!settingsQuery.value || results.length === 0) return; // 实现

  if (event.key === 'ArrowDown') { // 实现
    event.preventDefault(); // 实现
    activeSearchResultIndex.value = (activeSearchResultIndex.value + 1) % results.length; // 实现
  } else if (event.key === 'ArrowUp') { // 实现
    event.preventDefault(); // 实现
    activeSearchResultIndex.value = (activeSearchResultIndex.value - 1 + results.length) % results.length; // 实现
  } else if (event.key === 'Enter') { // 实现
    event.preventDefault(); // 实现
    const result = results[activeSearchResultIndex.value]; // 实现
    if (result) void revealSearchResult(result); // 实现
  } else if (event.key === 'Escape') { // 实现
    clearSettingsSearch(); // 实现
  }
};

let cancelWarmup: (() => void) | null = null;

onMounted(() => {
  const warm = () => {
    cancelWarmup = null;
    for (const loader of Object.values(settingsLoaders)) {
      void loader().catch(() => {});
    }
  };
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(warm, { timeout: 2000 });
    cancelWarmup = () => cancelIdleCallback(id);
  } else {
    const id = setTimeout(warm, 200);
    cancelWarmup = () => clearTimeout(id);
  }
});

onBeforeUnmount(() => { // 实现
  cancelWarmup?.();
  if (highlightTimer) clearTimeout(highlightTimer); // 实现
  stopSidebarResize();
});

const baseTabs = computed<Array<{ id: SettingsViewTabId; name: string }>>(() => [ // 实现
  { id: 'account', name: t('settings.account') }, // 实现
  { id: 'general', name: t('settings.general') }, // 实现
  { id: 'theme', name: t('settings.theme') }, // 实现
  { id: 'plugins', name: t('settings.plugins') },
  { id: 'audioOutput', name: t('settings.playback') }, // 实现
  { id: 'download', name: t('settings.download') }, // 实现
  { id: 'linkage', name: t('settings.linkage') },
  { id: 'library', name: t('settings.library') }, // 实现
  { id: 'toolbox', name: t('settings.toolbox') }, // 实现
  { id: 'desktopLyrics', name: t('settings.desktopLyrics') }, // 实现
  { id: 'sleepTimer', name: t('settings.sleepTimer') },
  { id: 'shortcuts', name: t('settings.shortcuts') }, // 实现
  { id: 'network', name: t('settings.network') },
  { id: 'advanced', name: t('settings.advanced') }, // 实现
  { id: 'feedback', name: t('settings.feedback') },
  { id: 'about', name: t('settings.about') }, // 实现
]);

const tabs = computed(() => { // 实现
  if (!isDeveloperMode.value) return baseTabs.value; // 实现
  const aboutIndex = baseTabs.value.findIndex(tab => tab.id === 'about'); // 实现
  return [
    ...baseTabs.value.slice(0, aboutIndex), // 实现
    { id: 'debug' as const, name: t('settings.debug') }, // 实现
    ...baseTabs.value.slice(aboutIndex), // 实现
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
        <div
          v-if="tabRenderError"
          class="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center"
        >
          <div class="text-base font-medium text-gray-700 dark:text-gray-200">该设置页加载出错</div>
          <div class="max-w-md break-words text-xs leading-5 text-red-500 dark:text-red-400">
            {{ tabRenderError.message }}
          </div>
          <button
            type="button"
            class="rounded-lg bg-[#EC4141] px-4 py-1.5 text-xs font-medium text-white transition hover:bg-[#d13b3b]"
            @click="tabRenderError = null"
          >重试</button>
        </div>
        <transition v-else name="settings-fade" @after-enter="onSettingsAfterEnter">
          <div :key="activeTab" class="w-full">
            <SettingsGeneral v-if="activeTab === 'general'" />
          <SettingsPlugins v-else-if="activeTab === 'plugins'" key="plugins" />
          <SettingsAccount v-else-if="activeTab === 'account'" key="account" />
          <SettingsTheme v-else-if="activeTab === 'theme'" key="theme" />
          <SettingsDesktopLyrics v-else-if="activeTab === 'desktopLyrics'" key="desktopLyrics" />
          <SettingsSleepTimer v-else-if="activeTab === 'sleepTimer'" key="sleepTimer" />
          <SettingsAudioOutput v-else-if="activeTab === 'audioOutput'" key="audioOutput" />
          <SettingsDownload v-else-if="activeTab === 'download'" key="download" />
          <SettingsToolbox v-else-if="activeTab === 'toolbox'" key="toolbox" />
          <SettingsLibrary v-else-if="activeTab === 'library'" key="library" />
          <SettingsShortcuts v-else-if="activeTab === 'shortcuts'" key="shortcuts" />
          <SettingsNetwork v-else-if="activeTab === 'network'" key="network" />
          <SettingsAdvanced v-else-if="activeTab === 'advanced'" key="advanced" />
          <SettingsLinkage v-else-if="activeTab === 'linkage'" key="linkage" />
          <SettingsFeedback v-else-if="activeTab === 'feedback'" key="feedback" />
          <SettingsDebug v-else-if="activeTab === 'debug'" key="debug" />
          <SettingsAbout v-else-if="activeTab === 'about'" key="about" />
          <div v-else class="flex h-[50vh] flex-col items-center justify-center space-y-4 text-gray-400">
            <div class="text-4xl opacity-50">{{ t('settings.building') }}</div> 
            <div>{{ t('settings.buildingHint') }}</div> 
          </div>
          </div>
        </transition>
      </div>
    </main>
  </div>
</template>

<style>
.settings-search-input::-webkit-search-cancel-button { /* 样式 */
  display: none; /* 样式 */
  -webkit-appearance: none; /* 样式 */
  appearance: none; /* 样式 */
}

.settings-search-input::-ms-clear, /* 样式 */
.settings-search-input::-ms-reveal { /* 样式 */
  display: none; /* 样式 */
  width: 0;
  height: 0;
}

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

@keyframes settings-search-pulse { /* 样式 */
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(236, 65, 65, 0); /* 样式 */
  }
  20%, 75% {
    box-shadow: 0 0 0 2px rgba(236, 65, 65, 0.48), 0 8px 24px rgba(236, 65, 65, 0.12); /* 样式 */
  }
}

.settings-search-highlight { /* 样式 */
  border-radius: 12px; /* 样式 */
  animation: settings-search-pulse 2.2s ease-out; /* 样式 */
}
</style>
