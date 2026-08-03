<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Search, X } from 'lucide-vue-next';
import { useRoute, useRouter } from 'vue-router';
import SettingsAbout from "../components/settings/SettingsAbout.vue";
import SettingsAccount from "../components/settings/SettingsAccount.vue";
import SettingsDesktopLyrics from "../components/settings/SettingsDesktopLyrics.vue";
import SettingsGeneral from "../components/settings/SettingsGeneral.vue";
import SettingsLibrary from "../components/settings/SettingsLibrary.vue";
import SettingsPlugins from "../components/settings/SettingsPlugins.vue";
import SettingsShortcuts from "../components/settings/SettingsShortcuts.vue";
import SettingsTheme from "../components/settings/SettingsTheme.vue";
import SettingsToolbox from "../components/settings/SettingsToolbox.vue";
import SettingsAudioOutput from "../components/settings/SettingsAudioOutput.vue";
import SettingsDownload from "../components/settings/SettingsDownload.vue";
import SettingsDebug from "../components/settings/SettingsDebug.vue";
import SettingsAdvanced from "../components/settings/SettingsAdvanced.vue";
import { useDeveloperMode } from '../features/settings/developerMode';
import {
  searchSettings,
  type SettingsSearchItem,
  type SettingsTabId,
} from '../features/settings/searchIndex';

type SettingsViewTabId = SettingsTabId | 'debug';

const VALID_TABS: SettingsViewTabId[] = ['general', 'theme', 'desktopLyrics', 'audioOutput', 'download', 'toolbox', 'library', 'plugins', 'shortcuts', 'account', 'advanced', 'debug', 'about'];

const route = useRoute();
const router = useRouter();
const { isDeveloperMode } = useDeveloperMode();

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
        return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, parsed));
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
  const nextWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, dragStartWidth + deltaX));
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

watch(activeTab, () => {
  nextTick(() => {
    if (mainRef.value) {
      mainRef.value.scrollTop = 0;
    }
    // 容器整体先动：切换 tab 后，容器整体做淡入动画，
    // 内部组件内容在容器内具体渲染。这样无论内容多复杂，
    // 容器先动起来，视觉上即有过渡效果，不会出现"内容渲染完才动"的割裂。
    if (contentRef.value) {
      contentRef.value.animate(
        [
          { opacity: 0, transform: 'translateY(10px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 300, easing: 'ease', fill: 'both' }
      );
    }
  });
});

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
  activeTab.value = item.tab;
  settingsQuery.value = '';
  await nextTick();
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

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

const baseTabs: Array<{ id: SettingsViewTabId; name: string }> = [
  { id: 'account', name: '账号' },
  { id: 'general', name: '常规' },
  { id: 'plugins', name: '插件' },
  { id: 'theme', name: '外观' },
  { id: 'audioOutput', name: '播放' },
  { id: 'download', name: '下载' },
  { id: 'library', name: '音乐库' },
  { id: 'toolbox', name: '工具箱' },
  { id: 'desktopLyrics', name: '桌面歌词' },
  { id: 'shortcuts', name: '快捷键' },
  { id: 'advanced', name: '高级设置' },
  { id: 'about', name: '关于' },
];

const tabs = computed(() => {
  if (!isDeveloperMode.value) return baseTabs;
  const aboutIndex = baseTabs.findIndex(tab => tab.id === 'about');
  return [
    ...baseTabs.slice(0, aboutIndex),
    { id: 'debug' as const, name: '调试' },
    ...baseTabs.slice(aboutIndex),
  ];
});
</script>

<template>
  <div
    class="flex h-full flex-1 overflow-hidden transition-colors duration-500"
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
          placeholder="搜索设置"
          aria-label="搜索设置"
          class="settings-search-input h-8 w-full rounded-lg border border-black/10 bg-white/45 pl-8 pr-7 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
          @keydown="handleSearchKeydown"
        />
        <button
          v-if="settingsQuery"
          type="button"
          class="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-md text-gray-400 transition hover:bg-black/5 hover:text-gray-700 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/80"
          aria-label="清除设置搜索"
          @click="clearSettingsSearch"
        >
          <X class="h-3 w-3" />
        </button>
      </div>

      <div
        v-if="settingsQuery"
        class="custom-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        aria-live="polite"
      >
        <div class="mb-2 px-1 text-[11px] font-medium text-gray-500 dark:text-white/45">
          {{ searchResults.length > 0 ? `找到 ${searchResults.length} 项设置` : '没有找到相关设置' }}
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
          试试搜索“音质”“歌词”或“缓存”
        </div>
      </div>

      <nav v-else class="custom-scrollbar flex-1 space-y-1 overflow-y-auto overflow-x-hidden">
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
        title="按住拖拽调整侧边栏宽度，双击恢复默认"
        @pointerdown="startSidebarResize"
        @dblclick="resetSidebarWidth"
      >
        <div
          class="h-full w-0.5 transition-colors duration-200"
          :class="isResizingSidebar ? 'bg-[#EC4141]' : 'group-hover:bg-[#EC4141]/60 bg-transparent'"
        ></div>
      </div>
    </aside>

    <main ref="mainRef" class="custom-scrollbar relative h-full min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 md:px-8 xl:px-12">
      <div ref="contentRef" :key="activeTab" class="w-full pb-16">
        <SettingsGeneral v-if="activeTab === 'general'" />
        <SettingsPlugins v-else-if="activeTab === 'plugins'" />
        <SettingsAccount v-else-if="activeTab === 'account'" />
        <SettingsTheme v-else-if="activeTab === 'theme'" />
        <SettingsDesktopLyrics v-else-if="activeTab === 'desktopLyrics'" />
        <SettingsAudioOutput v-else-if="activeTab === 'audioOutput'" />
        <SettingsDownload v-else-if="activeTab === 'download'" />
        <SettingsToolbox v-else-if="activeTab === 'toolbox'" />
        <SettingsLibrary v-else-if="activeTab === 'library'" />
        <SettingsShortcuts v-else-if="activeTab === 'shortcuts'" />
        <SettingsAdvanced v-else-if="activeTab === 'advanced'" />
        <SettingsDebug v-else-if="activeTab === 'debug'" />
        <SettingsAbout v-else-if="activeTab === 'about'" />

        <div v-else class="flex h-[50vh] flex-col items-center justify-center space-y-4 text-gray-400">
          <div class="text-4xl opacity-50">施工中</div>
          <div>当前设置模块正在整理中。</div>
        </div>
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
