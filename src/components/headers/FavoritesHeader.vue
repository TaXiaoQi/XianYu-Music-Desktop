<script setup lang="ts"> // 实现
// 收藏页头部：单曲/歌单/专辑三个页签 + 批量工具条 + 歌曲页签操作区
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { useSearchTitleSuffix } from '../../composables/useSearchAwareTitle';
import SortModeButton from '../common/SortModeButton.vue';

const props = defineProps<{
  isBatchMode: boolean; // 实现
  selectedCount?: number; // 实现
  totalSongCount?: number;
}>();

const emit = defineEmits(['update:isBatchMode', 'playAll', 'batchPlay', 'addToPlaylist', 'batchDelete', 'batchDownload', 'clearAll', 'addAllToQueue', 'selectAll']);

const { favTab } = usePlayerViewState();
const searchSuffix = useSearchTitleSuffix();

const totalCount = computed(() => props.totalSongCount ?? 0);
const isAllSelected = computed(() => totalCount.value > 0 && (props.selectedCount ?? 0) === totalCount.value);

// ===== 页签与滑动指示条 =====
const FAV_TABS = [
  { key: 'songs', caption: '单曲' },
  { key: 'playlists', caption: '歌单' },
  { key: 'albums', caption: '专辑' },
] as const;

const tabsRow = ref<HTMLElement | null>(null);
const indicatorStyle = ref({ transform: 'translateX(0px)', width: '0px' });
const INDICATOR_WIDTH_PX = 16;

const repositionIndicator = async () => {
  await nextTick();
  const row = tabsRow.value;
  if (!row) return;

  const activeTab = row.querySelector<HTMLElement>('.tab-active');
  if (!activeTab) return;

  const rowBox = row.getBoundingClientRect();
  const tabBox = activeTab.getBoundingClientRect();
  const centerOffset = tabBox.left - rowBox.left + tabBox.width / 2 - INDICATOR_WIDTH_PX / 2;

  indicatorStyle.value = {
    transform: `translateX(${centerOffset}px)`,
    width: `${INDICATOR_WIDTH_PX}px`,
  };
};

watch(favTab, () => {
  void repositionIndicator();
});

onMounted(() => {
  window.addEventListener('resize', repositionIndicator);
  void repositionIndicator();
});

onUnmounted(() => window.removeEventListener('resize', repositionIndicator));

const tabToneClass = (key: string) =>
  key === favTab.value
    ? 'tab-active font-bold text-xl text-gray-900 dark:text-white'
    : 'text-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300';

// ===== 批量工具条 =====
type BatchIconName = 'check' | 'plus' | 'download' | 'trash';

const BATCH_ICON_PATHS: Record<Exclude<BatchIconName, 'check'>, string> = {
  plus: 'M12 4v16m8-8H4',
  download: 'M12 3v12m0 0l-4-4m4 4l4-4M5 21h14',
  trash: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
};

const batchButtonClass =
  'px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95 bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-white/10 dark:hover:bg-white/20 dark:text-gray-200';

const batchActions = computed(() => [
  { key: 'select-all', caption: isAllSelected.value ? '取消全选' : '全选', icon: 'check' as const, run: () => emit('selectAll') },
  { key: 'collect', caption: '收藏到歌单', icon: 'plus' as const, run: () => emit('addToPlaylist') },
  { key: 'download', caption: '下载', icon: 'download' as const, run: () => emit('batchDownload') },
  { key: 'remove', caption: '删除', icon: 'trash' as const, run: () => emit('batchDelete') },
]);

const roundIconButtonClass =
  'w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm bg-white/1 hover:bg-white/10 border border-white/1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-200 dark:hover:border-white/20';
</script>

<template>
  <div class="px-6 shrink-0 select-none flex flex-col pt-[clamp(0px,0.3vh,4px)] pb-[clamp(6px,1vh,12px)] h-auto justify-center">
    <div v-if="isBatchMode" class="flex items-center justify-between animate-in fade-in slide-in-from-top-1 duration-200"> 
      <div class="flex items-center gap-3"> 
        <button
          v-for="action in batchActions"
          :key="action.key"
          :class="batchButtonClass"
          @click="action.run()"
        >
          <svg
            v-if="action.icon === 'check'"
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path v-if="isAllSelected" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            <template v-else>
              <circle cx="12" cy="12" r="9" stroke-width="2" />
            </template>
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="BATCH_ICON_PATHS[action.icon]" />
          </svg>
          {{ action.caption }}
        </button>
      </div>
      <div class="flex items-center gap-4"> 
        <button @click="emit('update:isBatchMode', false)" class="text-[#EC4141] hover:bg-red-50 dark:hover:bg-red-500/10 px-3 py-1 rounded transition">完成</button> 
      </div>
    </div>

    <div v-else class="flex items-center justify-between"> 
      <div ref="tabsRow" class="relative pb-1 flex items-center gap-6">
        <button class="tab-item transition-all duration-300 ease-out active:scale-90" :class="tabToneClass('songs')" @click="favTab = 'songs'">
          {{ FAV_TABS[0].caption }}
        </button>
        <button class="tab-item transition-all duration-300 ease-out active:scale-90" :class="tabToneClass('playlists')" @click="favTab = 'playlists'">
          {{ FAV_TABS[1].caption }}
        </button>
        <button class="tab-item transition-all duration-300 ease-out active:scale-90" :class="tabToneClass('albums')" @click="favTab = 'albums'">
          {{ FAV_TABS[2].caption }}
        </button>

        <div
          class="absolute -bottom-1 h-1 bg-[#EC4141] rounded-full transition-all duration-300 ease-out pointer-events-none"
          :style="indicatorStyle"
        ></div>
      </div>

      <span
        v-if="searchSuffix"
        class="ml-1 shrink-0 truncate text-base font-medium text-gray-500 dark:text-gray-400"
      >
        {{ searchSuffix }}
      </span>

      <div v-if="favTab === 'songs'" class="flex items-center gap-2">
        <button :class="roundIconButtonClass" title="播放全部" @click="emit('playAll')">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"> 
            <path d="M9 5.5v13l10-6.5-10-6.5Z" /> 
          </svg>
        </button>

        <button :class="roundIconButtonClass" title="全部添加至播放列表" @click="emit('addAllToQueue')">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"> 
            <path d="M3.5 6H17" /> 
            <path d="M3.5 12H14" /> 
            <path d="M3.5 18H11" /> 
            <path d="M18 14v6" /> 
            <path d="M15 17h6" /> 
          </svg>
        </button>

        <button :class="roundIconButtonClass" title="批量操作" @click="emit('update:isBatchMode', true)">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg> 
        </button>

        <SortModeButton />
      </div>
    </div>
  </div>
</template>
