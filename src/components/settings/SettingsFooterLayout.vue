<script setup lang="ts">
import { computed, onUnmounted, provide, ref, watch } from 'vue';
import {
  ChevronUp,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward, // 实现
} from 'lucide-vue-next';

import { useToast } from '../../composables/toast';
import { useSettings } from '../../features/settings/useSettings'; // 实现
import {
  DEFAULT_FOOTER_LAYOUT,
  computeCollapsedItems,
  dropFooterItemToPalette,
  dropFooterItemToSlot,
  getFooterItemMeta, // 实现
  getFooterPreviewSlotItems, // 实现
  moveFooterItemToPreviewSlot, // 实现
  normalizeFooterLayout,
  type FooterPreviewSlot, // 实现
} from '../../features/settings/footerItems';
import type { DownloadQuality, FooterItemKey, FooterLayoutSettings, QualityKey } from '../../types';
import FooterControlIcon from '../layout/FooterControlIcon.vue'; // 实现
import FooterControlItem from '../layout/FooterControlItem.vue';
import SettingHint from './SettingHint.vue';

const { footerLayout, patchFooterLayout } = useSettings();
const { showToast } = useToast();

const layout = computed(() => normalizeFooterLayout(footerLayout.value));
const previewSlots = computed(() => getFooterPreviewSlotItems(layout.value)); // 实现
const collapsedPreviewItems = computed(() => computeCollapsedItems(layout.value));

const LEFT_SLOTS: FooterPreviewSlot[] = ['left-0', 'left-1']; // 实现
const MIDDLE_LEFT_SLOTS: FooterPreviewSlot[] = ['middle-left']; // 实现
const MIDDLE_RIGHT_SLOTS: FooterPreviewSlot[] = ['middle-right']; // 实现
const RIGHT_SLOTS: FooterPreviewSlot[] = ['right-0', 'right-1', 'right-2', 'right-3', 'right-4']; // 实现

const getItemLabel = (key: FooterItemKey | null) => key ? getFooterItemMeta(key)?.label ?? key : ''; // 实现

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
  isAudioControlLocked: ref(false),
  audioLockTooltip: ref(''),
  isEffectLocked: ref(false),
  effectLockTooltip: ref(''),
  showEqPanel: ref(false),
  toggleEqPanel: () => {},
  showPlaylist: ref(false),
  togglePlaylist: () => {},
  isPluginSong: ref(true),
  showComment: ref(false),
  toggleComment: () => {},
  mvSupport: () => false,
  mvActive: ref(false),
  mvLoading: ref(false),
  mvPhase: ref(''),
  mvBufferedSec: ref(-1),
  toggleMv: async () => {},
  isMvVideoDownloading: ref(false),
  openShareDialog: () => {},
  isVisualizerEnabled: ref(false),
  toggleVisualizer: () => {},
  isProgressHidden: ref(false),
  toggleProgressVisibility: () => {},
  showLyricsPlayerSettingsPanel: ref(false),
  toggleLyricsPlayerSettings: () => {},
  isPinned: ref(true),
  togglePin: () => {},
});

type PreviewDragSource =
  | { type: 'bar'; key: FooterItemKey; slot: FooterPreviewSlot }
  | { type: 'palette'; key: FooterItemKey; index: number };

interface PreviewDragState {
  source: PreviewDragSource;
  startX: number; // 实现
  startY: number; // 实现
  x: number;
  y: number;
  moved: boolean; // 实现
  targetSlot: FooterPreviewSlot | null; // 实现
  paletteIndex: number | null;
  collapse: boolean;
}

const dragState = ref<PreviewDragState | null>(null);
const isDragActive = ref(false);

const resolveDropTarget = (clientX: number, clientY: number) => {
  const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  const slotEl = el?.closest<HTMLElement>('[data-footer-preview-slot]');
  if (slotEl?.dataset.footerPreviewSlot) {
    return { targetSlot: slotEl.dataset.footerPreviewSlot as FooterPreviewSlot, paletteIndex: null as number | null, collapse: false };
  }
  const palEl = el?.closest<HTMLElement>('[data-palette-index]');
  if (palEl && palEl.dataset.paletteIndex !== undefined) {
    return { targetSlot: null, paletteIndex: Number(palEl.dataset.paletteIndex), collapse: false };
  }
  const collEl = el?.closest<HTMLElement>('[data-collapse-target]');
  if (collEl) {
    return { targetSlot: null, paletteIndex: null, collapse: true };
  }
  return { targetSlot: null, paletteIndex: null, collapse: false };
};

const startItemDrag = (event: PointerEvent, source: PreviewDragSource) => {
  if (event.button !== 0) return;
  event.preventDefault();
  isDragActive.value = true;
  dragState.value = {
    source,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    moved: false,
    targetSlot: null,
    paletteIndex: null,
    collapse: false,
  };
  document.body.style.userSelect = 'none';
  window.addEventListener('pointermove', handleItemDragMove, { passive: true });
  window.addEventListener('pointerup', finishItemDrag);
  window.addEventListener('pointercancel', cancelItemDrag);
};

const handleItemDragMove = (event: PointerEvent) => {
  const state = dragState.value; // 实现
  if (!state) return; // 实现
  state.x = event.clientX; // 实现
  state.y = event.clientY; // 实现
  if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) >= 4) { // 实现
    state.moved = true; // 实现
  }
  if (state.moved) {
    const drop = resolveDropTarget(event.clientX, event.clientY);
    state.targetSlot = drop.targetSlot;
    state.paletteIndex = drop.paletteIndex;
    state.collapse = drop.collapse;
  } else {
    state.targetSlot = null;
    state.paletteIndex = null;
    state.collapse = false;
  }
};

const cleanupItemDrag = () => {
  window.removeEventListener('pointermove', handleItemDragMove);
  window.removeEventListener('pointerup', finishItemDrag);
  window.removeEventListener('pointercancel', cancelItemDrag);
  document.body.style.userSelect = ''; // 实现
  isDragActive.value = false;
};

const applyItemDrop = (state: PreviewDragState) => {
  const { source } = state;
  const key = source.key;
  let next: FooterLayoutSettings | null = null;

  if (source.type === 'bar') {
    if (state.targetSlot && state.targetSlot !== source.slot) {
      next = moveFooterItemToPreviewSlot(layout.value, key, state.targetSlot);
    } else if (state.collapse) {
      next = dropFooterItemToPalette(layout.value, key, -1);
    } else if (state.paletteIndex !== null) {
      next = dropFooterItemToPalette(layout.value, key, state.paletteIndex);
    }
  } else {
    if (state.targetSlot) {
      next = dropFooterItemToSlot(layout.value, key, state.targetSlot);
    } else if (state.paletteIndex !== null && state.paletteIndex !== source.index) {
      next = dropFooterItemToPalette(layout.value, key, state.paletteIndex);
    }
  }

  if (next) {
    patchFooterLayout(next);
    showToast('已更新底部栏布局', 'success');
  }
};

const finishItemDrag = () => {
  const state = dragState.value; // 实现
  if (state?.moved) applyItemDrop(state);
  dragState.value = null;
  cleanupItemDrag();
};

const cancelItemDrag = () => {
  dragState.value = null;
  cleanupItemDrag();
};

const restoreDefault = () => {
  patchFooterLayout({
    left: [...DEFAULT_FOOTER_LAYOUT.left],
    middleLeft: DEFAULT_FOOTER_LAYOUT.middleLeft,
    middleRight: DEFAULT_FOOTER_LAYOUT.middleRight,
    right: [...DEFAULT_FOOTER_LAYOUT.right],
    hidden: [],
    collapsed: [],
  });
  showToast('已恢复默认底栏布局', 'success');
};

// --- 更多工具弹出：参考真实底栏，「^」按钮上方向上浮出竖向堆叠的图标圆圈 ---
const showMoreTools = ref(false);
const moreWrapRef = ref<HTMLElement | null>(null);
const morePopupElRef = ref<HTMLElement | null>(null);
const morePopupStyle = ref<{ bottom: string; right: string }>({ bottom: '0px', right: '0px' });

const toggleMoreTools = () => {
  showMoreTools.value = !showMoreTools.value;
  if (showMoreTools.value && moreWrapRef.value) {
    const r = moreWrapRef.value.getBoundingClientRect();
    morePopupStyle.value = {
      bottom: `${window.innerHeight - r.top + 28}px`,
      right: `${window.innerWidth - r.right}px`,
    };
  }
};

const onMoreOutside = (event: MouseEvent) => {
  if (isDragActive.value) return;
  const wrap = moreWrapRef.value;
  const popup = morePopupElRef.value;
  const target = event.target as Node;
  if (showMoreTools.value && wrap && !wrap.contains(target) && popup && !popup.contains(target)) {
    showMoreTools.value = false;
  }
};

watch(showMoreTools, (open) => {
  if (open) window.addEventListener('mousedown', onMoreOutside);
  else window.removeEventListener('mousedown', onMoreOutside);
});

onUnmounted(() => {
  cancelItemDrag();
  window.removeEventListener('mousedown', onMoreOutside);
  showMoreTools.value = false;
});
</script>

<template>
  <section class="space-y-3">
    <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200"> 
      <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span> 
      底部栏布局与预览
    </h2>

    <div class="footer-layout-preview-container select-none overflow-hidden rounded-xl border border-gray-200/40 bg-white/20 dark:border-gray-800/40 dark:bg-black/10">
      <div class="footer-layout-preview-header"> 
        <div class="min-w-0 flex-1">
          <div class="truncate text-xs font-semibold text-gray-500 dark:text-gray-400">效果实时预览</div>
          <div class="mt-0.5 truncate text-[11px] text-gray-400 dark:text-white/40">直接拖拽即可布局：底部栏控件可拖到其他槽位交换、拖到「更多」收纳；收纳里的控件可拖回底部栏或拖拽排序</div>
        </div>
        <div class="flex items-center gap-2"> 
          <SettingHint text="封面、歌曲信息和上一首/播放/下一首为固定区域；其余按钮可在底部栏与「更多」收纳之间互相拖拽布局。" />
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
          <div class="footer-preview-cover shrink-0">
            <div class="h-full w-full bg-gradient-to-br from-[#EC4141] via-rose-400 to-orange-300"></div> 
          </div>
          <div class="footer-preview-track-info min-w-0 max-w-[112px] flex-1">
            <div class="truncate text-xs font-bold text-gray-800 dark:text-white">I'm leaving home</div> 
            <div class="mt-0.5 truncate text-[10px] text-gray-500 dark:text-white/45">Coastline</div> 
          </div>
          <div class="footer-preview-zone shrink-0">
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
                :class="{ 'footer-preview-control-shell--dragging': dragState?.source.type === 'bar' && dragState.source.key === previewSlots[slot] }"
                :title="`${getItemLabel(previewSlots[slot])}（拖拽调整位置）`" 
                @pointerdown="startItemDrag($event, { type: 'bar', key: previewSlots[slot]!, slot })"
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
                :class="{ 'footer-preview-control-shell--dragging': dragState?.source.type === 'bar' && dragState.source.key === previewSlots[slot] }"
                :title="`${getItemLabel(previewSlots[slot])}（拖拽调整位置）`" 
                @pointerdown="startItemDrag($event, { type: 'bar', key: previewSlots[slot]!, slot })"
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
                :class="{ 'footer-preview-control-shell--dragging': dragState?.source.type === 'bar' && dragState.source.key === previewSlots[slot] }"
                :title="`${getItemLabel(previewSlots[slot])}（拖拽调整位置）`" 
                @pointerdown="startItemDrag($event, { type: 'bar', key: previewSlots[slot]!, slot })"
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
                :class="{ 'footer-preview-control-shell--dragging': dragState?.source.type === 'bar' && dragState.source.key === previewSlots[slot] }"
                :title="`${getItemLabel(previewSlots[slot])}（拖拽调整位置）`" 
                @pointerdown="startItemDrag($event, { type: 'bar', key: previewSlots[slot]!, slot })"
              >
                <FooterControlItem :item-key="previewSlots[slot]!" />
              </div>
            </div>
          </div>
          <div ref="moreWrapRef" data-collapse-target class="footer-more-trigger-wrap relative flex items-center justify-center">
            <button
              type="button"
              class="footer-preview-more transition-colors w-8 h-8 flex items-center justify-center rounded-full text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10"
              :class="{
                'footer-preview-more--active': showMoreTools || dragState?.collapse,
                'footer-preview-more--collapse-target': dragState?.collapse,
              }"
              :title="showMoreTools ? '收起工具' : `更多工具：已收纳 ${collapsedPreviewItems.length} 个控件`"
              @click.stop="toggleMoreTools"
            >
              <ChevronUp
                class="h-4 w-4 transition-transform duration-300 ease-out"
                :class="showMoreTools ? 'rotate-180' : ''"
                :stroke-width="2.2"
              />
              <span v-if="collapsedPreviewItems.length > 0" class="footer-preview-more-badge">{{ collapsedPreviewItems.length }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="flex items-center justify-between gap-3 rounded-xl border border-gray-200/40 bg-white/20 px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.03]">
      <div class="flex min-w-0 items-center gap-2.5">
        <span class="footer-visibility-icon text-[#EC4141]"><FooterControlIcon item-key="visualizer" class="h-4 w-4" /></span>
        <div class="min-w-0">
          <div class="truncate text-sm font-medium text-gray-700 dark:text-gray-200">所有控件均通过拖拽布局</div>
          <div class="mt-0.5 text-[11px] text-gray-400 dark:text-white/35">底部栏与「更多」收纳互通：拖到其它槽位交换、拖到「^」收入收纳，收纳内可拖拽排序。</div>
        </div>
      </div>
      <div v-if="collapsedPreviewItems.length > 0" class="shrink-0 rounded-full bg-[#EC4141]/10 px-2.5 py-1 text-[11px] font-semibold text-[#EC4141]">
        更多菜单 {{ collapsedPreviewItems.length }} 项
      </div>
    </div>

    <Teleport to="body"> 
      <transition name="more-tools">
        <div
          v-if="showMoreTools"
          ref="morePopupElRef"
          class="footer-more-popup fixed z-[10030] flex flex-col items-center gap-2 pb-1"
          :style="morePopupStyle"
        >
          <div
            v-for="(key, index) in collapsedPreviewItems"
            :key="'collapsed-' + key"
            class="footer-more-item"
            :class="{
              'footer-more-item--dragging': dragState?.source.type === 'palette' && dragState.source.key === key,
              'footer-more-item--drop': dragState?.paletteIndex === index && dragState.source.key !== key,
            }"
            :data-palette-index="index"
            :title="`${getItemLabel(key)}（拖拽排序或拖入底部栏）`"
            @pointerdown="startItemDrag($event, { type: 'palette', index, key })"
          >
            <FooterControlItem :item-key="key" />
          </div>
          <div v-if="collapsedPreviewItems.length === 0" class="whitespace-nowrap rounded-xl border border-gray-200/40 bg-white/80 px-2.5 py-1 text-[10px] text-gray-400 dark:border-white/10 dark:bg-[#262626]/80 dark:text-white/35">
            暂无收纳的控件
          </div>
        </div>
      </transition>
    </Teleport>

    <Teleport to="body"> 
      <div
        v-if="dragState?.moved" 
        class="pointer-events-none fixed z-[10020] flex items-center gap-2 rounded-full border border-[#EC4141]/25 bg-white/20 px-3 py-2 text-[#EC4141] shadow-2xl backdrop-blur-xl dark:border-gray-800/40 dark:bg-black/10"
        :style="{ left: `${dragState.x + 14}px`, top: `${dragState.y + 14}px` }" 
      >
        <FooterControlIcon :item-key="dragState.source.key" class="h-4 w-4" />
        <span class="text-xs font-semibold">{{ getItemLabel(dragState.source.key) }}</span>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.footer-layout-preview-header { /* 样式 */
  display: flex; /* 样式 */
  align-items: center; /* 样式 */
  justify-content: space-between; /* 样式 */
  gap: 16px;
  padding: 12px 16px; /* 样式 */
  border-bottom: 1px solid rgba(255, 255, 255, 0.28);
}

.footer-preview-reset { /* 样式 */
  display: inline-flex; /* 样式 */
  align-items: center; /* 样式 */
  gap: 6px;
  padding: 7px 12px; /* 样式 */
  border-radius: 999px; /* 样式 */
  font-size: 12px; /* 样式 */
  font-weight: 600; /* 样式 */
  white-space: nowrap;
  flex-shrink: 0;
  transition: 160ms ease; /* 样式 */
}

.footer-preview-reset:hover { /* 样式 */
  color: #ec4141; /* 样式 */
}

.footer-player-preview { /* 样式 */
  display: flex; /* 样式 */
  align-items: center; /* 样式 */
  gap: 8px;
  padding: 10px 12px;
  min-height: 80px;
  overflow: hidden; /* 样式 */
}

.footer-preview-left, /* 样式 */
.footer-preview-center, /* 样式 */
.footer-preview-right, /* 样式 */
.footer-preview-zone { /* 样式 */
  display: flex; /* 样式 */
  align-items: center; /* 样式 */
}

.footer-preview-left { flex: 0 1 auto; min-width: 0; gap: 6px; }
.footer-preview-center { flex: 0 0 auto; justify-content: center; gap: 4px; margin-left: auto; margin-right: auto; }
.footer-preview-right { flex: 0 0 auto; justify-content: flex-end; gap: 2px; }
.footer-preview-zone { gap: 1px; }

.footer-preview-cover { /* 样式 */
  width: 44px;
  height: 44px;
  overflow: hidden; /* 样式 */
  flex: 0 0 auto; /* 样式 */
  border-radius: 9px; /* 样式 */
  box-shadow: 0 5px 16px rgba(236, 65, 65, 0.2); /* 样式 */
}

.footer-preview-slot { /* 样式 */
  display: grid; /* 样式 */
  width: 32px; /* 样式 */
  height: 36px; /* 样式 */
  place-items: center; /* 样式 */
  border: 1px dashed transparent; /* 样式 */
  border-radius: 10px; /* 样式 */
  transition: 150ms ease; /* 样式 */
}

.footer-preview-slot--empty {
  width: 0;
  opacity: 0;
  pointer-events: none;
}

.footer-preview-slot--empty.footer-preview-slot--drag-active {
  width: 32px; /* 样式 */
  opacity: 1;
  pointer-events: auto;
  border-color: rgba(148, 163, 184, 0.34);
}

.footer-preview-slot--target { /* 样式 */
  border-color: rgba(236, 65, 65, 0.7); /* 样式 */
  background: rgba(236, 65, 65, 0.1); /* 样式 */
  transform: scale(1.08); /* 样式 */
}

.footer-preview-control-shell {
  display: grid; /* 样式 */
  width: 32px; /* 样式 */
  height: 32px; /* 样式 */
  place-items: center; /* 样式 */
  cursor: grab; /* 样式 */
  touch-action: none; /* 样式 */
  overflow: hidden; /* 样式 */
}

.footer-preview-control-shell:active {
  cursor: grabbing;
}

.footer-preview-control-shell--dragging {
  opacity: 0.28;
  transform: scale(0.9);
}

.footer-preview-more {
  cursor: pointer;
}

.footer-preview-more--active {
  color: #ec4141; /* 样式 */
  background: rgba(236, 65, 65, 0.1); /* 样式 */
}

.footer-preview-more--collapse-target {
  color: #ec4141; /* 样式 */
  background: rgba(236, 65, 65, 0.18);
  box-shadow: 0 0 0 2px rgba(236, 65, 65, 0.25);
  transform: scale(1.12);
}

.footer-more-popup {
}

.footer-more-item {
  position: relative; /* 样式 */
  cursor: grab; /* 样式 */
  touch-action: none; /* 样式 */
  user-select: none;
}

.footer-more-item :deep(button),
.footer-more-item :deep(select) {
  pointer-events: none;
}

.footer-more-item:active {
  cursor: grabbing;
}

.footer-more-item--dragging {
  opacity: 0.4;
  transform: scale(0.9);
  cursor: grabbing;
}

.footer-more-item--drop {
  border: 1px dashed rgba(236, 65, 65, 0.7);
  outline: 1px dashed rgba(236, 65, 65, 0.6);
  border-radius: 999px; /* 样式 */
  background: rgba(236, 65, 65, 0.1); /* 样式 */
}

.more-tools-enter-active,
.more-tools-leave-active {
  transition: opacity 0.28s cubic-bezier(0.34, 1.56, 0.64, 1),
    transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.more-tools-enter-from,
.more-tools-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.9);
}

.more-tools-enter-to,
.more-tools-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
}

.footer-preview-more-badge {
  position: absolute; /* 样式 */
  top: -4px;
  right: -3px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 999px; /* 样式 */
  background: #ec4141; /* 样式 */
  color: white;
  font-size: 9px;
  font-weight: 700;
  line-height: 15px;
  box-shadow: 0 3px 8px rgba(236, 65, 65, 0.25);
}

.footer-visibility-row { /* 样式 */
  display: flex; /* 样式 */
  min-height: 48px; /* 样式 */
  align-items: center; /* 样式 */
  justify-content: space-between; /* 样式 */
  gap: 12px;
  padding: 7px 10px; /* 样式 */
  transition: 150ms ease; /* 样式 */
}

.footer-visibility-row:hover {
  color: #ec4141; /* 样式 */
}

.footer-visibility-icon { /* 样式 */
  display: grid; /* 样式 */
  width: 30px; /* 样式 */
  height: 30px; /* 样式 */
  place-items: center; /* 样式 */
  border-radius: 9px; /* 样式 */
  background: rgba(15, 23, 42, 0.035); /* 样式 */
}

:global(.dark) .footer-visibility-icon { background: rgba(255, 255, 255, 0.045); } /* 样式 */

.footer-visibility-switch { /* 样式 */
  position: relative; /* 样式 */
  width: 38px; /* 样式 */
  height: 22px; /* 样式 */
  flex: 0 0 auto; /* 样式 */
  border-radius: 999px; /* 样式 */
  border: 1px solid rgba(229, 231, 235, 0.4);
  background: rgba(0, 0, 0, 0.08);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  transition: 180ms ease; /* 样式 */
}

:global(.dark) .footer-visibility-switch {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.08);
}
.footer-visibility-switch--on { background: #ec4141 !important; } /* 样式 */

.footer-visibility-switch-thumb { /* 样式 */
  position: absolute; /* 样式 */
  top: 2px;
  left: 2px;
  width: 16px; /* 样式 */
  height: 16px; /* 样式 */
  border-radius: 999px; /* 样式 */
  background: white; /* 样式 */
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18); /* 样式 */
  transition: transform 180ms ease; /* 样式 */
}

.footer-visibility-switch--on .footer-visibility-switch-thumb { transform: translateX(17px); }

@media (min-width: 1200px) {
  .footer-player-preview { /* 样式 */
    gap: 12px;
    padding: 12px 14px;
  }
  .footer-preview-left { gap: 10px; }
  .footer-preview-center { gap: 7px; }
  .footer-preview-right { gap: 4px; }
  .footer-preview-zone { gap: 2px; }
  .footer-preview-cover {
    width: 46px;
    height: 46px;
  }
  .footer-preview-slot {
    width: 34px;
  }
}
</style>
