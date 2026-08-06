<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { ArrowDown, ArrowUp, GripVertical, RotateCcw } from 'lucide-vue-next';

import { useSettings } from '../../features/settings/useSettings';
import { useToast } from '../../composables/toast';
import {
  DEFAULT_SIDEBAR_ORDER,
  SIDEBAR_ITEMS,
  normalizeSidebarOrder,
} from '../../features/settings/sidebarItems';
import type { SidebarItemKey } from '../../types';
import { findVerticalScrollContainer, getEdgeAutoScrollSpeed, resolveDragTargetIndex } from '../../utils/dragSort';
import SettingHint from './SettingHint.vue';

const { settings } = useSettings();
const { showToast } = useToast();

/** 按当前顺序排列的可配置项（含元数据） */
const orderedItems = computed(() => {
  const order = normalizeSidebarOrder(settings.value.sidebar?.order);
  return order
    .map(key => SIDEBAR_ITEMS.find(item => item.key === key))
    .filter((item): item is (typeof SIDEBAR_ITEMS)[number] => !!item);
});

const isVisible = (key: SidebarItemKey) => {
  const item = SIDEBAR_ITEMS.find(i => i.key === key);
  if (!item) return false;
  return settings.value.sidebar[item.visibilityKey] === true;
};

const toggleVisible = (key: SidebarItemKey) => {
  const item = SIDEBAR_ITEMS.find(i => i.key === key);
  if (!item || item.lockedVisible) return;
  const visibilityKey = item.visibilityKey as 'showArtists';
  settings.value.sidebar[visibilityKey] = !settings.value.sidebar[visibilityKey];
};

/** 写回新顺序 */
const applyOrder = (nextOrder: SidebarItemKey[]) => {
  settings.value.sidebar.order = normalizeSidebarOrder(nextOrder);
};

const moveItem = (from: number, to: number) => {
  const order = [...orderedItems.value.map(item => item.key)];
  if (from < 0 || from >= order.length || to < 0 || to >= order.length || from === to) return;
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  applyOrder(order);
};

const moveUp = (index: number) => moveItem(index, index - 1);
const moveDown = (index: number) => moveItem(index, index + 1);

const restoreDefaultOrder = () => {
  applyOrder([...DEFAULT_SIDEBAR_ORDER]);
  showToast('已恢复默认排列顺序', 'success');
};

// --- 拖拽排序（基于 pointer 事件）---
// 不用 HTML5 drag & drop：Tauri 的 WebView2 默认接管拖放（dragDropEnabled），
// 会导致页面内原生 DnD 失效，因此这里用 pointer 事件自行实现。
const draggingIndex = ref<number | null>(null);
const listRef = ref<HTMLElement | null>(null);
const scrollContainer = ref<HTMLElement | null>(null);
let latestPointerY = 0;
let autoScrollFrame: number | null = null;

const resolveTargetIndex = (clientY: number, currentIndex: number): number | null => {
  return resolveDragTargetIndex(listRef.value, '[data-sidebar-row]', clientY, currentIndex);
};

const updateDraggedItemPosition = (clientY: number) => {
  const currentIndex = draggingIndex.value;
  if (currentIndex === null) return;

  const target = resolveTargetIndex(clientY, currentIndex);
  if (target === null || target === currentIndex) return;

  moveItem(currentIndex, target);
  // 实时重排后，被拖拽项已移动到新位置
  draggingIndex.value = target;
};

/** 指针靠近滚动区域边缘时，持续滚动并同步更新拖拽位置 */
const runAutoScroll = () => {
  autoScrollFrame = null;
  if (draggingIndex.value === null) return;

  const container = scrollContainer.value;
  if (!container) return;

  const speed = getEdgeAutoScrollSpeed(container, latestPointerY);

  if (speed === 0) return;

  const previousScrollTop = container.scrollTop;
  container.scrollTop += speed;
  if (container.scrollTop !== previousScrollTop) {
    updateDraggedItemPosition(latestPointerY);
    autoScrollFrame = requestAnimationFrame(runAutoScroll);
  }
};

const scheduleAutoScroll = () => {
  if (autoScrollFrame === null) {
    autoScrollFrame = requestAnimationFrame(runAutoScroll);
  }
};

const handlePointerMove = (event: PointerEvent) => {
  if (draggingIndex.value === null) return;
  event.preventDefault();

  latestPointerY = event.clientY;
  updateDraggedItemPosition(event.clientY);
  scheduleAutoScroll();
};

const stopDragging = () => {
  draggingIndex.value = null;
  scrollContainer.value = null;
  if (autoScrollFrame !== null) {
    cancelAnimationFrame(autoScrollFrame);
    autoScrollFrame = null;
  }
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerup', stopDragging);
  window.removeEventListener('pointercancel', stopDragging);
};

const startDragging = (index: number, event: PointerEvent) => {
  // 只响应主键/触摸
  if (event.button !== 0) return;
  event.preventDefault();

  draggingIndex.value = index;
  latestPointerY = event.clientY;
  scrollContainer.value = listRef.value ? findVerticalScrollContainer(listRef.value) : null;
  window.addEventListener('pointermove', handlePointerMove, { passive: false });
  window.addEventListener('pointerup', stopDragging);
  window.addEventListener('pointercancel', stopDragging);
};

onUnmounted(stopDragging);
</script>

<template>
  <div class="w-full space-y-8">
    <section v-if="settings.sidebar" class="space-y-3">
      <h2 class="flex items-center justify-between gap-4 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="flex items-center gap-2">
          <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
          侧边栏管理
        </span>
        <SettingHint text="拖动左侧手柄或使用上下箭头调整排列顺序，右侧开关控制是否在侧边栏显示。" />
      </h2>

      <div ref="listRef" class="flex flex-col rounded-xl overflow-hidden bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <!-- 首页：固定置顶，不可隐藏、不可排序 -->
        <div class="p-4 flex items-center justify-between opacity-70 cursor-not-allowed">
          <div class="flex min-w-0 items-center gap-3">
            <span class="w-4 shrink-0"></span>
            <div class="w-8 h-8 rounded-full bg-gray-100 dark:bg-white/10 flex items-center justify-center text-gray-500 shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
            </div>
            <div class="min-w-0">
              <div class="truncate text-sm font-medium text-gray-800 dark:text-gray-200">首页</div>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <SettingHint text="核心功能（固定在顶部）" />
            <div class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-[#EC4141] opacity-50">
              <span class="inline-block h-4 w-4 transform rounded-full bg-white translate-x-6 shadow-sm" />
            </div>
          </div>
        </div>

        <!-- 可排序项：TransitionGroup 使用 FLIP 动画平滑移动重排项 -->
        <TransitionGroup name="sidebar-sort" tag="div" class="flex flex-col">
          <div
            v-for="(item, index) in orderedItems"
            :key="item.key"
            data-sidebar-row
            class="p-4 flex items-center justify-between transition-colors"
            :class="draggingIndex === index
              ? 'bg-[#EC4141]/10 ring-1 ring-inset ring-[#EC4141]/30'
              : 'hover:bg-white/40 dark:hover:bg-white/10'"
          >
          <div class="flex min-w-0 items-center gap-3">
            <GripVertical
              class="h-4 w-4 shrink-0 touch-none select-none text-gray-400 transition-colors hover:text-[#EC4141] dark:text-white/35"
              :class="draggingIndex === index ? 'cursor-grabbing text-[#EC4141]' : 'cursor-grab'"
              @pointerdown="startDragging(index, $event)"
            />

            <div
              class="w-8 h-8 rounded-full bg-gray-100 dark:bg-white/10 flex items-center justify-center shrink-0"
              :class="isVisible(item.key) ? 'text-[#EC4141] bg-red-100/50' : 'text-gray-500'"
            >
              <svg
                v-if="item.iconKind === 'albums'"
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <circle cx="12" cy="12" r="10" stroke-width="2" />
                <circle cx="12" cy="12" r="3" stroke-width="2" />
              </svg>
              <svg
                v-else
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="item.iconPath" />
              </svg>
            </div>

            <div class="min-w-0">
              <div class="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{{ item.label }}</div>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-3">
            <SettingHint v-if="item.description" :text="item.description" />
            <div class="flex items-center gap-1.5">
              <button
              type="button"
              class="settings-sidebar-move border border-slate-400/24 text-slate-600 hover:border-[#EC4141]/34 hover:bg-[#EC4141]/8 hover:text-[#EC4141] dark:border-white/12 dark:text-white/60 dark:hover:border-[#EC4141]/40 dark:hover:bg-[#EC4141]/16 dark:hover:text-[#ff8b8b]"
              title="上移"
              :disabled="index === 0"
              @click.stop="moveUp(index)"
            >
              <ArrowUp class="h-3.5 w-3.5" />
              </button>
              <button
              type="button"
              class="settings-sidebar-move border border-slate-400/24 text-slate-600 hover:border-[#EC4141]/34 hover:bg-[#EC4141]/8 hover:text-[#EC4141] dark:border-white/12 dark:text-white/60 dark:hover:border-[#EC4141]/40 dark:hover:bg-[#EC4141]/16 dark:hover:text-[#ff8b8b]"
              title="下移"
              :disabled="index === orderedItems.length - 1"
              @click.stop="moveDown(index)"
            >
              <ArrowDown class="h-3.5 w-3.5" />
              </button>

              <button
              type="button"
              class="relative ml-1.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none"
              :class="[
                isVisible(item.key) ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700',
                item.lockedVisible ? 'opacity-50 cursor-not-allowed' : '',
              ]"
              :disabled="item.lockedVisible"
              :title="item.lockedVisible ? '核心功能，不可隐藏' : (isVisible(item.key) ? '点击隐藏' : '点击显示')"
              @click.stop="toggleVisible(item.key)"
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
                :class="isVisible(item.key) ? 'translate-x-6' : 'translate-x-1'"
              />
              </button>
            </div>
          </div>
          </div>
        </TransitionGroup>
      </div>

      <div class="flex justify-end">
        <button
          type="button"
          class="flex items-center gap-1.5 text-xs px-4 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-full text-gray-600 dark:text-gray-300 hover:text-[#EC4141] hover:border-[#EC4141] transition"
          @click="restoreDefaultOrder"
        >
          <RotateCcw class="h-3.5 w-3.5" />
          恢复默认顺序
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.sidebar-sort-move {
  transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  .sidebar-sort-move {
    transition: none;
  }
}

.settings-sidebar-move {
  display: inline-flex;
  height: 26px;
  width: 26px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  transition: color 140ms ease, background-color 140ms ease, border-color 140ms ease;
}

.settings-sidebar-move:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
