<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import {
  ChevronUp,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from 'lucide-vue-next';

import { useToast } from '../../composables/toast';
import { useSettings } from '../../features/settings/useSettings';
import {
  DEFAULT_FOOTER_LAYOUT,
  FOOTER_ITEMS,
  getFooterItemMeta,
  getFooterPreviewSlotItems,
  moveFooterItemToPreviewSlot,
  normalizeFooterLayout,
  setFooterItemVisibility,
  type FooterPreviewSlot,
} from '../../features/settings/footerItems';
import type { FooterItemKey } from '../../types';
import FooterControlIcon from '../layout/FooterControlIcon.vue';
import SettingHint from './SettingHint.vue';

const { footerLayout, patchFooterLayout } = useSettings();
const { showToast } = useToast();

const layout = computed(() => normalizeFooterLayout(footerLayout.value));
const previewSlots = computed(() => getFooterPreviewSlotItems(layout.value));

const LEFT_SLOTS: FooterPreviewSlot[] = ['left-0', 'left-1'];
const MIDDLE_LEFT_SLOTS: FooterPreviewSlot[] = ['middle-left'];
const MIDDLE_RIGHT_SLOTS: FooterPreviewSlot[] = ['middle-right'];
const RIGHT_SLOTS: FooterPreviewSlot[] = ['right-0', 'right-1', 'right-2', 'right-3', 'right-4'];

const getItemLabel = (key: FooterItemKey | null) => key ? getFooterItemMeta(key)?.label ?? key : '';
const isItemVisible = (key: FooterItemKey) => !layout.value.hidden.includes(key);

interface FooterDragState {
  key: FooterItemKey;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
  targetSlot: FooterPreviewSlot | null;
}

const dragState = ref<FooterDragState | null>(null);

const resolveDropSlot = (clientX: number, clientY: number): FooterPreviewSlot | null => {
  const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  return target?.closest<HTMLElement>('[data-footer-preview-slot]')?.dataset.footerPreviewSlot as FooterPreviewSlot | undefined ?? null;
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
    patchFooterLayout(moveFooterItemToPreviewSlot(layout.value, state.key, state.targetSlot));
  }
  dragState.value = null;
  stopDragging();
};

const cancelDragging = () => {
  dragState.value = null;
  stopDragging();
};

const startDragging = (event: PointerEvent, key: FooterItemKey) => {
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

const toggleItemVisibility = (key: FooterItemKey) => {
  patchFooterLayout(setFooterItemVisibility(layout.value, key, !isItemVisible(key)));
};

const restoreDefault = () => {
  patchFooterLayout({
    left: [...DEFAULT_FOOTER_LAYOUT.left],
    middleLeft: DEFAULT_FOOTER_LAYOUT.middleLeft,
    middleRight: DEFAULT_FOOTER_LAYOUT.middleRight,
    right: [...DEFAULT_FOOTER_LAYOUT.right],
    hidden: [],
  });
  showToast('已恢复默认底栏布局', 'success');
};

onUnmounted(cancelDragging);
</script>

<template>
  <section class="space-y-3">
    <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
      <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
      底部栏布局与预览
    </h2>

    <div class="footer-layout-preview-container select-none">
      <div class="footer-layout-preview-header">
        <div>
          <div class="text-xs font-semibold text-gray-500 dark:text-gray-400">效果实时预览</div>
          <div class="mt-0.5 text-[11px] text-gray-400 dark:text-white/40">按住按钮并拖到预览中的其他位置</div>
        </div>
        <div class="flex items-center gap-2">
          <SettingHint text="封面、歌曲信息和上一首/播放/下一首为固定区域；其余按钮可直接拖拽交换位置。" />
          <button type="button" class="footer-preview-reset" @click="restoreDefault">
            <RotateCcw class="h-3.5 w-3.5" />
            恢复默认
          </button>
        </div>
      </div>

      <div class="footer-player-preview">
        <div class="footer-preview-left">
          <div class="footer-preview-cover">
            <div class="h-full w-full bg-gradient-to-br from-[#EC4141] via-rose-400 to-orange-300"></div>
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate text-xs font-bold text-gray-800 dark:text-white">I'm leaving home</div>
            <div class="mt-0.5 truncate text-[10px] text-gray-500 dark:text-white/45">Coastline</div>
          </div>
          <div class="footer-preview-zone">
            <div
              v-for="slot in LEFT_SLOTS"
              :key="slot"
              class="footer-preview-slot"
              :class="{ 'footer-preview-slot--target': dragState?.targetSlot === slot }"
              :data-footer-preview-slot="slot"
            >
              <button
                v-if="previewSlots[slot]"
                type="button"
                class="footer-preview-control"
                :class="{ 'footer-preview-control--dragging': dragState?.key === previewSlots[slot] }"
                :title="`${getItemLabel(previewSlots[slot])}（拖拽调整位置）`"
                @pointerdown="startDragging($event, previewSlots[slot]!)"
              >
                <FooterControlIcon :item-key="previewSlots[slot]!" class="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        <div class="footer-preview-center">
          <div class="footer-preview-zone">
            <div
              v-for="slot in MIDDLE_LEFT_SLOTS"
              :key="slot"
              class="footer-preview-slot"
              :class="{ 'footer-preview-slot--target': dragState?.targetSlot === slot }"
              :data-footer-preview-slot="slot"
            >
              <button
                v-if="previewSlots[slot]"
                type="button"
                class="footer-preview-control"
                :class="{ 'footer-preview-control--dragging': dragState?.key === previewSlots[slot] }"
                :title="`${getItemLabel(previewSlots[slot])}（拖拽调整位置）`"
                @pointerdown="startDragging($event, previewSlots[slot]!)"
              >
                <FooterControlIcon :item-key="previewSlots[slot]!" class="h-5 w-5" />
              </button>
            </div>
          </div>

          <button type="button" class="footer-preview-playback" title="上一首（固定）"><SkipBack class="h-5 w-5" /></button>
          <button type="button" class="footer-preview-play"><Play class="ml-0.5 h-5 w-5 fill-current" /></button>
          <button type="button" class="footer-preview-playback" title="下一首（固定）"><SkipForward class="h-5 w-5" /></button>

          <div class="footer-preview-zone">
            <div
              v-for="slot in MIDDLE_RIGHT_SLOTS"
              :key="slot"
              class="footer-preview-slot"
              :class="{ 'footer-preview-slot--target': dragState?.targetSlot === slot }"
              :data-footer-preview-slot="slot"
            >
              <button
                v-if="previewSlots[slot]"
                type="button"
                class="footer-preview-control"
                :class="{ 'footer-preview-control--dragging': dragState?.key === previewSlots[slot] }"
                :title="`${getItemLabel(previewSlots[slot])}（拖拽调整位置）`"
                @pointerdown="startDragging($event, previewSlots[slot]!)"
              >
                <FooterControlIcon :item-key="previewSlots[slot]!" class="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        <div class="footer-preview-right">
          <div class="footer-preview-zone">
            <div
              v-for="slot in RIGHT_SLOTS"
              :key="slot"
              class="footer-preview-slot"
              :class="{ 'footer-preview-slot--target': dragState?.targetSlot === slot }"
              :data-footer-preview-slot="slot"
            >
              <button
                v-if="previewSlots[slot]"
                type="button"
                class="footer-preview-control"
                :class="{ 'footer-preview-control--dragging': dragState?.key === previewSlots[slot] }"
                :title="`${getItemLabel(previewSlots[slot])}（拖拽调整位置）`"
                @pointerdown="startDragging($event, previewSlots[slot]!)"
              >
                <FooterControlIcon :item-key="previewSlots[slot]!" class="h-5 w-5" />
              </button>
            </div>
          </div>
          <button type="button" class="footer-preview-control opacity-55" title="更多工具（固定）">
            <ChevronUp class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>

    <div class="pt-2">
      <div class="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">按钮显示</div>
      <div class="grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-3">
        <button
          v-for="item in FOOTER_ITEMS"
          :key="item.key"
          type="button"
          class="footer-visibility-row"
          @click="toggleItemVisibility(item.key)"
        >
          <span class="flex min-w-0 items-center gap-2.5">
            <span class="footer-visibility-icon" :class="isItemVisible(item.key) ? 'text-[#EC4141]' : 'text-gray-400 dark:text-white/35'">
              <FooterControlIcon :item-key="item.key" class="h-4 w-4" />
            </span>
            <span class="truncate text-sm font-medium text-gray-700 dark:text-gray-200">{{ item.label }}</span>
          </span>
          <span class="footer-visibility-switch" :class="isItemVisible(item.key) ? 'footer-visibility-switch--on' : ''">
            <span class="footer-visibility-switch-thumb"></span>
          </span>
        </button>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="dragState?.moved"
        class="pointer-events-none fixed z-[10020] flex items-center gap-2 rounded-full border border-[#EC4141]/25 bg-white/95 px-3 py-2 text-[#EC4141] shadow-2xl backdrop-blur-xl dark:bg-zinc-900/95"
        :style="{ left: `${dragState.x + 14}px`, top: `${dragState.y + 14}px` }"
      >
        <FooterControlIcon :item-key="dragState.key" class="h-4 w-4" />
        <span class="text-xs font-semibold">{{ getItemLabel(dragState.key) }}</span>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.footer-layout-preview-container {
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.5);
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.04);
}

:global(.dark) .footer-layout-preview-container {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.025);
}

.footer-layout-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.07);
}

:global(.dark) .footer-layout-preview-header {
  border-bottom-color: rgba(255, 255, 255, 0.07);
}

.footer-preview-reset {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 999px;
  color: rgb(75 85 99);
  font-size: 12px;
  font-weight: 600;
  transition: 160ms ease;
}

.footer-preview-reset:hover {
  border-color: #ec4141;
  color: #ec4141;
}

:global(.dark) .footer-preview-reset {
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
}

.footer-player-preview {
  display: grid;
  grid-template-columns: minmax(230px, 1fr) auto minmax(230px, 1fr);
  align-items: center;
  min-height: 88px;
  gap: 14px;
  padding: 14px 16px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.86), rgba(248, 250, 252, 0.64));
}

:global(.dark) .footer-player-preview {
  background: linear-gradient(135deg, rgba(24, 24, 27, 0.9), rgba(9, 9, 11, 0.72));
}

.footer-preview-left,
.footer-preview-center,
.footer-preview-right,
.footer-preview-zone {
  display: flex;
  align-items: center;
}

.footer-preview-left { min-width: 0; gap: 9px; }
.footer-preview-center { justify-content: center; gap: 5px; }
.footer-preview-right { justify-content: flex-end; min-width: 0; gap: 3px; }
.footer-preview-zone { gap: 3px; }

.footer-preview-cover {
  width: 46px;
  height: 46px;
  overflow: hidden;
  flex: 0 0 auto;
  border-radius: 9px;
  box-shadow: 0 5px 16px rgba(236, 65, 65, 0.2);
}

.footer-preview-slot {
  display: grid;
  width: 34px;
  height: 36px;
  place-items: center;
  border: 1px dashed transparent;
  border-radius: 10px;
  transition: 150ms ease;
}

.footer-preview-slot--target {
  border-color: rgba(236, 65, 65, 0.7);
  background: rgba(236, 65, 65, 0.1);
  transform: scale(1.08);
}

.footer-preview-control,
.footer-preview-playback {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 999px;
  color: rgb(55 65 81);
  transition: 150ms ease;
}

.footer-preview-control {
  cursor: grab;
  touch-action: none;
}

.footer-preview-control:hover {
  color: #ec4141;
  background: rgba(236, 65, 65, 0.08);
}

.footer-preview-control:active { cursor: grabbing; }
.footer-preview-control--dragging { opacity: 0.28; transform: scale(0.9); }

:global(.dark) .footer-preview-control,
:global(.dark) .footer-preview-playback { color: rgba(255, 255, 255, 0.78); }

.footer-preview-play {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 999px;
  color: white;
  background: #ec4141;
  box-shadow: 0 6px 18px rgba(236, 65, 65, 0.24);
}

.footer-visibility-row {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 10px;
  border-radius: 12px;
  transition: 150ms ease;
}

.footer-visibility-row:hover { background: rgba(15, 23, 42, 0.035); }
:global(.dark) .footer-visibility-row:hover { background: rgba(255, 255, 255, 0.04); }

.footer-visibility-icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 9px;
  background: rgba(15, 23, 42, 0.035);
}

:global(.dark) .footer-visibility-icon { background: rgba(255, 255, 255, 0.045); }

.footer-visibility-switch {
  position: relative;
  width: 38px;
  height: 22px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: rgb(209 213 219);
  transition: 180ms ease;
}

:global(.dark) .footer-visibility-switch { background: rgb(63 63 70); }
.footer-visibility-switch--on { background: #ec4141 !important; }

.footer-visibility-switch-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: white;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
  transition: transform 180ms ease;
}

.footer-visibility-switch--on .footer-visibility-switch-thumb { transform: translateX(16px); }

@media (max-width: 780px) {
  .footer-player-preview {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .footer-preview-center { order: -1; }
  .footer-preview-right { justify-content: flex-start; }
}
</style>
