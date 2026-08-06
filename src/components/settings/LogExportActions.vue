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

// 使用本地 ref 存储计数，模板不直接依赖 entries 响应式源。
// 当全局 logger flush 修改 logEntries 时，不会立即触发模板重渲染，
// 避免在 leave transition 期间干扰 transition 状态机。
const entryCount = ref(entries.value.length);
const errorCount = ref(0);
let countTimer: ReturnType<typeof setTimeout> | null = null;

const refreshCounts = () => {
  let count = 0;
  for (const entry of entries.value) {
    if (entry.level === 'error') count++;
  }
  errorCount.value = count;
  entryCount.value = entries.value.length;
};

// 初始同步快速计数（仅遍历一次，不调用 analyzeApplicationLogs）
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

const createExportName = (mode: 'all' | 'error') => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `xianyu-${mode === 'error' ? 'error' : 'all'}-logs-${timestamp}.log`;
};

const exportLogs = async (mode: 'all' | 'error') => {
  const selectedCount = mode === 'error' ? errorCount.value : entryCount.value;
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
      :disabled="exportingMode !== null || entryCount === 0"
      class="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200/40 bg-white/20 px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-200 dark:hover:bg-white/[0.06]"
      @click="exportLogs('all')"
    >
      <Upload class="h-4 w-4" />
      {{ exportingMode === 'all' ? '导出中…' : `导出全部日志（${entryCount}）` }}
    </button>
    <button
      type="button"
      :disabled="exportingMode !== null || errorCount === 0"
      class="inline-flex items-center justify-center gap-2 rounded-xl border border-[#EC4141]/50 bg-[#EC4141] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#d13b3b] disabled:cursor-not-allowed disabled:opacity-40"
      @click="exportLogs('error')"
    >
      <FileWarning class="h-4 w-4" />
      {{ exportingMode === 'error' ? '导出中…' : `导出错误日志（${errorCount}）` }}
    </button>
  </div>
</template>
