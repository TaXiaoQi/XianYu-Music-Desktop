<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { FileWarning, Upload } from 'lucide-vue-next';

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

// 使用防抖的 errorCount，避免每次 entries 变化都同步执行 analyzeApplicationLogs 导致渲染→日志→分析→渲染反馈循环卡死
const errorCount = ref(0);
let errorCountTimer: ReturnType<typeof setTimeout> | null = null;

const refreshErrorCount = () => {
  let count = 0;
  for (const entry of entries.value) {
    if (entry.level === 'error') count++;
  }
  errorCount.value = count;
};

// 初始同步快速计数（仅遍历一次，不调用 analyzeApplicationLogs）
refreshErrorCount();

watch(
  () => entries.value.length,
  () => {
    if (errorCountTimer) clearTimeout(errorCountTimer);
    errorCountTimer = setTimeout(refreshErrorCount, 500);
  },
  { flush: 'post' },
);

onBeforeUnmount(() => {
  if (errorCountTimer) clearTimeout(errorCountTimer);
});

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
      class="inline-flex items-center justify-center gap-2 rounded-xl border border-black/10 bg-white/40 px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-200 dark:hover:bg-white/[0.06]"
      @click="exportLogs('all')"
    >
      <Upload class="h-4 w-4" />
      {{ exportingMode === 'all' ? '导出中…' : `导出全部日志（${entries.length}）` }}
    </button>
    <button
      type="button"
      :disabled="exportingMode !== null || errorCount === 0"
      class="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/[0.03] px-4 py-3 text-sm font-medium text-rose-600 transition hover:bg-rose-500/[0.07] disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-300"
      @click="exportLogs('error')"
    >
      <FileWarning class="h-4 w-4" />
      {{ exportingMode === 'error' ? '导出中…' : `导出错误日志（${errorCount}）` }}
    </button>
  </div>
</template>
