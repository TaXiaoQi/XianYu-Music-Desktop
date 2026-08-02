<script setup lang="ts">
import { computed, ref } from 'vue';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { Download, FileWarning } from 'lucide-vue-next';

import { useToast } from '../../composables/toast';
import {
  analyzeApplicationLogs,
  formatApplicationLogExport,
  useApplicationLogs,
} from '../../services/applicationLogger';
import { debugApi } from '../../services/tauri/debugApi';

const { showToast } = useToast();
const { entries } = useApplicationLogs();
const exportingMode = ref<'all' | 'error' | null>(null);
const errorCount = computed(() => analyzeApplicationLogs(entries.value).counts.error);

const createExportName = (mode: 'all' | 'error') => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `lycia-${mode === 'error' ? 'error' : 'all'}-logs-${timestamp}.log`;
};

const exportLogs = async (mode: 'all' | 'error') => {
  const selectedCount = mode === 'error' ? errorCount.value : entries.value.length;
  if (selectedCount === 0) {
    showToast(mode === 'error' ? '当前没有错误日志可导出' : '当前没有日志可导出', 'info');
    return;
  }

  exportingMode.value = mode;
  try {
    const filePath = await saveDialog({
      defaultPath: createExportName(mode),
      filters: [{ name: '日志文件', extensions: ['log', 'txt'] }],
    });
    if (!filePath) return;

    const analysis = analyzeApplicationLogs(entries.value);
    const content = formatApplicationLogExport(entries.value, mode, analysis);
    await debugApi.writeLogExport(filePath, content);
    showToast(mode === 'error' ? '错误日志已导出' : '全部日志已导出', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showToast(`日志导出失败：${message}`, 'error');
  } finally {
    exportingMode.value = null;
  }
};
</script>

<template>
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <button
      type="button"
      :disabled="exportingMode !== null || entries.length === 0"
      class="inline-flex items-center justify-center gap-2 rounded-xl border border-black/10 bg-white/40 px-4 py-3 text-sm text-gray-700 transition hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-200 dark:hover:bg-white/[0.06]"
      @click="exportLogs('all')"
    >
      <Download class="h-4 w-4" />
      {{ exportingMode === 'all' ? '导出中…' : `导出全部日志（${entries.length}）` }}
    </button>
    <button
      type="button"
      :disabled="exportingMode !== null || errorCount === 0"
      class="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/[0.03] px-4 py-3 text-sm text-rose-600 transition hover:bg-rose-500/[0.07] disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-300"
      @click="exportLogs('error')"
    >
      <FileWarning class="h-4 w-4" />
      {{ exportingMode === 'error' ? '导出中…' : `导出错误日志（${errorCount}）` }}
    </button>
  </div>
</template>
