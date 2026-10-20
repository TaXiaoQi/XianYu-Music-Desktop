<script setup lang="ts">
// 文件夹视图顶栏：浏览/管理模式切换、批量操作入口、排序菜单（按触发按钮位置在视口内定位）。
import { computed, onMounted, onUnmounted, ref, type Component } from 'vue';
import { ListChecks, RefreshCw } from 'lucide-vue-next';

import { default as SortModeIcon } from '../common/SortModeIcon.vue';
import HeaderOverflowMenu from './HeaderOverflowMenu.vue';
import { useToast as createToaster } from '../../composables/toast';
import { usePlayerViewState as createViewState } from '../../composables/usePlayerViewState';

const viewState = createViewState();
const folderSortMode = viewState.folderSortMode;
const applyFolderSort = viewState.setFolderSortMode;

const props = defineProps<{ isBatchMode: boolean; selectedCount: number; currentFolderFilter: string; isManagementMode: boolean }>();

const emit = defineEmits(['update:isBatchMode', 'playAll', 'batchPlay', 'batchDelete', 'batchMove', 'addToPlaylist', 'addFolder', 'refreshFolder', 'update:isManagementMode']);

const toast = createToaster();

// 头部只保留“添加文件夹/排序”这类主操作；刷新与批量操作收进“更多”菜单。
const HEADER_ROUND_BUTTON =
  'bg-white/1 hover:bg-white/10 border border-white/1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20';

const overflowItems = computed<{ id: string; label: string; icon: Component }[]>(() => {
  const items: { id: string; label: string; icon: Component }[] = [];
  if (props.currentFolderFilter) items.push({ id: 'refresh', label: '刷新文件夹', icon: RefreshCw });
  items.push({ id: 'batch', label: props.isBatchMode ? '退出批量操作' : '批量操作', icon: ListChecks });
  return items;
});

function handleOverflowPick(id: string) {
  if (id === 'refresh') emit('refreshFolder');
  else if (id === 'batch') emit('update:isBatchMode', !props.isBatchMode);
}

const sortMenuOpen = ref(false);
const menuPosX = ref(0);
const menuPosY = ref(0);
const anchorRight = ref(false);

let pendingToastTimer: ReturnType<typeof setTimeout> | null = null;

// 排序菜单各模式的展示文案。
const SORT_LABELS = { title: '歌曲名', name: '文件名', artist: '歌手', track_number: '音轨号', added_at: '添加时间', custom: '自定义' };

function isActiveMode(mode: keyof typeof SORT_LABELS) {
  return (folderSortMode.value || '').startsWith(mode);
}

// 选中排序项：added_at 在倒序/正序之间切换，其余模式直接生效。
function chooseSortMode(mode: keyof typeof SORT_LABELS) {
  if (mode === 'added_at') applyFolderSort(folderSortMode.value === 'added_at' ? 'added_at_asc' : 'added_at');
  else applyFolderSort(mode);
  sortMenuOpen.value = false;
}

// 切换管理模式，延迟 300ms 弹提示，避免连续切换时提示闪烁。
function switchManagementMode(enable: boolean) {
  if (props.isManagementMode !== enable) {
    emit('update:isManagementMode', enable);
    if (pendingToastTimer) clearTimeout(pendingToastTimer);
    pendingToastTimer = setTimeout(() => { toast.showToast(enable ? '注意：已进入管理模式，将会对本地文件直接进行操作' : '已退出管理模式', enable ? 'error' : 'success'); }, 300);
  }
}

// 依据触发按钮位于视口左/右半边，决定菜单向左还是向右对齐。
function openSortMenu(e: MouseEvent) {
  const triggerBox = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const nearLeft = triggerBox.left <= window.innerWidth / 2;

  anchorRight.value = !nearLeft;
  menuPosX.value = nearLeft ? triggerBox.left : window.innerWidth - triggerBox.right;
  menuPosY.value = triggerBox.bottom + 8;
  sortMenuOpen.value = !sortMenuOpen.value;
}

function sortMenuStyle() {
  return anchorRight.value
    ? { right: `${menuPosX.value}px`, top: `${menuPosY.value}px` }
    : { left: `${menuPosX.value}px`, top: `${menuPosY.value}px` };
}

function onDocClick(e: MouseEvent) {
  const node = e.target as HTMLElement;
  if (!node.closest('.sort-menu-trigger')) sortMenuOpen.value = false;
}

onMounted(() => window.addEventListener('click', onDocClick));
onUnmounted(() => window.removeEventListener('click', onDocClick));
</script>

<template>
  <div class="px-6 shrink-0 select-none flex flex-col pt-[clamp(0px,0.3vh,4px)] pb-[clamp(6px,1vh,12px)] h-auto justify-center">
    <div class="flex items-center justify-between"><div class="py-2 text-sm font-semibold text-gray-700 dark:text-gray-200">文件夹</div>

      <div class="flex items-center gap-3"><div class="flex p-0.5 bg-gray-100 dark:bg-white/5 rounded-full relative w-24 h-6 items-center cursor-pointer select-none">
        <div class="absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] bg-white dark:bg-white/10 rounded-full shadow-sm transition-all duration-300 ease-out z-0" :style="{ transform: isManagementMode ? 'translateX(100%)' : 'translateX(0)' }"></div>
        <div @click="switchManagementMode(false)" :class="!isManagementMode ? 'text-[#EC4141] dark:text-red-400' : 'text-gray-400'" class="flex-1 flex items-center justify-center text-[11px] font-medium transition-colors z-10">浏览</div>
        <div @click="switchManagementMode(true)" :class="isManagementMode ? 'text-[#EC4141] dark:text-red-400' : 'text-gray-400'" class="flex-1 flex items-center justify-center text-[11px] font-medium transition-colors z-10">管理</div>
      </div><button @click="emit('addFolder')" title="添加文件夹" class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20">
          <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg></button>

        <button @click="openSortMenu" title="排序方式" :class="{ 'text-blue-500 border-blue-200 bg-blue-50/50 dark:bg-blue-500/10': folderSortMode !== 'title' }" class="sort-menu-trigger bg-white/1 hover:bg-white/10 border border-white/1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20">
          <SortModeIcon class="h-4 w-4" /></button>

        <HeaderOverflowMenu
          :items="overflowItems"
          :button-class="HEADER_ROUND_BUTTON"
          @pick="handleOverflowPick"
        />

        <Teleport to="body"><div v-if="sortMenuOpen" :style="sortMenuStyle()" class="fixed z-[9999] bg-white dark:bg-[#262626] rounded-lg shadow-xl border border-gray-100 dark:border-white/10 py-1 min-w-[120px] isolate animate-in fade-in zoom-in-95 duration-100">
          <div v-for="mode in (['title', 'name', 'artist', 'track_number', 'added_at', 'custom'] as const)" :key="mode" @click="chooseSortMode(mode)" :class="isActiveMode(mode) ? 'text-blue-500 font-medium' : 'text-gray-600 dark:text-gray-300'" class="px-3 py-2 text-xs cursor-pointer flex items-center justify-between hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
            <span>{{ SORT_LABELS[mode] }}</span>
            <div v-if="isActiveMode(mode)" class="flex items-center gap-1.5"><svg v-if="mode === 'added_at'" :class="{ 'rotate-180': folderSortMode === 'added_at_asc' }" class="h-3 w-3 transition-transform duration-200" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M14.707 12.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l2.293-2.293a1 1 0 011.414 0z" fill-rule="evenodd" clip-rule="evenodd" /></svg>
            <svg class="h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fill-rule="evenodd" clip-rule="evenodd" /></svg></div></div>
        </div></Teleport>
      </div></div>

    <Teleport to="body"><transition name="floating-bar">
      <div v-if="isBatchMode" class="fixed inset-x-0 bottom-6 z-[9998] flex justify-center px-4 pointer-events-none">
        <div class="pointer-events-auto flex items-center gap-2 rounded-full border border-white/40 bg-white/70 px-3 py-2 shadow-[0_18px_48px_rgba(0,0,0,0.16)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#262626]/80">
          <div class="px-3 text-sm font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">已选 {{ selectedCount }} 首</div>

          <button @click="emit('addToPlaylist')" title="添加到歌单" class="floating-action">
            <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
            <span>歌单</span></button>

          <button v-if="isManagementMode" @click="emit('batchMove')" title="批量移动到文件夹" class="floating-action">
            <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
            <span>移动</span></button>

          <button v-if="isManagementMode" @click="emit('batchDelete')" title="删除本地歌曲" class="floating-action danger">
            <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            <span>删除</span></button>

          <div class="h-6 w-px bg-black/10 dark:bg-white/10" v-if="isManagementMode"></div>

          <button @click="emit('update:isBatchMode', false)" title="退出批量模式" class="floating-action subtle"><span>完成</span></button>
        </div>
      </div>
    </transition></Teleport>
  </div></template>

<style scoped>
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
.liquid-glass { background: linear-gradient(135deg, rgba(235, 240, 255, 0.4), rgba(255, 255, 255, 0.2)); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-color: rgba(255, 255, 255, 0.6); color: #2563eb; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3), inset 0 2px 8px rgba(255, 255, 255, 0.5); }
:global(.dark) .liquid-glass { background: linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.02)); color: #fff; border-color: rgba(255, 255, 255, 0.15); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05); }
.floating-action { display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.55rem 0.9rem; border-radius: 9999px; line-height: 1; font-size: 0.875rem; color: rgb(75 85 99); transition: all 0.2s ease; }
.floating-action:hover { background: rgba(255, 255, 255, 0.55); color: rgb(17 24 39); }
.floating-action.danger { color: #dc2626; }
.floating-action.danger:hover { background: rgba(254, 226, 226, 0.9); color: #b91c1c; }
.floating-action.subtle { color: #ec4141; }
.floating-action.subtle:hover { background: rgba(254, 242, 242, 0.9); }
:global(.dark) .floating-action { color: rgba(255, 255, 255, 0.82); }
:global(.dark) .floating-action:hover { background: rgba(255, 255, 255, 0.08); color: white; }
:global(.dark) .floating-action.danger { color: #fca5a5; }
:global(.dark) .floating-action.danger:hover { background: rgba(127, 29, 29, 0.45); color: #fecaca; }
:global(.dark) .floating-action.subtle { color: #f87171; }
:global(.dark) .floating-action.subtle:hover { background: rgba(127, 29, 29, 0.3); }
.floating-bar-enter-active, .floating-bar-leave-active { transition: opacity 0.24s ease, transform 0.28s cubic-bezier(0.22, 1, 0.36, 1); }
.floating-bar-enter-from, .floating-bar-leave-to { opacity: 0; transform: translateY(18px) scale(0.96); }
.floating-bar-enter-to, .floating-bar-leave-from { opacity: 1; transform: translateY(0) scale(1); }
</style>
