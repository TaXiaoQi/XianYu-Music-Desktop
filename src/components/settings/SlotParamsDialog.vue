<script setup lang="ts">
import { nextTick, onMounted, reactive, ref, watch } from 'vue';
import { X } from 'lucide-vue-next';
import { usePluginHostStore } from '../../features/pluginHost/store';
import { useI18n } from '../../features/i18n';
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

const props = defineProps<{ visible: boolean; entry: PluginHostRackSlotConfig | null }>();
const emit = defineEmits<{ close: [] }>();

const store = usePluginHostStore();
const { t } = useI18n();
const { showToast } = useToast();

const open = ref(false);

const openAnimated = () => {
  nextTick(() => { open.value = true; });
};

watch(() => props.visible, (visible) => {
  if (visible) {
    openAnimated();
    void load();
  } else {
    open.value = false;
  }
});

onMounted(() => {
  if (props.visible) {
    openAnimated();
    void load();
  }
});

const requestClose = () => emit('close');

const formatLabel = (format: string) => (format === 'vst3' ? 'VST3' : 'CLAP');

const loading = ref(false);
const error = ref<string | null>(null);
const loaded = ref(false);
const params = ref<PluginHostParameterEntry[]>([]);
const values = reactive<Record<number, PluginHostParameterValueEntry>>({});
const presets = ref<PluginHostPresetEntry[]>([]);
const presetNumber = ref<number | null>(null);

const load = async () => {
  if (!props.entry) return;
  const entry = props.entry;
  loading.value = true;
  error.value = null;
  try {
    const [paramList, valueList, presetList] = await Promise.all([
      getPluginParameters(entry.format, entry.uniqueId, entry.path),
      getParameterValues(entry.format, entry.uniqueId, entry.path),
      getPluginPresets(entry.format, entry.uniqueId, entry.path).catch(() => []),
    ]);
    params.value = paramList;
    presets.value = presetList;
    if (presetList.length > 0 && presetNumber.value === null) {
      presetNumber.value = presetList[0].presetNumber;
    }
    for (const entry of valueList) values[entry.index] = entry;
    loaded.value = true;
  } catch (err) {
    error.value = t('pluginHost.paramsReadFailed', { err: String(err) });
  } finally {
    loading.value = false;
  }
};

const visibleParams = () => params.value.filter(p => !p.hidden);

const paramValue = (param: PluginHostParameterEntry) =>
  values[param.index]?.value ?? (param.default - param.min) / (param.max - param.min || 1);

const paramText = (param: PluginHostParameterEntry) => {
  const polled = values[param.index]?.text;
  if (polled) return polled;
  const native = param.min + paramValue(param) * (param.max - param.min);
  return `${native.toFixed(2)}${param.unit}`;
};

const paramStep = (param: PluginHostParameterEntry) =>
  param.stepCount > 0 ? 1 / param.stepCount : 0.001;

const handleParamInput = (param: PluginHostParameterEntry, event: Event) => {
  const value = Number.parseFloat((event.target as HTMLInputElement).value);
  if (!Number.isFinite(value)) return;
  const existing = values[param.index];
  values[param.index] = {
    index: param.index,
    id: param.id,
    value,
    text: existing?.text ?? '',
  };
  if (!props.entry) return;
  void store.setSlotParameter(props.entry.format, props.entry.uniqueId, param.index, value);
};

const handlePresetChange = async (next: number) => {
  if (!props.entry) return;
  const entry = props.entry;
  try {
    await loadPreset(entry.format, entry.uniqueId, entry.path, next);
    const valueList = await getParameterValues(entry.format, entry.uniqueId, entry.path);
    for (const valueEntry of valueList) values[valueEntry.index] = valueEntry;
    presetNumber.value = next;
    store.applySlotParams(
      entry.format,
      entry.uniqueId,
      Object.fromEntries(valueList.map(v => [v.index, v.value])),
    );
  } catch (err) {
    showToast(t('pluginHost.presetLoadFailed', { err: String(err) }), 'error');
  }
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
          class="modal-content flex max-h-[calc(100vh-4rem)] w-full max-w-[520px] flex-col overflow-hidden"
        >
          <!-- 顶栏 -->
          <div class="flex shrink-0 items-center justify-between border-b border-gray-200/70 px-5 py-4 dark:border-white/10">
            <div class="flex min-w-0 items-center gap-2">
              <span
                class="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
                :class="entry?.format === 'vst3'
                  ? 'bg-sky-500/10 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300'
                  : 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300'"
              >{{ entry ? formatLabel(entry.format) : '' }}</span>
              <h2 class="truncate text-sm font-bold text-gray-800 dark:text-gray-100">{{ entry?.name }}</h2>
            </div>
            <button
              type="button"
              class="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-gray-400 transition hover:bg-black/5 hover:text-gray-700 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/80"
              :title="t('topbar.close')"
              @click="requestClose"
            >
              <X class="h-4 w-4" />
            </button>
          </div>

        <!-- 主体 -->
        <div class="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div v-if="loading" class="py-10 text-center text-xs text-gray-400 dark:text-white/35">
            {{ t('pluginHost.loadingParams') }}
          </div>
          <div v-else-if="error" class="py-10 text-center text-xs text-red-500">
            {{ error }}
          </div>
          <template v-else-if="entry">
            <!-- 工厂预设 -->
            <div v-if="presets.length > 0" class="mb-4 flex items-center gap-2">
              <span class="shrink-0 text-[11px] font-medium text-gray-500 dark:text-white/45">{{ t('pluginHost.factoryPresets') }}</span>
              <select
                :value="presetNumber ?? undefined"
                class="h-7 min-w-0 flex-1 rounded-lg border border-black/10 bg-white/45 px-2 text-xs text-gray-800 outline-none transition focus:border-[#EC4141]/50 dark:border-white/10 dark:bg-white/10 dark:text-gray-100"
                @change="handlePresetChange(Number(($event.target as HTMLSelectElement).value))"
              >
                <option
                  v-for="preset in presets"
                  :key="preset.index"
                  :value="preset.presetNumber"
                >{{ preset.name }}</option>
              </select>
            </div>

            <!-- 参数列表 -->
            <div v-if="visibleParams().length > 0" class="space-y-3">
              <div
                v-for="param in visibleParams()"
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
                  :value="paramValue(param)"
                  :disabled="param.readOnly || !entry.enabled"
                  class="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-black/10 accent-[#EC4141] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/10"
                  @input="handleParamInput(param, $event)"
                />
                <div class="w-20 shrink-0 truncate text-right text-[11px] tabular-nums text-gray-500 dark:text-white/45" :title="paramText(param)">
                  {{ paramText(param) }}
                </div>
              </div>
              <p v-if="!entry.enabled" class="pt-1 text-[11px] text-gray-400 dark:text-white/35">
                {{ t('pluginHost.disableSlot') }} · {{ t('pluginHost.disabledSuffix') }}
              </p>
            </div>
            <div v-else class="py-6 text-center text-xs text-gray-400 dark:text-white/35">
              {{ t('pluginHost.noParams') }}
            </div>
          </template>
        </div>
      </div>
    </div>
    </Transition>
  </Teleport>
</template>