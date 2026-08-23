<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import {
  GripVertical,
  SlidersHorizontal,
  Trash2,
} from 'lucide-vue-next';
import { usePluginHostStore } from '../../features/pluginHost/store';
import { useI18n } from '../../features/i18n';
import { findVerticalScrollContainer, getEdgeAutoScrollSpeed, resolveDragTargetIndex } from '../../utils/dragSort';
import type { PluginHostRackSlotConfig } from '../../services/tauri/contracts';
import SlotParamsDialog from './SlotParamsDialog.vue';
import ConfirmModal from '../overlays/ConfirmModal.vue';

const store = usePluginHostStore();
const { rackConfig } = storeToRefs(store);
const { t } = useI18n();

const slotKey = (slot: PluginHostRackSlotConfig) => `${slot.format}::${slot.uniqueId}`;

const formatLabel = (format: string) => (format === 'vst3' ? 'VST3' : 'CLAP');

// ===== 槽位移除确认 =====
const showRemoveConfirm = ref(false);
const slotToRemove = ref<PluginHostRackSlotConfig | null>(null);

const requestRemoveSlot = (slot: PluginHostRackSlotConfig) => {
  slotToRemove.value = slot;
  showRemoveConfirm.value = true;
};

const confirmRemoveSlot = () => {
  showRemoveConfirm.value = false;
  if (!slotToRemove.value) return;
  store.removeSlot(slotToRemove.value.format, slotToRemove.value.uniqueId);
  slotToRemove.value = null;
};

// ===== 双击直接调起插件原生 UI 编辑器窗口 =====
const handleSlotDblClick = async (slot: PluginHostRackSlotConfig) => {
  if (!slot.enabled) {
    store.toggleSlot(slot.format, slot.uniqueId);
    await store.syncRackNow();
  }
  void store.openSlotEditor(slot.format, slot.uniqueId, slot.name);
};

// ===== 参数/预设弹窗（点击展开的详细机架）=====
const paramsSlot = ref<PluginHostRackSlotConfig | null>(null);

const openParams = (slot: PluginHostRackSlotConfig) => {
  paramsSlot.value = slot;
};

// ===== 机架链路拖拽排序（pointer 事件，复用 dragSort util）=====
const draggingIndex = ref<number | null>(null);
const listRef = ref<HTMLElement | null>(null);
const scrollContainer = ref<HTMLElement | null>(null);
let latestPointerY = 0;
let autoScrollFrame: number | null = null;

const resolveTargetIndex = (clientY: number, currentIndex: number): number | null =>
  resolveDragTargetIndex(listRef.value, '[data-rack-row]', clientY, currentIndex);

const updateDraggedItemPosition = (clientY: number) => {
  const currentIndex = draggingIndex.value;
  if (currentIndex === null) return;
  const target = resolveTargetIndex(clientY, currentIndex);
  if (target === null || target === currentIndex) return;
  store.reorderSlot(currentIndex, target);
  draggingIndex.value = target;
};

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
  if (event.button !== 0) return;
  event.preventDefault();
  draggingIndex.value = index;
  latestPointerY = event.clientY;
  scrollContainer.value = listRef.value ? findVerticalScrollContainer(listRef.value) : null;
  window.addEventListener('pointermove', handlePointerMove, { passive: false });
  window.addEventListener('pointerup', stopDragging);
  window.addEventListener('pointercancel', stopDragging);
};

onMounted(() => {
  // 移除自动扫描全盘 VST3 插件，避免加载系统损坏/加密的第三方 VST3 插件时引起崩溃闪退
});
</script>

<template>
  <div class="settings-content space-y-6">
    <!-- 机架链路（已安装插件式容器 + 拖拽排序） -->
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        {{ t('pluginHost.rackChain') }}
        <span
          v-if="rackConfig.slots.length > 0"
          class="text-xs font-normal text-gray-400 dark:text-white/35"
        >{{ t('pluginHost.slotCount', { count: rackConfig.slots.length }) }}</span>
      </h2>
      <div
        ref="listRef"
        class="flex flex-col overflow-hidden rounded-xl border border-gray-200/40 bg-white/20 dark:border-gray-800/40 dark:bg-black/10"
      >
        <div
          v-if="rackConfig.slots.length === 0"
          class="px-4 py-8 text-center text-xs leading-relaxed text-gray-400 dark:text-white/35"
        >
          {{ t('pluginHost.emptyRack') }}
        </div>

        <div v-else>
          <TransitionGroup name="rack-sort" tag="div" class="flex flex-col">
            <div
              v-for="(slot, index) in rackConfig.slots"
              :key="slotKey(slot)"
              data-rack-row
              class="rack-slot-card cursor-pointer"
              :class="{ 'rack-slot-card--dragging': draggingIndex === index }"
              title="双击调起插件原生 UI 编辑器"
              @dblclick="handleSlotDblClick(slot)"
            >
              <!-- 拖拽手柄 -->
              <div
                class="rack-drag-handle touch-none select-none"
                :class="{ 'cursor-grabbing': draggingIndex === index, 'cursor-grab': draggingIndex !== index }"
                :title="t('pluginHost.moveUp')"
                @pointerdown="startDragging(index, $event)"
              >
                <GripVertical class="h-5 w-5" />
              </div>

              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span
                    class="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
                    :class="slot.format === 'vst3'
                      ? 'bg-sky-500/10 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300'
                      : 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300'"
                  >{{ formatLabel(slot.format) }}</span>
                  <span class="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{{ slot.name }}</span>
                </div>
                <div class="mt-0.5 truncate text-[11px] text-gray-400 dark:text-white/35">
                  {{ slot.vendor || t('pluginHost.unknownVendor') }}<span v-if="!slot.enabled"> · {{ t('pluginHost.disabledSuffix') }}</span>
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  class="grid h-7 w-7 place-items-center rounded-lg text-gray-400 transition hover:bg-black/5 hover:text-gray-700 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/80"
                  :title="t('pluginHost.paramsPresets')"
                  @click="openParams(slot)"
                >
                  <SlidersHorizontal class="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none"
                  :class="slot.enabled ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
                  :title="slot.enabled ? t('pluginHost.disableSlot') : t('pluginHost.enableSlot')"
                  @click="store.toggleSlot(slot.format, slot.uniqueId)"
                >
                  <span
                    class="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out"
                    :class="slot.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'"
                  />
                </button>
                <button
                  type="button"
                  class="grid h-7 w-7 place-items-center rounded-lg text-gray-400 transition hover:bg-red-500/10 hover:text-red-500 dark:text-white/40"
                  :title="t('pluginHost.removeFromRack')"
                  @click="requestRemoveSlot(slot)"
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </TransitionGroup>
        </div>
      </div>
    </section>

    <SlotParamsDialog
      :visible="paramsSlot !== null"
      :entry="paramsSlot"
      @close="paramsSlot = null"
    />

    <ConfirmModal
      :visible="showRemoveConfirm"
      :title="t('pluginHost.removeTitle')"
      :content="slotToRemove ? t('pluginHost.removeContent', { name: slotToRemove.name }) : ''"
      @confirm="confirmRemoveSlot"
      @cancel="showRemoveConfirm = false"
    />
  </div>
</template>

<style scoped>
.rack-slot-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border: none;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 0;
  background: transparent;
  transition: background-color 160ms ease;
}

.rack-slot-card:last-child {
  border-bottom: none;
}

.rack-slot-card:hover {
  background: rgba(255, 255, 255, 0.4);
}

.dark .rack-slot-card:hover {
  background: rgba(255, 255, 255, 0.05);
}

/* 拖拽手柄 */
.rack-drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: rgba(148, 163, 184, 0.6);
  flex-shrink: 0;
  transition: color 160ms ease, background-color 160ms ease;
}

.rack-drag-handle:hover {
  color: rgba(100, 116, 139, 0.9);
  background: rgba(148, 163, 184, 0.1);
}

.rack-slot-card--dragging {
  background: rgba(236, 65, 65, 0.06);
}

/* FLIP 排序动画 */
.rack-sort-move {
  transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  .rack-sort-move {
    transition: none;
  }
}
</style>