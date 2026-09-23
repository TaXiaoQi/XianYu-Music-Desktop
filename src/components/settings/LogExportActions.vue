<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { Upload } from 'lucide-vue-next';

import { useToast } from '../../composables/toast';
import {
  analyzeApplicationLogs,
  formatApplicationLogExport,
  useApplicationLogs,
} from '../../services/applicationLogger';
import { debugApi } from '../../services/tauri/debugApi';

const { showToast } = useToast();
const { entries } = useApplicationLogs();
const exporting = ref(false);

const entryCount = ref(entries.value.length);
let countTimer: ReturnType<typeof setTimeout> | null = null;

const refreshCounts = () => {
  entryCount.value = entries.value.length;
};

refreshCounts();

watch(
  () => entries.value.length,
  () => {
    if (countTimer) clearTimeout(countTimer);
    countTimer = setTimeout(refreshCounts, 500);
  },
  { flush: 'post' },
);

onBeforeUnmount(() => {
  if (countTimer) clearTimeout(countTimer);
});

const exportLogs = async () => {
  if (entryCount.value === 0) {
    showToast('当前没有日志可导出', 'info');
    return;
  }
  exporting.value = true;
  try {
    const analysis = analyzeApplicationLogs(entries.value);
    const content = formatApplicationLogExport(entries.value, 'all', analysis);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const savedPath = await debugApi.writeLogExport(`xianyu-all-logs-${timestamp}.log`, content);
    if (savedPath === null) return;
    showToast('日志已导出', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showToast(`日志导出失败：${message}`, 'error');
  } finally {
    exporting.value = false;
  }
};
</script>

<template>
  <button
    type="button"
    :disabled="exporting || entryCount === 0"
    class="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200/40 bg-white/20 px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-200 dark:hover:bg-white/[0.06]"
    @click="exportLogs"
  >
    <Upload class="h-4 w-4" />
    {{ exporting ? '导出中…' : `导出日志（${entryCount}）` }}
  </button>
</template>
