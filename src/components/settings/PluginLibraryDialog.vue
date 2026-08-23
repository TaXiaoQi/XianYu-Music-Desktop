<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { Check, Plus, RefreshCw, Search, X } from 'lucide-vue-next';
import { usePluginHostStore } from '../../features/pluginHost/store';
import { useI18n } from '../../features/i18n';
import ConfirmModal from '../overlays/ConfirmModal.vue';
import type { PluginHostScanEntry } from '../../services/tauri/contracts';

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ close: [] }>();

const store = usePluginHostStore();
const { scannedPlugins, isScanning, hasScanned, currentScanningPath, timeoutPluginPath } = storeToRefs(store);
const { t } = useI18n();

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

const open = ref(false);

const openAnimated = () => {
  nextTick(() => { open.value = true; });
};

watch(() => props.visible, (visible) => {
  if (visible) openAnimated();
  else open.value = false;
});

onMounted(() => {
  if (props.visible) openAnimated();
});

const requestClose = () => emit('close');

// ===== 实时搜索与关键词高亮 =====
const searchQuery = ref('');

const scannedSorted = computed(() => {
  let list = [...scannedPlugins.value];
  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter(entry =>
      entry.name.toLowerCase().includes(q)
      || entry.vendor.toLowerCase().includes(q)
      || entry.format.toLowerCase().includes(q)
    );
  }
  return list;
});

/** 提取文本在搜索关键词下的匹配/非匹配片段 */
function getHighlightSegments(text: string, query: string): Array<{ text: string; isMatch: boolean }> {
  if (!query || !query.trim() || !text) {
    return [{ text, isMatch: false }];
  }
  const q = query.trim();
  const lowerText = text.toLowerCase();
  const lowerQuery = q.toLowerCase();

  const segments: Array<{ text: string; isMatch: boolean }> = [];
  let start = 0;
  let index = lowerText.indexOf(lowerQuery, start);

  while (index !== -1) {
    if (index > start) {
      segments.push({ text: text.slice(start, index), isMatch: false });
    }
    segments.push({ text: text.slice(index, index + q.length), isMatch: true });
    start = index + q.length;
    index = lowerText.indexOf(lowerQuery, start);
  }

  if (start < text.length) {
    segments.push({ text: text.slice(start), isMatch: false });
  }

  return segments;
}

const formatLabel = (format: string) => (format === 'vst3' ? 'VST3' : 'CLAP');

const categoryLabel = (category: string) => {
  switch (category) {
    case 'effect': return t('pluginHost.catEffect');
    case 'instrument': return t('pluginHost.catInstrument');
    case 'noteEffect': return t('pluginHost.catNoteEffect');
    case 'analyzer': return t('pluginHost.catAnalyzer');
    case 'tool': return t('pluginHost.catTool');
    default: return category;
  }
};

const versionLabel = (version: number) => {
  if (!version) return '';
  return `v${(version >> 16) & 0xffff}.${(version >> 8) & 0xff}.${version & 0xff}`;
};

const handleAddSlot = (index: number) => {
  const entry = scannedSorted.value[index];
  if (!entry) return;
  if (store.isSlotInRack(entry.format, entry.uniqueId)) return;
  store.addSlot(entry);
};

// 双击可用插件项：若未在机架中自动加入，并直接打开原生 UI 编辑器
const handlePluginDblClick = async (entry: PluginHostScanEntry) => {
  if (!store.isSlotInRack(entry.format, entry.uniqueId)) {
    store.addSlot(entry);
    await store.syncRackNow();
  }
  void store.openSlotEditor(entry.format, entry.uniqueId, entry.name);
};

const handleScan = () => {
  void store.scan();
};
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-pop">
      <div
        v-if="open"
        class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      >
        <div
          class="modal-content flex max-h-[calc(100vh-4rem)] w-full max-w-[480px] flex-col overflow-hidden"
        >
          <!-- 顶栏 -->
          <div class="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200/70 px-4 py-3.5 dark:border-white/10">
            <div class="flex shrink-0 items-center gap-1.5">
              <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
              <h2 class="truncate text-sm font-bold text-gray-800 dark:text-gray-100">{{ t('pluginHost.availablePlugins') }}</h2>
              <span
                v-if="hasScanned && scannedPlugins.length > 0"
                class="shrink-0 text-xs font-normal text-gray-400 dark:text-white/35"
              >{{ t('pluginHost.count', { count: scannedPlugins.length }) }}</span>
            </div>

            <!-- 搜索框（支持实时搜索与高亮） -->
            <div class="relative flex min-w-0 flex-1 items-center mx-1">
              <Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-white/35" />
              <input
                v-model="searchQuery"
                type="text"
                placeholder="搜索插件..."
                class="h-7 w-full rounded-lg border border-black/10 bg-black/5 pl-8 pr-7 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:ring-1 focus:ring-[#EC4141]/20 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35"
              />
              <button
                v-if="searchQuery"
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-white"
                title="清空"
                @click="searchQuery = ''"
              >
                <X class="h-3 w-3" />
              </button>
            </div>

            <div class="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                class="flex shrink-0 items-center gap-1 rounded-lg border border-[#EC4141]/25 bg-[#EC4141]/10 px-2.5 py-1.5 text-xs font-medium text-[#EC4141] transition hover:bg-[#EC4141]/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#ff8b8b]"
                :disabled="isScanning"
                @click="handleScan"
              >
                <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': isScanning }" />
                {{ isScanning ? t('pluginHost.scanning') : t('pluginHost.rescan') }}
              </button>
              <button
                type="button"
                class="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-gray-400 transition hover:bg-black/5 hover:text-gray-700 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/80"
                :title="t('topbar.close')"
                @click="requestClose"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
          </div>

          <!-- 正在扫描提示条 -->
          <div
            v-if="isScanning"
            class="flex items-center gap-2 border-b border-black/5 bg-[#EC4141]/5 px-5 py-2 text-[11px] font-medium text-[#EC4141] dark:border-white/5 dark:bg-[#EC4141]/10"
          >
            <RefreshCw class="h-3 w-3 shrink-0 animate-spin" />
            <span class="shrink-0 font-semibold">正在扫描：</span>
            <span class="min-w-0 flex-1 truncate font-mono text-[10px] opacity-80" :title="currentScanningPath">
              {{ currentScanningPath || t('pluginHost.scanningDirs') }}
            </span>
          </div>

          <!-- 插件列表 -->
          <div class="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
            <div v-if="!hasScanned && !isScanning" class="px-4 py-10 text-center text-xs text-gray-400 dark:text-white/35">
              点击上方「重新扫描」开始检索系统的 VST3 与 CLAP 插件
            </div>
            <div v-else-if="scannedSorted.length === 0 && isScanning" class="px-4 py-10 text-center text-xs text-gray-400 dark:text-white/35">
              {{ t('pluginHost.scanningDirs') }}
            </div>
            <div v-else-if="scannedSorted.length === 0 && !isScanning" class="px-4 py-10 text-center text-xs leading-relaxed text-gray-400 dark:text-white/35">
              {{ t('pluginHost.noPluginsFoundA') }}<br>
              {{ t('pluginHost.noPluginsFoundB') }}
            </div>
            <div v-else class="space-y-px">
              <div
                v-for="(entry, index) in scannedSorted"
                :key="`${entry.format}-${entry.uniqueId}`"
                class="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                title="双击打开插件原生 UI 编辑器"
                @dblclick="handlePluginDblClick(entry)"
              >
                <span
                  class="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
                  :class="entry.format === 'vst3'
                    ? 'bg-sky-500/10 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300'
                    : 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300'"
                >{{ formatLabel(entry.format) }}</span>
                <div class="min-w-0 flex-1">
                  <div class="truncate text-xs font-medium text-gray-800 dark:text-gray-200" :title="entry.path">
                    <template v-for="(seg, idx) in getHighlightSegments(entry.name, searchQuery)" :key="idx">
                      <mark v-if="seg.isMatch" class="rounded-[2px] bg-[#EC4141]/20 px-0.5 font-bold text-[#EC4141] dark:bg-[#EC4141]/30 dark:text-[#ff8b8b]">{{ seg.text }}</mark>
                      <template v-else>{{ seg.text }}</template>
                    </template>
                  </div>
                  <div class="truncate text-[11px] text-gray-400 dark:text-white/35">
                    <template v-for="(seg, idx) in getHighlightSegments(entry.vendor, searchQuery)" :key="idx">
                      <mark v-if="seg.isMatch" class="rounded-[2px] bg-[#EC4141]/20 px-0.5 font-bold text-[#EC4141] dark:bg-[#EC4141]/30 dark:text-[#ff8b8b]">{{ seg.text }}</mark>
                      <template v-else>{{ seg.text }}</template>
                    </template>
                    <span>{{ [categoryLabel(entry.category), versionLabel(entry.version)].filter(Boolean).map(s => ` · ${s}`).join('') }}</span>
                  </div>
                </div>
                <button
                  type="button"
                  class="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition"
                  :class="store.isSlotInRack(entry.format, entry.uniqueId)
                    ? 'cursor-default text-gray-400 dark:text-white/30'
                    : 'border border-[#EC4141]/25 bg-[#EC4141]/10 text-[#EC4141] hover:bg-[#EC4141]/20 dark:text-[#ff8b8b]'"
                  :disabled="store.isSlotInRack(entry.format, entry.uniqueId)"
                  @click="handleAddSlot(index)"
                >
                  <Check v-if="store.isSlotInRack(entry.format, entry.uniqueId)" class="h-3 w-3" />
                  <Plus v-else class="h-3 w-3" />
                  {{ store.isSlotInRack(entry.format, entry.uniqueId) ? t('pluginHost.alreadyInRack') : t('pluginHost.add') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 插件扫描超时/卡死确认弹窗 -->
    <ConfirmModal
      :visible="showTimeoutModal"
      title="插件扫描响应超时"
      :content="`检测到当前插件 [${currentTimeoutPath.split(/[/\\]/).pop()}] 扫描响应时间超过 4 秒，可能存在加密锁失联、卡死或底层不兼容。是否跳过并禁用该插件？`"
      @confirm="handleSkipTimeoutPlugin"
      @cancel="handleIgnoreTimeout"
    >
      <label class="mt-3.5 flex cursor-pointer items-center justify-center gap-2 text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors">
        <input
          v-model="isRememberChecked"
          type="checkbox"
          class="h-3.5 w-3.5 rounded border-gray-300 text-[#EC4141] focus:ring-[#EC4141] cursor-pointer"
        />
        <span>记忆操作，为后续所有问题插件应用</span>
      </label>
    </ConfirmModal>
  </Teleport>
</template>