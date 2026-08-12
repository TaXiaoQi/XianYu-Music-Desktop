<script setup lang="ts">
import { computed, onUnmounted, provide, ref } from 'vue';
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
  computeCollapsedItems,
  getFooterItemMeta,
  getFooterPreviewSlotItems,
  moveFooterItemToPreviewSlot,
  normalizeFooterLayout,
  setFooterItemVisibility,
  type FooterPreviewSlot,
} from '../../features/settings/footerItems';
import type { DownloadQuality, FooterItemKey, QualityKey } from '../../types';
import FooterControlIcon from '../layout/FooterControlIcon.vue';
import FooterControlItem from '../layout/FooterControlItem.vue';
import SettingHint from './SettingHint.vue';

const { footerLayout, patchFooterLayout } = useSettings();
const { showToast } = useToast();

const layout = computed(() => normalizeFooterLayout(footerLayout.value));
const previewSlots = computed(() => getFooterPreviewSlotItems(layout.value));
const collapsedPreviewItems = computed(() => computeCollapsedItems(layout.value));

const LEFT_SLOTS: FooterPreviewSlot[] = ['left-0', 'left-1'];
const MIDDLE_LEFT_SLOTS: FooterPreviewSlot[] = ['middle-left'];
const MIDDLE_RIGHT_SLOTS: FooterPreviewSlot[] = ['middle-right'];
const RIGHT_SLOTS: FooterPreviewSlot[] = ['right-0', 'right-1', 'right-2', 'right-3', 'right-4'];

const getItemLabel = (key: FooterItemKey | null) => key ? getFooterItemMeta(key)?.label ?? key : '';
const isItemVisible = (key: FooterItemKey) => !layout.value.hidden.includes(key);

// 预览区直接复用真实底部栏控件组件；这里提供一套轻量 mock 上下文，只用于渲染外观。
const previewCurrentSong = ref<any>({
  title: 'I\'m leaving home',
  name: 'I\'m leaving home',
  artist: 'Coastline',
  path: 'preview://footer',
  duration: 225,
});
const previewBoolean = ref(false);
const previewShowPlayerDetail = ref(false);
const previewVolume = ref(72);
const previewPlayMode = ref(0);
const previewDownloadedRecord = ref(null);
const previewElementRef = ref<HTMLElement | null>(null);
const previewQuality = ref<QualityKey>('320k');
const previewDownloadQuality = ref<DownloadQuality>('320k');
const previewQualityOptions = ref<Array<{ label: string; value: QualityKey; description: string }>>([
  { label: 'HQ', value: '320k', description: '320k' },
]);
const previewDownloadQualityOptions = ref<Array<{ label: string; value: DownloadQuality; description: string }>>([
  { label: 'HQ', value: '320k', description: '320k' },
]);

provide('footerContext', {
  currentSong: previewCurrentSong,
  showPlayerDetail: previewShowPlayerDetail,
  footerQualityExtraText: (_qualityKey: QualityKey) => '',
  isFooterQualityInfoProbing: ref(false),
  isFavorite: () => false,
  toggleFavorite: () => {},
  isOnlineSong: ref(true),
  isDownloading: ref(false),
  downloadedRecord: previewDownloadedRecord,
  handleDownloadClick: () => {},
  downloadButtonTitle: ref('下载歌曲'),
  showDownloadQualityMenu: ref(false),
  DOWNLOAD_QUALITY_OPTIONS: previewDownloadQualityOptions,
  activeDownloadQualityKey: previewDownloadQuality,
  startDownload: async () => {},
  downloadQualityButtonRef: previewElementRef,
  downloadQualityMenuRef: previewElementRef,
  playMode: previewPlayMode,
  toggleMode: () => {},
  showDesktopLyrics: previewBoolean,
  toggleLyrics: () => {},
  isQualitySelectableSong: ref(true),
  qualityButtonLabel: ref('HQ'),
  showQualityMenu: ref(false),
  toggleQualityMenu: () => {},
  QUALITY_OPTIONS: previewQualityOptions,
  activeQualityKey: previewQuality,
  selectQuality: async () => {},
  qualityButtonRef: previewElementRef,
  qualityMenuRef: previewElementRef,
  volume: previewVolume,
  showVolumeSlider: ref(false),
  isDraggingVolume: ref(false),
  handleVolumeEnter: () => {},
  handleVolumeLeave: () => {},
  handleVolumeWheel: () => {},
  volumeBarRef: previewElementRef,
  startDrag: () => {},
  toggleMute: () => {},
  showEqPanel: ref(false),
  toggleEqPanel: () => {},
  // 播放队列
  showPlaylist: ref(false),
  togglePlaylist: () => {},
  // 评论区
  isPluginSong: ref(true),
  showComment: ref(false),
  toggleComment: () => {},
});

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

    <div class="footer-layout-preview-container select-none overflow-hidden rounded-xl border border-gray-200/40 bg-white/20 dark:border-gray-800/40 dark:bg-black/10">
      <div class="footer-layout-preview-header">
        <div>
          <div class="text-xs font-semibold text-gray-500 dark:text-gray-400">效果实时预览</div>
          <div class="mt-0.5 text-[11px] text-gray-400 dark:text-white/40">按住按钮可拖到预览中的其他位置；关闭主栏显示后会进入更多菜单</div>
        </div>
        <div class="flex items-center gap-2">
          <SettingHint text="封面、歌曲信息和上一首/播放/下一首为固定区域；其余按钮可直接拖拽交换位置。" />
          <button
            type="button"
            class="footer-preview-reset border border-gray-200/40 bg-white/20 text-gray-600 hover:border-[#EC4141]/35 hover:bg-white/30 hover:text-[#EC4141] dark:border-gray-800/40 dark:bg-black/10 dark:text-white/70 dark:hover:bg-white/10"
            @click="restoreDefault"
          >
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
          <div class="footer-preview-track-info min-w-0 flex-1">
            <div class="truncate text-xs font-bold text-gray-800 dark:text-white">I'm leaving home</div>
            <div class="mt-0.5 truncate text-[10px] text-gray-500 dark:text-white/45">Coastline</div>
          </div>
          <div class="footer-preview-zone">
            <div
              v-for="slot in LEFT_SLOTS"
              :key="slot"
              class="footer-preview-slot"
              :class="{
                'footer-preview-slot--empty': !previewSlots[slot],
                'footer-preview-slot--drag-active': !!dragState,
                'footer-preview-slot--target': dragState?.targetSlot === slot,
              }"
              :data-footer-preview-slot="slot"
            >
              <div
                v-if="previewSlots[slot]"
                class="footer-preview-control-shell"
                :class="{ 'footer-preview-control-shell--dragging': dragState?.key === previewSlots[slot] }"
                :title="`${getItemLabel(previewSlots[slot])}（拖拽调整位置）`"
                @pointerdown="startDragging($event, previewSlots[slot]!)"
              >
                <FooterControlItem :item-key="previewSlots[slot]!" />
              </div>
            </div>
          </div>
        </div>

        <div class="footer-preview-center">
          <div class="footer-preview-zone">
            <div
              v-for="slot in MIDDLE_LEFT_SLOTS"
              :key="slot"
              class="footer-preview-slot"
              :class="{
                'footer-preview-slot--empty': !previewSlots[slot],
                'footer-preview-slot--drag-active': !!dragState,
                'footer-preview-slot--target': dragState?.targetSlot === slot,
              }"
              :data-footer-preview-slot="slot"
            >
              <div
                v-if="previewSlots[slot]"
                class="footer-preview-control-shell"
                :class="{ 'footer-preview-control-shell--dragging': dragState?.key === previewSlots[slot] }"
                :title="`${getItemLabel(previewSlots[slot])}（拖拽调整位置）`"
                @pointerdown="startDragging($event, previewSlots[slot]!)"
              >
                <FooterControlItem :item-key="previewSlots[slot]!" />
              </div>
            </div>
          </div>

          <button
            type="button"
            class="transition-colors hover:scale-110 transform duration-200 text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white"
            title="上一首（固定）"
          >
            <SkipBack class="h-7 w-7 fill-current" />
          </button>
          <button
            type="button"
            class="flex items-center justify-center transition-all active:scale-95 shrink-0 w-11 h-11 rounded-full border text-gray-800 dark:text-white bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 border-black/5 dark:border-white/5"
            title="播放/暂停（固定）"
          >
            <Play class="ml-0.5 h-7 w-7 fill-current" />
          </button>
          <button
            type="button"
            class="transition-colors hover:scale-110 transform duration-200 text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white"
            title="下一首（固定）"
          >
            <SkipForward class="h-7 w-7 fill-current" />
          </button>

          <div class="footer-preview-zone">
            <div
              v-for="slot in MIDDLE_RIGHT_SLOTS"
              :key="slot"
              class="footer-preview-slot"
              :class="{
                'footer-preview-slot--empty': !previewSlots[slot],
                'footer-preview-slot--drag-active': !!dragState,
                'footer-preview-slot--target': dragState?.targetSlot === slot,
              }"
              :data-footer-preview-slot="slot"
            >
              <div
                v-if="previewSlots[slot]"
                class="footer-preview-control-shell"
                :class="{ 'footer-preview-control-shell--dragging': dragState?.key === previewSlots[slot] }"
                :title="`${getItemLabel(previewSlots[slot])}（拖拽调整位置）`"
                @pointerdown="startDragging($event, previewSlots[slot]!)"
              >
                <FooterControlItem :item-key="previewSlots[slot]!" />
              </div>
            </div>
          </div>
        </div>

        <div class="footer-preview-right">
          <div class="footer-preview-zone">
            <div
              v-for="slot in RIGHT_SLOTS"
              :key="slot"
              class="footer-preview-slot"
              :class="{
                'footer-preview-slot--empty': !previewSlots[slot],
                'footer-preview-slot--drag-active': !!dragState,
                'footer-preview-slot--target': dragState?.targetSlot === slot,
              }"
              :data-footer-preview-slot="slot"
            >
              <div
                v-if="previewSlots[slot]"
                class="footer-preview-control-shell"
                :class="{ 'footer-preview-control-shell--dragging': dragState?.key === previewSlots[slot] }"
                :title="`${getItemLabel(previewSlots[slot])}（拖拽调整位置）`"
                @pointerdown="startDragging($event, previewSlots[slot]!)"
              >
                <FooterControlItem :item-key="previewSlots[slot]!" />
              </div>
            </div>
          </div>
          <button
            type="button"
            class="footer-preview-more relative transition-colors w-8 h-8 flex items-center justify-center rounded-full text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10"
            :title="`更多工具（固定）：已收纳 ${collapsedPreviewItems.length} 个控件`"
          >
            <ChevronUp class="h-4 w-4" />
            <span v-if="collapsedPreviewItems.length > 0" class="footer-preview-more-badge">{{ collapsedPreviewItems.length }}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="space-y-2">
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="text-xs font-semibold text-gray-500 dark:text-gray-400">主栏显示</div>
          <div class="mt-0.5 text-[11px] text-gray-400 dark:text-white/35">关闭后不会隐藏功能，会收入右侧“更多工具”菜单。</div>
        </div>
        <div v-if="collapsedPreviewItems.length > 0" class="shrink-0 rounded-full bg-[#EC4141]/10 px-2.5 py-1 text-[11px] font-semibold text-[#EC4141]">
          更多菜单 {{ collapsedPreviewItems.length }} 项
        </div>
      </div>
      <div class="grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-3">
        <button
          v-for="item in FOOTER_ITEMS"
          :key="item.key"
          type="button"
          class="footer-visibility-row rounded-xl border border-gray-200/40 bg-white/20 hover:border-[#EC4141]/35 hover:bg-white/30 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
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
        class="pointer-events-none fixed z-[10020] flex items-center gap-2 rounded-full border border-[#EC4141]/25 bg-white/20 px-3 py-2 text-[#EC4141] shadow-2xl backdrop-blur-xl dark:border-gray-800/40 dark:bg-black/10"
        :style="{ left: `${dragState.x + 14}px`, top: `${dragState.y + 14}px` }"
      >
        <FooterControlIcon :item-key="dragState.key" class="h-4 w-4" />
        <span class="text-xs font-semibold">{{ getItemLabel(dragState.key) }}</span>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.footer-layout-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.28);
}

.footer-preview-reset {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  transition: 160ms ease;
}

.footer-preview-reset:hover {
  color: #ec4141;
}

.footer-player-preview {
  display: grid;
  grid-template-columns: minmax(170px, 1fr) minmax(168px, auto) minmax(170px, 1fr);
  align-items: center;
  min-height: 80px;
  gap: 12px;
  padding: 12px 14px;
}

.footer-preview-left,
.footer-preview-center,
.footer-preview-right,
.footer-preview-zone {
  display: flex;
  align-items: center;
}

.footer-preview-left { min-width: 0; gap: 10px; }
.footer-preview-center { justify-content: center; gap: 7px; }
.footer-preview-right { justify-content: flex-end; min-width: 0; gap: 4px; }
.footer-preview-zone { gap: 2px; }

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

.footer-preview-slot--empty {
  width: 0;
  opacity: 0;
  pointer-events: none;
}

.footer-preview-slot--empty.footer-preview-slot--drag-active {
  width: 34px;
  opacity: 1;
  pointer-events: auto;
  border-color: rgba(148, 163, 184, 0.34);
}

.footer-preview-slot--target {
  border-color: rgba(236, 65, 65, 0.7);
  background: rgba(236, 65, 65, 0.1);
  transform: scale(1.08);
}

.footer-preview-control-shell {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  cursor: grab;
  touch-action: none;
}

.footer-preview-control-shell:active {
  cursor: grabbing;
}

.footer-preview-control-shell--dragging {
  opacity: 0.28;
  transform: scale(0.9);
}

.footer-preview-more {
  cursor: default;
}

.footer-preview-more-badge {
  position: absolute;
  top: -4px;
  right: -3px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 999px;
  background: #ec4141;
  color: white;
  font-size: 9px;
  font-weight: 700;
  line-height: 15px;
  box-shadow: 0 3px 8px rgba(236, 65, 65, 0.25);
}

.footer-visibility-row {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 10px;
  transition: 150ms ease;
}

.footer-visibility-row:hover {
  color: #ec4141;
}

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
  border: 1px solid rgba(229, 231, 235, 0.4);
  background: rgba(0, 0, 0, 0.08);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  transition: 180ms ease;
}

:global(.dark) .footer-visibility-switch {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.08);
}
.footer-visibility-switch--on { background: #ec4141 !important; }

.footer-visibility-switch-thumb {
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

.footer-visibility-switch--on .footer-visibility-switch-thumb { transform: translateX(17px); }

@media (max-width: 720px) {
  .footer-player-preview {
    grid-template-columns: 52px 1fr auto;
    gap: 8px;
  }
  .footer-preview-track-info,
  .footer-preview-left .footer-preview-zone {
    display: none;
  }
  .footer-preview-left {
    gap: 0;
  }
  .footer-preview-center {
    gap: 6px;
  }
  .footer-preview-right {
    justify-content: flex-end;
    gap: 2px;
  }
}

@media (max-width: 560px) {
  .footer-player-preview {
    grid-template-columns: 48px 1fr 40px;
    padding: 10px 12px;
  }
  .footer-preview-right .footer-preview-zone {
    display: none;
  }
  .footer-preview-center {
    gap: 4px;
  }
}
</style>
