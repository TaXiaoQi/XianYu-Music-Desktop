<script setup lang="ts">
/**
 * 排序方式按钮 + 下拉菜单
 *
 * 从 LocalMusicHeader 抽出，供本地音乐 / 我的收藏 / 最近播放共用。
 * 三者共享同一个 localSortMode 状态（后端排序管线已打通），
 * 因此这里直接读写 usePlayerViewState 的 localSortMode。
 *
 * 「添加时间」「修改时间」支持点两次切换升降序，其余模式单向。
 */
import { ref, onMounted, onUnmounted } from 'vue';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import SortModeIcon from './SortModeIcon.vue';

type SortModeKey = 'title' | 'artist' | 'added_at' | 'file_modified_at' | 'custom';

const props = withDefaults(defineProps<{
  /** 可选的排序模式列表，默认包含全部五项 */
  modes?: readonly SortModeKey[];
}>(), {
  modes: undefined,
});

const { localSortMode, setLocalSortMode } = usePlayerViewState();

const SORT_LABELS: Record<SortModeKey, string> = {
  title: '歌曲名',
  artist: '歌手',
  added_at: '添加时间',
  file_modified_at: '修改时间',
  custom: '自定义',
};

const DEFAULT_MODES: readonly SortModeKey[] = [
  'title',
  'artist',
  'added_at',
  'file_modified_at',
  'custom',
];

const availableModes = () => props.modes ?? DEFAULT_MODES;

const showSortMenu = ref(false);
const sortMenuX = ref(0);
const sortMenuY = ref(0);
const sortMenuIsRightAligned = ref(false);

const handleSortClick = (e: MouseEvent) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const windowWidth = window.innerWidth;

  // 按钮偏右时菜单右对齐，避免超出窗口
  if (rect.left > windowWidth / 2) {
    sortMenuIsRightAligned.value = true;
    sortMenuX.value = windowWidth - rect.right;
  } else {
    sortMenuIsRightAligned.value = false;
    sortMenuX.value = rect.left;
  }

  sortMenuY.value = rect.bottom + 8;
  showSortMenu.value = !showSortMenu.value;
};

const handleGlobalClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (!target.closest('.sort-menu-trigger')) {
    showSortMenu.value = false;
  }
};

onMounted(() => window.addEventListener('click', handleGlobalClick));
onUnmounted(() => window.removeEventListener('click', handleGlobalClick));

/** 时间类模式支持升降序切换，其余单向设置 */
const handleSelectMode = (mode: SortModeKey) => {
  if (mode === 'added_at') {
    setLocalSortMode(localSortMode.value === 'added_at' ? 'added_at_asc' : 'added_at');
  } else if (mode === 'file_modified_at') {
    setLocalSortMode(
      localSortMode.value === 'file_modified_at' ? 'file_modified_at_asc' : 'file_modified_at',
    );
  } else {
    setLocalSortMode(mode);
  }
  showSortMenu.value = false;
};

const isActive = (mode: SortModeKey) => (localSortMode.value || '').startsWith(mode);

const isAscending = () => localSortMode.value === 'added_at_asc'
  || localSortMode.value === 'file_modified_at_asc';
</script>

<template>
  <button
    @click.stop="handleSortClick"
    class="sort-menu-trigger bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
    title="排序方式"
  >
    <SortModeIcon class="h-4 w-4" />
  </button>

  <Teleport to="body">
    <div
      v-if="showSortMenu"
      class="fixed z-[9999] bg-white dark:bg-[#262626] rounded-lg shadow-xl border border-gray-100 dark:border-white/10 py-1 min-w-[120px] isolate animate-in fade-in zoom-in-95 duration-100"
      :style="sortMenuIsRightAligned
        ? { right: sortMenuX + 'px', top: sortMenuY + 'px' }
        : { left: sortMenuX + 'px', top: sortMenuY + 'px' }"
    >
      <div
        v-for="mode in availableModes()"
        :key="mode"
        @click="handleSelectMode(mode)"
        class="px-3 py-2 text-xs cursor-pointer flex items-center justify-between hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
        :class="isActive(mode) ? 'text-blue-500 font-medium' : 'text-gray-600 dark:text-gray-300'"
      >
        <span>{{ SORT_LABELS[mode] }}</span>
        <div v-if="isActive(mode)" class="flex items-center gap-1.5">
          <!-- 时间类模式显示升降序箭头 -->
          <svg
            v-if="mode === 'added_at' || mode === 'file_modified_at'"
            xmlns="http://www.w3.org/2000/svg"
            class="h-3 w-3 transition-transform duration-200"
            :class="{ 'rotate-180': isAscending() }"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fill-rule="evenodd" d="M14.707 12.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l2.293-2.293a1 1 0 011.414 0z" clip-rule="evenodd" />
          </svg>
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
          </svg>
        </div>
      </div>
    </div>
  </Teleport>
</template>
