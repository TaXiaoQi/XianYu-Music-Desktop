<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { Check, Plus, RefreshCw, X } from 'lucide-vue-next';
import { usePluginHostStore } from '../../features/pluginHost/store';
import { useI18n } from '../../features/i18n';

const emit = defineEmits<{ close: [] }>();

const store = usePluginHostStore();
const { scannedPlugins, isScanning, hasScanned } = storeToRefs(store);
const { t } = useI18n();

const scannedSorted = computed(() => [...scannedPlugins.value]);

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

const handleScan = () => {
  void store.scan();
};
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        class="flex max-h-[calc(100vh-4rem)] w-full max-w-[480px] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-[#262626]"
      >
        <!-- 顶栏 -->
        <div class="flex shrink-0 items-center justify-between gap-3 border-b border-black/10 px-5 py-4 dark:border-white/10">
          <div class="flex min-w-0 items-center gap-2">
            <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
            <h2 class="truncate text-sm font-bold text-gray-800 dark:text-gray-100">{{ t('pluginHost.availablePlugins') }}</h2>
            <span
              v-if="hasScanned && scannedPlugins.length > 0"
              class="shrink-0 text-xs font-normal text-gray-400 dark:text-white/35"
            >{{ t('pluginHost.count', { count: scannedPlugins.length }) }}</span>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              class="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#EC4141]/25 bg-[#EC4141]/10 px-3 py-1.5 text-xs font-medium text-[#EC4141] transition hover:bg-[#EC4141]/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#ff8b8b]"
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
              @click="emit('close')"
            >
              <X class="h-4 w-4" />
            </button>
          </div>
        </div>

        <!-- 插件列表 -->
        <div class="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
          <div v-if="!hasScanned && !isScanning" class="px-4 py-10 text-center text-xs text-gray-400 dark:text-white/35">
            {{ t('pluginHost.scanningDirs') }}
          </div>
          <div v-else-if="isScanning" class="px-4 py-10 text-center text-xs text-gray-400 dark:text-white/35">
            {{ t('pluginHost.scanningDirs') }}
          </div>
          <div v-else-if="scannedSorted.length === 0" class="px-4 py-10 text-center text-xs leading-relaxed text-gray-400 dark:text-white/35">
            {{ t('pluginHost.noPluginsFoundA') }}<br>
            {{ t('pluginHost.noPluginsFoundB') }}
          </div>
          <div v-else class="space-y-px">
            <div
              v-for="(entry, index) in scannedSorted"
              :key="`${entry.format}-${entry.uniqueId}`"
              class="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
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
                {{ store.isSlotInRack(entry.format, entry.uniqueId) ? t('pluginHost.alreadyInRack') : t('pluginHost.add') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>