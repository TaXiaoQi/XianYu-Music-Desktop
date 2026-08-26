<script setup lang="ts">
import { computed, onUnmounted, provide, ref } from 'vue';
import { RotateCcw } from 'lucide-vue-next';

import { useToast } from '../../composables/toast';
import { useSettings } from '../../features/settings/useSettings';
import {
  DEFAULT_TOPBAR_LAYOUT,
  TOPBAR_ITEMS,
  TOPBAR_LEFT_SLOTS,
  TOPBAR_RIGHT_SLOTS,
  computeTopBarCollapsedItems,
  getTopBarItemMeta,
  getTopBarPreviewSlotItems,
  moveTopBarItemToPreviewSlot,
  normalizeTopBarLayout,
  setTopBarItemVisibility,
  type TopBarPreviewSlot,
} from '../../features/settings/topBarItems';
import type { TopBarItemKey } from '../../types';
import TopBarControlIcon from '../layout/TopBarControlIcon.vue';
import TopBarControlItem from '../layout/TopBarControlItem.vue';
import SettingHint from './SettingHint.vue';

const { topBarLayout, patchTopBarLayout } = useSettings();
const { showToast } = useToast();

const layout = computed(() => normalizeTopBarLayout(topBarLayout.value));
const previewSlots = computed(() => getTopBarPreviewSlotItems(layout.value));
const collapsedPreviewItems = computed(() => computeTopBarCollapsedItems(layout.value));

// 预览区直接复用真实顶部栏控件组件；这里提供一套轻量 mock 上下文，只用于渲染外观。
provide('topBarContext', {
  isDarkTheme: ref(false),
  goBack: () => {},
  toggleRecognition: () => {},
  themeToggleTitle: ref('切换深色'),
  toggleThemeMode: () => {},
  isFetchingAnnouncement: ref(false),
  manualCheckAnnouncement: () => {},
  isSettingsRoute: ref(false),
  settingsRotation: ref(0),
  toggleSettingsPage: () => {},
  isAuthRoute: ref(false),
  isLoggedIn: ref(false),
  accountTitle: ref('登录 / 注册'),
  accountAvatar: ref<string | null>(null),
  accountInitial: ref('?'),
  openAccountPage: () => {},
  openColorScheme: () => {},
});

const getItemLabel = (key: TopBarItemKey | null) => key ? getTopBarItemMeta(key)?.label ?? key : '';
const isItemVisible = (key: TopBarItemKey) => !layout.value.hidden.includes(key);
const isItemFixed = (key: TopBarItemKey) => getTopBarItemMeta(key)?.fixed ?? false;
// 控件显示列表仅展示可开关项；固定项（设置/搜索框）不可关闭，不在此展示。
const displayItems = TOPBAR_ITEMS.filter(item => !item.fixed);

interface TopBarDragState {
  key: TopBarItemKey;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
  targetSlot: TopBarPreviewSlot | null;
}

const dragState = ref<TopBarDragState | null>(null);

const resolveDropSlot = (clientX: number, clientY: number): TopBarPreviewSlot | null => {
  const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  return target?.closest<HTMLElement>('[data-topbar-preview-slot]')?.dataset.topbarPreviewSlot as TopBarPreviewSlot | undefined ?? null;
};

const handleDragMove = (event: PointerEvent) => {
  const state = dragState.value;
  if (!state) return;

  state.x = event.clientX;
  state.y = event.clientY;
  if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) >= 4) {
    state.moved = true;
  }
  state.targetSlot = state.moved ? resolveDropSlot(event.clientX, event.clientY) : null;
};

const stopDragging = () => {
  window.removeEventListener('pointermove', handleDragMove);
  window.removeEventListener('pointerup', finishDragging);
  window.removeEventListener('pointercancel', cancelDragging);
  document.body.style.userSelect = '';
};

const finishDragging = () => {
  const state = dragState.value;
  if (state?.moved && state.targetSlot) {
    patchTopBarLayout(moveTopBarItemToPreviewSlot(layout.value, state.key, state.targetSlot));
  }
  dragState.value = null;
  stopDragging();
};

const cancelDragging = () => {
  dragState.value = null;
  stopDragging();
};

const startDragging = (event: PointerEvent, key: TopBarItemKey) => {
  if (event.button !== 0) return;
  event.preventDefault();
  dragState.value = {
    key,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    moved: false,
    targetSlot: null,
  };
  document.body.style.userSelect = 'none';
  window.addEventListener('pointermove', handleDragMove, { passive: true });
  window.addEventListener('pointerup', finishDragging);
  window.addEventListener('pointercancel', cancelDragging);
};

const toggleItemVisibility = (key: TopBarItemKey) => {
  if (isItemFixed(key)) return;
  patchTopBarLayout(setTopBarItemVisibility(layout.value, key, !isItemVisible(key)));
};

const restoreDefault = () => {
  patchTopBarLayout({
    left: [...DEFAULT_TOPBAR_LAYOUT.left],
    right: [...DEFAULT_TOPBAR_LAYOUT.right],
    hidden: [...DEFAULT_TOPBAR_LAYOUT.hidden],
  });
  showToast('已恢复默认顶栏布局', 'success');
};

onUnmounted(cancelDragging);
</script>

<template>
  <section class="space-y-3">
    <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
      <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
      顶部栏布局与预览
    </h2>

    <div class="topbar-layout-preview-container select-none overflow-hidden rounded-xl border border-gray-200/40 bg-white/20 dark:border-gray-800/40 dark:bg-black/10">
      <div class="topbar-layout-preview-header">
        <div class="min-w-0 flex-1">
          <div class="truncate text-xs font-semibold text-gray-500 dark:text-gray-400">效果实时预览</div>
          <div class="mt-0.5 truncate text-[11px] text-gray-400 dark:text-white/40">按住按钮可拖到左右容器中的其他位置；少控件时搜索框会自动填充剩余空间</div>
        </div>
        <div class="flex items-center gap-2">
          <SettingHint text="搜索框固定居中，最多展示 5 个自定义控件；设置固定不可关闭，其余可自由开关与摆放。" />
          <button
            type="button"
            class="topbar-preview-reset border border-gray-200/40 bg-white/20 text-gray-600 hover:border-[#EC4141]/35 hover:bg-white/30 hover:text-[#EC4141] dark:border-gray-800/40 dark:bg-black/10 dark:text-white/70 dark:hover:bg-white/10"
            @click="restoreDefault"
          >
            <RotateCcw class="h-3.5 w-3.5" />
            恢复默认
          </button>
        </div>
      </div>

      <div class="topbar-player-preview">
        <div class="topbar-preview-zone topbar-preview-zone--left">
          <div
            v-for="slot in TOPBAR_LEFT_SLOTS"
            :key="slot"
            class="topbar-preview-slot"
            :class="{
              'topbar-preview-slot--empty': !previewSlots[slot],
              'topbar-preview-slot--drag-active': !!dragState,
              'topbar-preview-slot--target': dragState?.targetSlot === slot,
            }"
            :data-topbar-preview-slot="slot"
          >
            <div
              v-if="previewSlots[slot]"
              class="topbar-preview-control-shell"
              :class="{ 'topbar-preview-control-shell--dragging': dragState?.key === previewSlots[slot] }"
              :title="`${getItemLabel(previewSlots[slot])}（拖拽调整位置）`"
              @pointerdown="startDragging($event, previewSlots[slot]!)"
            >
              <TopBarControlItem :item-key="previewSlots[slot]!" />
            </div>
          </div>
        </div>

        <div class="topbar-preview-search">
          <svg class="h-4 w-4 shrink-0 text-gray-400 dark:text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <span class="truncate text-[11px] text-gray-400 dark:text-white/40">搜索音乐...</span>
        </div>

        <div class="topbar-preview-zone topbar-preview-zone--right">
          <div
            v-for="slot in TOPBAR_RIGHT_SLOTS"
            :key="slot"
            class="topbar-preview-slot"
            :class="{
              'topbar-preview-slot--empty': !previewSlots[slot],
              'topbar-preview-slot--drag-active': !!dragState,
              'topbar-preview-slot--target': dragState?.targetSlot === slot,
            }"
            :data-topbar-preview-slot="slot"
          >
            <div
              v-if="previewSlots[slot]"
              class="topbar-preview-control-shell"
              :class="{ 'topbar-preview-control-shell--dragging': dragState?.key === previewSlots[slot] }"
              :title="`${getItemLabel(previewSlots[slot])}（拖拽调整位置）`"
              @pointerdown="startDragging($event, previewSlots[slot]!)"
            >
              <TopBarControlItem :item-key="previewSlots[slot]!" />
            </div>
          </div>
          <div class="topbar-preview-window">
            <span class="topbar-preview-window-dot"></span>
            <span class="topbar-preview-window-dot"></span>
            <span class="topbar-preview-window-dot topbar-preview-window-dot--close"></span>
          </div>
        </div>
      </div>
    </div>

    <div class="space-y-2">
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="text-xs font-semibold text-gray-500 dark:text-gray-400">控件显示</div>
          <div class="mt-0.5 text-[11px] text-gray-400 dark:text-white/35">关闭后不会隐藏功能，可随时重新开启；设置与搜索框为固定项，不在此处展示。</div>
        </div>
        <div v-if="collapsedPreviewItems.length > 0" class="shrink-0 rounded-full bg-[#EC4141]/10 px-2.5 py-1 text-[11px] font-semibold text-[#EC4141]">
          已隐藏 {{ collapsedPreviewItems.length }} 项
        </div>
      </div>
      <div class="grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-3">
        <div
          v-for="item in displayItems"
          :key="item.key"
          class="topbar-visibility-row flex items-center justify-between rounded-xl border border-gray-200/40 bg-white/20 p-3 hover:border-[#EC4141]/35 hover:bg-white/30 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
          :class="{ 'topbar-visibility-row--fixed': isItemFixed(item.key) }"
        >
          <span class="flex min-w-0 items-center gap-2.5">
            <span class="topbar-visibility-icon" :class="isItemVisible(item.key) ? 'text-[#EC4141]' : 'text-gray-400 dark:text-white/35'">
              <TopBarControlIcon :item-key="item.key" class="h-4 w-4" :is-dark="item.key === 'theme'" />
            </span>
            <span class="truncate text-sm font-medium text-gray-700 dark:text-gray-200">{{ item.label }}</span>
            <span v-if="isItemFixed(item.key)" class="shrink-0 rounded bg-gray-200/60 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-white/10 dark:text-white/50">固定</span>
          </span>
          <button
            type="button"
            class="glass-switch ml-2"
            :class="[
              isItemVisible(item.key) ? 'is-checked' : '',
              isItemFixed(item.key) ? 'opacity-50 cursor-not-allowed' : '',
            ]"
            :disabled="isItemFixed(item.key)"
            @click="toggleItemVisibility(item.key)"
          ></button>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="dragState?.moved"
        class="pointer-events-none fixed z-[10020] flex items-center gap-2 rounded-full border border-[#EC4141]/25 bg-white/20 px-3 py-2 text-[#EC4141] shadow-2xl backdrop-blur-xl dark:border-gray-800/40 dark:bg-black/10"
        :style="{ left: `${dragState.x + 14}px`, top: `${dragState.y + 14}px` }"
      >
        <TopBarControlIcon :item-key="dragState.key" class="h-4 w-4" />
        <span class="text-xs font-semibold">{{ getItemLabel(dragState.key) }}</span>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.topbar-layout-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.28);
}

.topbar-preview-reset {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  transition: 160ms ease;
}

.topbar-preview-reset:hover {
  color: #ec4141;
}

.topbar-player-preview {
  display: flex;
  align-items: center;
  min-height: 64px;
  gap: 12px;
  padding: 12px 14px;
}

.topbar-preview-zone {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 2px;
}

.topbar-preview-zone--left {
  justify-content: flex-start;
  flex: 0 1 auto;
}

.topbar-preview-zone--right {
  justify-content: flex-end;
  flex: 0 1 auto;
}

.topbar-preview-search {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
  max-width: 320px;
  gap: 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.28);
  padding: 8px 14px;
}

:global(.dark) .topbar-preview-search {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.06);
}

.topbar-preview-slot {
  display: grid;
  width: 34px;
  height: 36px;
  place-items: center;
  border: 1px dashed transparent;
  border-radius: 10px;
  transition: 150ms ease;
}

.topbar-preview-slot--empty {
  width: 0;
  opacity: 0;
  pointer-events: none;
}

.topbar-preview-slot--empty.topbar-preview-slot--drag-active {
  width: 34px;
  opacity: 1;
  pointer-events: auto;
  border-color: rgba(148, 163, 184, 0.34);
}

.topbar-preview-slot--target {
  border-color: rgba(236, 65, 65, 0.7);
  background: rgba(236, 65, 65, 0.1);
  transform: scale(1.08);
}

.topbar-preview-control-shell {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  cursor: grab;
  touch-action: none;
}

.topbar-preview-control-shell:active {
  cursor: grabbing;
}

.topbar-preview-control-shell--dragging {
  opacity: 0.28;
  transform: scale(0.9);
}

.topbar-preview-window {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-left: 10px;
  padding-left: 10px;
  border-left: 1px solid rgba(148, 163, 184, 0.3);
}

.topbar-preview-window-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.5);
}

.topbar-preview-window-dot--close {
  background: rgba(236, 65, 65, 0.6);
}

.topbar-visibility-row {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 10px;
  transition: 150ms ease;
}

.topbar-visibility-row:hover {
  color: #ec4141;
}

.topbar-visibility-row--fixed {
  cursor: default;
}

.topbar-visibility-icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 9px;
  background: rgba(15, 23, 42, 0.035);
}

:global(.dark) .topbar-visibility-icon { background: rgba(255, 255, 255, 0.045); }

.topbar-visibility-switch {
  position: relative;
  width: 38px;
  height: 22px;
  flex: 0 0 auto;
  border-radius: 999px;
  border: 1px solid rgba(229, 231, 235, 0.4);
  background: rgba(0, 0, 0, 0.08);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  transition: 180ms ease;
}

:global(.dark) .topbar-visibility-switch {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.08);
}
.topbar-visibility-switch--on { background: #ec4141 !important; }

.topbar-visibility-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: white;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
  transition: transform 180ms ease;
}

.topbar-visibility-switch--on .topbar-visibility-switch-thumb { transform: translateX(17px); }

@media (max-width: 720px) {
  .topbar-player-preview {
    gap: 8px;
    padding: 10px 12px;
  }
  .topbar-preview-zone--left,
  .topbar-preview-zone--right {
    flex-basis: auto;
  }
}

@media (max-width: 560px) {
  .topbar-preview-zone--right {
    display: none;
  }
}
</style>