<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import {
  FolderOpen,
  GripVertical,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-vue-next';
import { open } from '@tauri-apps/plugin-dialog';
import { usePluginHostStore } from '../../features/pluginHost/store';
import { useI18n } from '../../features/i18n';
import { findVerticalScrollContainer, getEdgeAutoScrollSpeed, resolveDragTargetIndex } from '../../utils/dragSort';
import type { PluginHostRackSlotConfig } from '../../services/tauri/contracts';
import SlotParamsDialog from './SlotParamsDialog.vue';
import ConfirmModal from '../overlays/ConfirmModal.vue';

const store = usePluginHostStore();
const { rackConfig, isScanning, currentScanningPath, timeoutPluginPath, extraDirs, dismissedCount } = storeToRefs(store);
const { t } = useI18n();

const slotKey = (slot: PluginHostRackSlotConfig) => `${slot.format}::${slot.uniqueId}`;

const formatLabel = (format: string) => (format === 'vst3' ? 'VST3' : 'CLAP');

// ===== 搜索过滤（搜索时禁用拖拽，避免索引错位）=====
const searchQuery = ref('');
const filteredSlots = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return rackConfig.value.slots;
  return rackConfig.value.slots.filter(slot =>
    slot.name.toLowerCase().includes(q)
    || slot.vendor.toLowerCase().includes(q)
    || slot.format.toLowerCase().includes(q)
  );
});
const draggingEnabled = computed(() => !searchQuery.value.trim());

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

// ===== 插件扫描超时/卡死确认弹窗 =====
const showTimeoutModal = ref(false);
const currentTimeoutPath = ref('');
const rememberTimeoutAction = ref<'skip' | 'ignore' | null>(null);
const isRememberChecked = ref(false);

watch(timeoutPluginPath, (path) => {
  if (!path) return;
  currentTimeoutPath.value = path;

  // 记忆操作逻辑：若此前已勾选记忆且选择为跳过/禁用，后续超时插件全自动禁用跳过，不再弹窗打扰
  if (rememberTimeoutAction.value === 'skip') {
    store.disablePluginPath(path);
    store.timeoutPluginPath = '';
    return;
  }
  if (rememberTimeoutAction.value === 'ignore') {
    store.timeoutPluginPath = '';
    return;
  }

  isRememberChecked.value = false;
  showTimeoutModal.value = true;
});

const handleSkipTimeoutPlugin = () => {
  showTimeoutModal.value = false;
  if (isRememberChecked.value) {
    rememberTimeoutAction.value = 'skip';
  }
  if (currentTimeoutPath.value) {
    store.disablePluginPath(currentTimeoutPath.value);
    store.timeoutPluginPath = '';
    void store.scan();
  }
};

const handleIgnoreTimeout = () => {
  showTimeoutModal.value = false;
  if (isRememberChecked.value) {
    rememberTimeoutAction.value = 'ignore';
  }
  store.timeoutPluginPath = '';
};

// ===== 自定义扫描目录 =====
const handleAddExtraDir = async () => {
  try {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === 'string' && selected.trim()) {
      store.addExtraDir(selected);
    }
  } catch {
    // 对话框取消
  }
};

const showRemoveDirConfirm = ref(false);
const dirToRemove = ref<string | null>(null);

const showDirsModal = ref(false);

const requestRemoveDir = (dir: string) => {
  dirToRemove.value = dir;
  showRemoveDirConfirm.value = true;
};

const confirmRemoveDir = () => {
  showRemoveDirConfirm.value = false;
  if (!dirToRemove.value) return;
  store.removeExtraDir(dirToRemove.value);
  dirToRemove.value = null;
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
  if (!draggingEnabled.value) return;
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
    <!-- 机架链路（已安装插件式容器 + 拖拽排序 + 扫描入口） -->
    <section class="space-y-3">
      <div class="flex items-center justify-between gap-2">
        <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          {{ t('pluginHost.rackChain') }}
          <span
            v-if="rackConfig.slots.length > 0"
            class="text-xs font-normal text-gray-400 dark:text-white/35"
          >{{ t('pluginHost.slotCount', { count: rackConfig.slots.length }) }}</span>
        </h2>
        <div class="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            class="relative flex shrink-0 items-center rounded-lg border border-[#EC4141]/25 bg-[#EC4141]/10 px-2.5 py-1.5 text-xs font-medium text-[#EC4141] transition hover:bg-[#EC4141]/20 dark:text-[#ff8b8b]"
            :title="t('pluginHost.customScanDirs')"
            @click="showDirsModal = true"
          >
            <FolderOpen class="h-3.5 w-3.5" />
            <span
              v-if="extraDirs.length > 0"
              class="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#EC4141] px-1 text-[9px] font-semibold leading-none text-white"
            >{{ extraDirs.length }}</span>
          </button>
          <button
            type="button"
            class="flex shrink-0 items-center gap-1 rounded-lg border border-[#EC4141]/25 bg-[#EC4141]/10 px-2.5 py-1.5 text-xs font-medium text-[#EC4141] transition hover:bg-[#EC4141]/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#ff8b8b]"
            :disabled="isScanning"
            @click="store.scan()"
          >
            <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': isScanning }" />
            {{ isScanning ? t('pluginHost.scanning') : t('pluginHost.rescan') }}
          </button>
        </div>
      </div>

      <!-- 正在扫描提示条 -->
      <div
        v-if="isScanning"
        class="flex items-center gap-2 rounded-lg border border-[#EC4141]/20 bg-[#EC4141]/5 px-3 py-2 text-[11px] font-medium text-[#EC4141] dark:border-white/5 dark:bg-[#EC4141]/10"
      >
        <RefreshCw class="h-3 w-3 shrink-0 animate-spin" />
        <span class="shrink-0 font-semibold">{{ t('pluginHost.scanningCurrent') }}</span>
        <span class="min-w-0 flex-1 truncate font-mono text-[10px] opacity-80" :title="currentScanningPath">
          {{ currentScanningPath || t('pluginHost.scanningDirs') }}
        </span>
      </div>

      <!-- 搜索框 -->
      <div v-if="rackConfig.slots.length > 0" class="relative">
        <Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-white/35" />
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="t('pluginHost.searchPlaceholder')"
          class="h-7 w-full rounded-lg border border-black/10 bg-black/5 pl-8 pr-7 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:ring-1 focus:ring-[#EC4141]/20 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-white"
          :title="t('pluginHost.clearSearch')"
          @click="searchQuery = ''"
        >
          <X class="h-3 w-3" />
        </button>
      </div>

      <!-- 槽位列表 -->
      <div
        ref="listRef"
        class="flex flex-col overflow-hidden rounded-xl border border-gray-200/40 bg-white/20 dark:border-gray-800/40 dark:bg-black/10"
      >
        <div
          v-if="filteredSlots.length === 0 && !isScanning"
          class="px-4 py-8 text-center text-xs leading-relaxed text-gray-400 dark:text-white/35"
        >
          {{ t('pluginHost.emptyRack') }}
        </div>
        <div
          v-else-if="filteredSlots.length === 0 && isScanning"
          class="px-4 py-8 text-center text-xs text-gray-400 dark:text-white/35"
        >
          {{ t('pluginHost.scanningDirs') }}
        </div>

        <div v-else>
          <TransitionGroup name="rack-sort" tag="div" class="flex flex-col">
            <div
              v-for="(slot, index) in filteredSlots"
              :key="slotKey(slot)"
              data-rack-row
              class="rack-slot-card cursor-pointer"
              :class="{ 'rack-slot-card--dragging': draggingIndex === index, 'rack-slot-card--disabled': !slot.enabled }"
              :title="t('pluginHost.dblClickHint')"
              @dblclick="handleSlotDblClick(slot)"
            >
              <!-- 拖拽手柄 -->
              <div
                class="rack-drag-handle touch-none select-none"
                :class="draggingEnabled
                  ? (draggingIndex === index ? 'cursor-grabbing' : 'cursor-grab')
                  : 'cursor-not-allowed opacity-40'"
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

      <!-- 恢复已移除 -->
      <div
        v-if="dismissedCount > 0"
        class="flex items-center justify-between gap-2 rounded-lg border border-gray-200/40 bg-white/20 px-3 py-2 dark:border-gray-800/40 dark:bg-black/10"
      >
        <span class="min-w-0 flex-1 truncate text-xs text-gray-500 dark:text-white/45">
          {{ t('pluginHost.dismissedHint', { count: dismissedCount }) }}
        </span>
        <button
          type="button"
          class="flex shrink-0 items-center gap-1 rounded-lg border border-[#EC4141]/25 bg-[#EC4141]/10 px-2.5 py-1 text-xs font-medium text-[#EC4141] transition hover:bg-[#EC4141]/20 dark:text-[#ff8b8b]"
          @click="store.restoreDismissed()"
        >
          <RefreshCw class="h-3 w-3" />
          {{ t('pluginHost.restoreRemoved') }}
        </button>
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

    <ConfirmModal
      :visible="showRemoveDirConfirm"
      :title="t('pluginHost.removeDirTitle')"
      :content="dirToRemove ? t('pluginHost.removeDirContent') : ''"
      @confirm="confirmRemoveDir"
      @cancel="showRemoveDirConfirm = false"
    />

    <!-- 插件扫描超时/卡死确认弹窗 -->
    <ConfirmModal
      :visible="showTimeoutModal"
      :title="t('pluginHost.timeoutTitle')"
      :content="t('pluginHost.timeoutContent', { name: currentTimeoutPath.split(/[/\\]/).pop() ?? '' })"
      @confirm="handleSkipTimeoutPlugin"
      @cancel="handleIgnoreTimeout"
    >
      <label class="mt-3.5 flex cursor-pointer items-center justify-center gap-2 text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors">
        <input
          v-model="isRememberChecked"
          type="checkbox"
          class="h-3.5 w-3.5 rounded border-gray-300 text-[#EC4141] focus:ring-[#EC4141] cursor-pointer"
        />
        <span>{{ t('pluginHost.rememberTimeout') }}</span>
      </label>
    </ConfirmModal>

    <!-- 自定义扫描目录弹窗（窄纵向列表） -->
    <Teleport to="body">
      <Transition name="modal-pop">
        <div
          v-if="showDirsModal"
          class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
        >
          <div class="modal-content flex max-h-[calc(100vh-4rem)] w-full max-w-[360px] flex-col overflow-hidden">
            <!-- 顶栏 -->
            <div class="flex shrink-0 items-center justify-between border-b border-gray-200/70 px-5 py-4 dark:border-white/10">
              <div class="flex min-w-0 items-center gap-2">
                <FolderOpen class="h-4 w-4 shrink-0 text-[#EC4141]" />
                <h2 class="truncate text-sm font-bold text-gray-800 dark:text-gray-100">{{ t('pluginHost.customScanDirs') }}</h2>
                <span
                  v-if="extraDirs.length > 0"
                  class="shrink-0 text-xs text-gray-400 dark:text-white/35"
                >{{ t('pluginHost.count', { count: extraDirs.length }) }}</span>
              </div>
              <button
                type="button"
                class="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-gray-400 transition hover:bg-black/5 hover:text-gray-700 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/80"
                :title="t('topbar.close')"
                @click="showDirsModal = false"
              >
                <X class="h-4 w-4" />
              </button>
            </div>

            <!-- 主体 -->
            <div class="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <p class="text-xs leading-relaxed text-gray-500 dark:text-white/45">{{ t('pluginHost.scanDirsHint') }}</p>

              <button
                type="button"
                class="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#EC4141]/25 bg-[#EC4141]/10 px-3 py-2 text-xs font-medium text-[#EC4141] transition hover:bg-[#EC4141]/20 dark:text-[#ff8b8b]"
                @click="handleAddExtraDir"
              >
                <FolderOpen class="h-3.5 w-3.5" />
                {{ t('pluginHost.addDir') }}
              </button>

              <p
                v-if="extraDirs.length === 0"
                class="mt-3 rounded-lg border border-dashed border-gray-200/60 px-3 py-3 text-center text-xs leading-relaxed text-gray-400 dark:border-white/10 dark:text-white/35"
              >
                {{ t('pluginHost.noDirsHint') }}
              </p>
              <div
                v-else
                class="mt-3 space-y-px"
              >
                <div
                  v-for="dir in extraDirs"
                  :key="dir"
                  class="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <div class="min-w-0 flex-1 truncate text-xs text-gray-800 dark:text-gray-200" :title="dir">{{ dir }}</div>
                  <button
                    type="button"
                    class="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-gray-400 transition hover:bg-red-500/10 hover:text-red-500 dark:text-white/40"
                    :title="t('pluginHost.removeDirTooltip')"
                    @click="requestRemoveDir(dir)"
                  >
                    <Trash2 class="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
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
  transition: background-color 160ms ease, opacity 160ms ease;
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

/* 停用槽位弱化，让启用项在链路中更醒目 */
.rack-slot-card--disabled {
  opacity: 0.6;
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
