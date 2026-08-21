<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Check,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  SquareArrowOutUpRight,
  Trash2,
} from 'lucide-vue-next';
import { usePluginHostStore } from '../../features/pluginHost/store';
import {
  getParameterValues,
  getPluginParameters,
  getPluginPresets,
  loadPreset,
} from '../../services/tauri/pluginHostApi';
import { useToast } from '../../composables/toast';
import type {
  PluginHostParameterValueEntry,
  PluginHostParameterEntry,
  PluginHostPresetEntry,
  PluginHostRackSlotConfig,
} from '../../services/tauri/contracts';
import ConfirmModal from '../overlays/ConfirmModal.vue';

const store = usePluginHostStore();
const { rackConfig, scannedPlugins, isScanning, hasScanned, extraDirs } = storeToRefs(store);
const { showToast } = useToast();

const slotKey = (slot: PluginHostRackSlotConfig) => `${slot.format}::${slot.uniqueId}`;

// ===== 扫描 =====
const handleScan = () => {
  void store.scan();
};

// ===== 自定义面板目录 =====
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

const handleRemoveExtraDir = (dir: string) => {
  store.removeExtraDir(dir);
};

const formatLabel = (format: string) => (format === 'vst3' ? 'VST3' : 'CLAP');

const categoryLabel = (category: string) => {
  switch (category) {
    case 'effect': return '效果';
    case 'instrument': return '乐器';
    case 'noteEffect': return '音符效果';
    case 'analyzer': return '分析';
    case 'tool': return '工具';
    default: return category;
  }
};

const versionLabel = (version: number) => {
  if (!version) return '';
  return `v${(version >> 16) & 0xffff}.${(version >> 8) & 0xff}.${version & 0xff}`;
};

const handleAddSlot = (index: number) => {
  const entry = scannedPlugins.value[index];
  if (!entry) return;
  if (store.isSlotInRack(entry.format, entry.uniqueId)) return;
  store.addSlot(entry);
};

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

// ===== 参数 / 预设面板 =====
interface SlotPanel {
  expanded: boolean;
  loading: boolean;
  error: string | null;
  loaded: boolean;
  params: PluginHostParameterEntry[];
  values: Record<number, PluginHostParameterValueEntry>;
  presets: PluginHostPresetEntry[];
  presetNumber: number | null;
  /** 最近一次用户拖动参数的时间戳（毫秒），期间暂停轮询回写避免滑块回跳。 */
  lastUserEdit: number;
}

const panels = reactive<Record<string, SlotPanel>>({});

const EMPTY_PANEL: SlotPanel = {
  expanded: false,
  loading: false,
  error: null,
  loaded: false,
  params: [],
  values: {},
  presets: [],
  presetNumber: null,
  lastUserEdit: 0,
};

/** 只读访问（渲染期使用，不创建面板避免渲染期响应式写入）。 */
const panelOf = (slot: PluginHostRackSlotConfig): SlotPanel => panels[slotKey(slot)] ?? EMPTY_PANEL;

const ensurePanel = (key: string): SlotPanel => {
  if (!panels[key]) {
    panels[key] = { ...EMPTY_PANEL, values: {}, params: [], presets: [] };
  }
  return panels[key];
};

const setPanelValues = (panel: SlotPanel, values: PluginHostParameterValueEntry[]) => {
  const next: Record<number, PluginHostParameterValueEntry> = {};
  for (const entry of values) next[entry.index] = entry;
  panel.values = next;
};

const loadPanel = async (slot: PluginHostRackSlotConfig) => {
  const key = slotKey(slot);
  const panel = ensurePanel(key);
  panel.loading = true;
  panel.error = null;
  try {
    const [params, values, presets] = await Promise.all([
      getPluginParameters(slot.format, slot.uniqueId, slot.path),
      getParameterValues(slot.format, slot.uniqueId, slot.path),
      getPluginPresets(slot.format, slot.uniqueId, slot.path).catch(() => []),
    ]);
    panel.params = params;
    panel.presets = presets;
    if (presets.length > 0 && panel.presetNumber === null) {
      panel.presetNumber = presets[0].presetNumber;
    }
    setPanelValues(panel, values);
    panel.loaded = true;
  } catch (err) {
    panel.error = `参数读取失败: ${err}`;
  } finally {
    panel.loading = false;
  }
};

const togglePanel = (slot: PluginHostRackSlotConfig) => {
  const key = slotKey(slot);
  const panel = ensurePanel(key);
  panel.expanded = !panel.expanded;
  if (panel.expanded && !panel.loaded && !panel.loading) {
    void loadPanel(slot);
  }
};

const visibleParams = (panel: SlotPanel) => panel.params.filter(p => !p.hidden);

const paramValue = (panel: SlotPanel, param: PluginHostParameterEntry) =>
  panel.values[param.index]?.value ?? (param.default - param.min) / (param.max - param.min || 1);

const paramText = (panel: SlotPanel, param: PluginHostParameterEntry) => {
  const polled = panel.values[param.index]?.text;
  if (polled) return polled;
  const native = param.min + paramValue(panel, param) * (param.max - param.min);
  return `${native.toFixed(2)}${param.unit}`;
};

const paramStep = (param: PluginHostParameterEntry) =>
  param.stepCount > 0 ? 1 / param.stepCount : 0.001;

const handleParamInput = (
  slot: PluginHostRackSlotConfig,
  panel: SlotPanel,
  param: PluginHostParameterEntry,
  event: Event,
) => {
  const value = Number.parseFloat((event.target as HTMLInputElement).value);
  if (!Number.isFinite(value)) return;
  panel.lastUserEdit = Date.now();
  const existing = panel.values[param.index];
  panel.values[param.index] = {
    index: param.index,
    id: param.id,
    value,
    text: existing?.text ?? '',
  };
  void store.setSlotParameter(slot.format, slot.uniqueId, param.index, value);
};

const handlePresetChange = async (
  slot: PluginHostRackSlotConfig,
  panel: SlotPanel,
  presetNumber: number,
) => {
  try {
    await loadPreset(slot.format, slot.uniqueId, slot.path, presetNumber);
    const values = await getParameterValues(slot.format, slot.uniqueId, slot.path);
    setPanelValues(panel, values);
    store.applySlotParams(
      slot.format,
      slot.uniqueId,
      Object.fromEntries(values.map(v => [v.index, v.value])),
    );
  } catch (err) {
    showToast(`预设加载失败: ${err}`, 'error');
  }
};

// ===== 编辑器打开期间的参数值轮询（原生 GUI 内改参实时反映）=====
let pollTimer: ReturnType<typeof setInterval> | null = null;

const pollOpenEditorValues = async () => {
  for (const slot of rackConfig.value.slots) {
    if (!store.isEditorOpen(slot.format, slot.uniqueId)) continue;
    const panel = panels[slotKey(slot)];
    if (!panel?.expanded || !panel.loaded || panel.loading) continue;
    if (Date.now() - panel.lastUserEdit < 1500) continue;
    try {
      const values = await getParameterValues(slot.format, slot.uniqueId, slot.path);
      setPanelValues(panel, values);
    } catch {
      // 插件被移除等场景忽略
    }
  }
};

const handleEditorToggle = (slot: PluginHostRackSlotConfig) => {
  if (store.isEditorOpen(slot.format, slot.uniqueId)) {
    void store.closeSlotEditor(slot.format, slot.uniqueId);
  } else {
    void store.openSlotEditor(slot.format, slot.uniqueId, slot.name);
  }
};

const scannedSorted = computed(() => [...scannedPlugins.value]);

onMounted(() => {
  void store.refreshEditors();
  if (!hasScanned.value && !isScanning.value) {
    void store.scan();
  }
  pollTimer = setInterval(() => { void pollOpenEditorValues(); }, 1000);
});

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
});
</script>

<template>
  <div class="settings-content space-y-6">
    <!-- 机架总开关 -->
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        效果插件机架
      </h2>
      <div class="flex flex-col overflow-hidden rounded-xl border border-gray-200/40 bg-white/20 dark:border-gray-800/40 dark:bg-black/10">
        <div class="flex items-center justify-between p-4 transition-colors hover:bg-white/40 dark:hover:bg-white/10">
          <div class="min-w-0">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">启用插件机架</div>
            <div class="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-white/45">
              按机架顺序处理播放音频（均衡器之后、音量之前）；Bit-perfect 与 DSD 直出时自动旁路。
            </div>
          </div>
          <button
            type="button"
            class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none"
            :class="rackConfig.masterEnabled ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
            @click="store.setMasterEnabled(!rackConfig.masterEnabled)"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out"
              :class="rackConfig.masterEnabled ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>
      </div>
    </section>

    <!-- 自定义扫描目录 -->
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        自定义扫描目录
        <span
          v-if="extraDirs.length > 0"
          class="text-xs font-normal text-gray-400 dark:text-white/35"
        >{{ extraDirs.length }} 个</span>
      </h2>
      <div class="flex flex-col overflow-hidden rounded-xl border border-gray-200/40 bg-white/20 dark:border-gray-800/40 dark:bg-black/10">
        <div class="flex items-center justify-between gap-3 px-4 py-3">
          <div class="text-xs leading-relaxed text-gray-500 dark:text-white/45">
            添加后自动重新扫描，插件将出现在下方「可用插件」列表。目录类别按目录名或内容自动识别 VST3 / CLAP。
          </div>
          <button
            type="button"
            class="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#EC4141]/25 bg-[#EC4141]/10 px-3 py-1.5 text-xs font-medium text-[#EC4141] transition hover:bg-[#EC4141]/20 dark:text-[#ff8b8b]"
            @click="handleAddExtraDir"
          >
            <FolderOpen class="h-3.5 w-3.5" />
            添加目录
          </button>
        </div>

        <div
          v-if="extraDirs.length === 0"
          class="border-t border-gray-200/40 px-4 py-6 text-center text-xs text-gray-400 dark:border-gray-800/40 dark:text-white/35"
        >
          未添加自定义目录。插件默认从系统标准目录扫描；如需从其他位置加载，请在此添加。
        </div>
        <div v-else class="custom-scrollbar max-h-56 space-y-px overflow-y-auto border-t border-gray-200/40 px-1.5 py-1.5 dark:border-gray-800/40">
          <div
            v-for="dir in extraDirs"
            :key="dir"
            class="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          >
            <div class="min-w-0 flex-1 truncate text-xs text-gray-800 dark:text-gray-200" :title="dir">
              {{ dir }}
            </div>
            <button
              type="button"
              class="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-gray-400 transition hover:bg-red-500/10 hover:text-red-500 dark:text-white/40"
              title="移除该扫描目录"
              @click="handleRemoveExtraDir(dir)"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 可用插件 -->
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        可用插件
        <span
          v-if="hasScanned && scannedPlugins.length > 0"
          class="text-xs font-normal text-gray-400 dark:text-white/35"
        >{{ scannedPlugins.length }} 个</span>
      </h2>
      <div class="flex flex-col overflow-hidden rounded-xl border border-gray-200/40 bg-white/20 dark:border-gray-800/40 dark:bg-black/10">
        <div class="flex items-center justify-between gap-3 px-4 py-3">
          <div class="text-xs leading-relaxed text-gray-500 dark:text-white/45">
            扫描标准目录：用户级与系统级 VST3 / CLAP 文件夹。
          </div>
          <button
            type="button"
            class="flex shrink-0 items-center gap-1.5 rounded-lg border border-black/10 bg-white/45 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-white/70 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10"
            :disabled="isScanning"
            @click="handleScan"
          >
            <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': isScanning }" />
            {{ isScanning ? '扫描中...' : '重新扫描' }}
          </button>
        </div>

        <div v-if="!hasScanned && !isScanning" class="px-4 pb-5 pt-2 text-center text-xs text-gray-400 dark:text-white/35">
          正在扫描标准插件目录...
        </div>
        <div v-else-if="isScanning" class="px-4 pb-5 pt-2 text-center text-xs text-gray-400 dark:text-white/35">
          正在扫描标准插件目录...
        </div>
        <div v-else-if="scannedSorted.length === 0" class="px-4 pb-5 pt-2 text-center text-xs leading-relaxed text-gray-400 dark:text-white/35">
          未发现 VST3 / CLAP 插件。<br>
          将插件安装到 %LOCALAPPDATA%\Programs\Common\VST3 或 Common\CLAP 后重新扫描。
        </div>
        <div v-else class="custom-scrollbar max-h-72 space-y-px overflow-y-auto px-1.5 pb-1.5">
          <div
            v-for="(entry, index) in scannedSorted"
            :key="`${entry.format}-${entry.uniqueId}`"
            class="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          >
            <span
              class="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
              :class="entry.format === 'vst3'
                ? 'bg-sky-500/10 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300'
                : 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300'"
            >{{ formatLabel(entry.format) }}</span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-xs font-medium text-gray-800 dark:text-gray-200" :title="entry.path">
                {{ entry.name }}
              </div>
              <div class="truncate text-[11px] text-gray-400 dark:text-white/35">
                {{ [entry.vendor, categoryLabel(entry.category), versionLabel(entry.version)].filter(Boolean).join(' · ') }}
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
              {{ store.isSlotInRack(entry.format, entry.uniqueId) ? '已在机架' : '添加' }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 机架链路 -->
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        机架链路
        <span
          v-if="rackConfig.slots.length > 0"
          class="text-xs font-normal text-gray-400 dark:text-white/35"
        >{{ rackConfig.slots.length }} 个槽位</span>
      </h2>
      <div class="flex flex-col overflow-hidden rounded-xl border border-gray-200/40 bg-white/20 dark:border-gray-800/40 dark:bg-black/10">
        <div
          v-if="rackConfig.slots.length === 0"
          class="px-4 py-8 text-center text-xs leading-relaxed text-gray-400 dark:text-white/35"
        >
          机架为空。从「可用插件」添加效果插件后，它们将按此顺序串联处理音频。
        </div>

        <template v-for="(slot, index) in rackConfig.slots" :key="slotKey(slot)">
          <div class="border-t border-gray-200/40 first:border-t-0 dark:border-gray-800/40">
            <div class="flex items-center gap-2 px-4 py-3 transition-colors hover:bg-white/40 dark:hover:bg-white/10">
              <span class="w-5 shrink-0 text-center text-[11px] font-semibold text-gray-300 dark:text-white/25">
                {{ index + 1 }}
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span
                    class="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
                    :class="slot.format === 'vst3'
                      ? 'bg-sky-500/10 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300'
                      : 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300'"
                  >{{ formatLabel(slot.format) }}</span>
                  <span class="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{{ slot.name }}</span>
                </div>
                <div class="mt-0.5 truncate text-[11px] text-gray-400 dark:text-white/35">
                  {{ slot.vendor || '未知厂商' }}<span v-if="!slot.enabled"> · 已停用</span>
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  class="grid h-7 w-7 place-items-center rounded-lg text-gray-400 transition hover:bg-black/5 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/80"
                  :disabled="index === 0"
                  :title="'上移'"
                  @click="store.moveSlot(slot.format, slot.uniqueId, -1)"
                >
                  <ChevronUp class="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  class="grid h-7 w-7 place-items-center rounded-lg text-gray-400 transition hover:bg-black/5 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/80"
                  :disabled="index === rackConfig.slots.length - 1"
                  :title="'下移'"
                  @click="store.moveSlot(slot.format, slot.uniqueId, 1)"
                >
                  <ChevronDown class="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  class="grid h-7 w-7 place-items-center rounded-lg text-gray-400 transition hover:bg-black/5 hover:text-gray-700 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/80"
                  :class="{ 'text-[#EC4141] dark:text-[#ff8b8b]': panelOf(slot).expanded }"
                  :title="'参数与预设'"
                  @click="togglePanel(slot)"
                >
                  <SlidersHorizontal class="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  class="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition"
                  :class="store.isEditorOpen(slot.format, slot.uniqueId)
                    ? 'bg-[#EC4141]/10 text-[#EC4141] hover:bg-[#EC4141]/20 dark:text-[#ff8b8b]'
                    : 'text-gray-400 hover:bg-black/5 hover:text-gray-700 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/80'"
                  :title="store.isEditorOpen(slot.format, slot.uniqueId) ? '关闭编辑器窗口' : '打开插件原生编辑器'"
                  @click="handleEditorToggle(slot)"
                >
                  <SquareArrowOutUpRight class="h-3.5 w-3.5" />
                  {{ store.isEditorOpen(slot.format, slot.uniqueId) ? '关闭' : '编辑器' }}
                </button>
                <button
                  type="button"
                  class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none"
                  :class="slot.enabled ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
                  :title="slot.enabled ? '停用该插件' : '启用该插件'"
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
                  title="从机架移除"
                  @click="requestRemoveSlot(slot)"
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <!-- 参数与预设面板 -->
            <div v-if="panelOf(slot).expanded" class="border-t border-gray-200/40 bg-black/[0.03] px-4 py-3 dark:border-gray-800/40 dark:bg-black/20">
              <div v-if="panelOf(slot).loading" class="py-4 text-center text-xs text-gray-400 dark:text-white/35">
                正在读取插件参数...
              </div>
              <div v-else-if="panelOf(slot).error" class="py-4 text-center text-xs text-red-500">
                {{ panelOf(slot).error }}
              </div>
              <template v-else>
                <!-- 工厂预设 -->
                <div v-if="panelOf(slot).presets.length > 0" class="mb-3 flex items-center gap-2">
                  <span class="shrink-0 text-[11px] font-medium text-gray-500 dark:text-white/45">工厂预设</span>
                  <select
                    :value="panelOf(slot).presetNumber"
                    class="h-7 max-w-52 rounded-lg border border-black/10 bg-white/45 px-2 text-xs text-gray-800 outline-none transition focus:border-[#EC4141]/50 dark:border-white/10 dark:bg-white/10 dark:text-gray-100"
                    @change="handlePresetChange(slot, panelOf(slot), Number(($event.target as HTMLSelectElement).value))"
                  >
                    <option
                      v-for="preset in panelOf(slot).presets"
                      :key="preset.index"
                      :value="preset.presetNumber"
                    >{{ preset.name }}</option>
                  </select>
                </div>

                <!-- 参数列表 -->
                <div
                  v-if="visibleParams(panelOf(slot)).length > 0"
                  class="custom-scrollbar max-h-64 space-y-2.5 overflow-y-auto pr-1"
                >
                  <div
                    v-for="param in visibleParams(panelOf(slot))"
                    :key="param.index"
                    class="flex items-center gap-3"
                  >
                    <div class="w-32 shrink-0 truncate text-[11px] font-medium text-gray-600 dark:text-white/55" :title="param.name">
                      {{ param.name }}
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      :step="paramStep(param)"
                      :value="paramValue(panelOf(slot), param)"
                      :disabled="param.readOnly || !slot.enabled"
                      class="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-black/10 accent-[#EC4141] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/10"
                      @input="handleParamInput(slot, panelOf(slot), param, $event)"
                    />
                    <div class="w-20 shrink-0 truncate text-right text-[11px] tabular-nums text-gray-500 dark:text-white/45" :title="paramText(panelOf(slot), param)">
                      {{ paramText(panelOf(slot), param) }}
                    </div>
                  </div>
                </div>
                <div v-else class="py-3 text-center text-xs text-gray-400 dark:text-white/35">
                  该插件没有可调节的参数。
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>
    </section>

    <ConfirmModal
      :visible="showRemoveConfirm"
      title="移除插件"
      :content="slotToRemove ? `确定要从机架中移除「${slotToRemove.name}」吗？其参数设置会被一并清除。` : ''"
      @confirm="confirmRemoveSlot"
      @cancel="showRemoveConfirm = false"
    />
  </div>
</template>
