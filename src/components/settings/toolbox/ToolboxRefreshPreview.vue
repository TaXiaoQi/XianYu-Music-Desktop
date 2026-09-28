<script setup lang="ts">
import { computed } from 'vue';
import SettingHint from '../SettingHint.vue';

interface RefreshReport {
  targetPath: string;
  isRefreshing: boolean;
  refreshed: boolean;
}

const props = defineProps<{
  report: RefreshReport;
  fallbackPath: string;
}>();

const statusLabel = computed(() => (props.report.refreshed ? '已完成' : '待刷新'));

const statusTone = computed(() =>
  props.report.refreshed
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
    : 'toolbox-chip',
);

const headline = computed(() => {
  if (props.report.isRefreshing) {
    return '正在刷新音乐库...';
  }
  return props.report.refreshed ? '音乐库已经更新' : '等待执行最后一步';
});

const detail = computed(() =>
  props.report.refreshed
    ? '当前流程已经完成，你可以直接开始处理下一批文件。'
    : '点击左侧刷新按钮后，这里会显示最终完成状态。',
);

const panelTone = computed(() => {
  if (props.report.isRefreshing) {
    return 'toolbox-panel--muted text-gray-600 dark:text-white/65';
  }
  return props.report.refreshed
    ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
    : 'border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300';
});
</script>

<template>
  <section class="toolbox-section space-y-3">
    <div class="flex items-center justify-between gap-3">
      <h2 class="toolbox-section-title">
        <span class="toolbox-section-bar"></span>
        实时预览
      </h2>
      <div class="flex items-center gap-3">
        <SettingHint text="这里显示刷新进度和最终完成状态。" />
        <div
          class="rounded-full px-3 py-1 text-xs font-medium"
          :class="statusTone"
        >
          {{ statusLabel }}
        </div>
      </div>
    </div>

    <div class="space-y-3">
      <div class="toolbox-item p-4">
        <div class="text-xs uppercase tracking-[0.18em] text-gray-400 dark:text-white/35">Folder</div>
        <div class="mt-2 break-all text-sm font-medium text-gray-900 dark:text-white">{{ report.targetPath || fallbackPath }}</div>
      </div>

      <div
        class="toolbox-panel p-5 text-sm"
        :class="panelTone"
      >
        <div class="font-semibold">
          {{ headline }}
        </div>
        <p class="mt-2 leading-7">
          {{ detail }}
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.toolbox-section {
  padding: 16px 20px;
}

.toolbox-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--text-primary, #1f2937);
}

:root.dark .toolbox-section-title {
  color: var(--text-primary, #e5e7eb);
}

.toolbox-section-bar {
  display: inline-block;
  width: 4px;
  height: 16px;
  border-radius: 9999px;
  background: #ec4141;
}

.toolbox-item {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 10px;
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.2);
  transition: background 0.2s, border-color 0.2s;
}

.toolbox-item:hover {
  border-color: rgba(229, 231, 235, 0.5);
  background: rgba(229, 231, 235, 0.4);
}

.toolbox-panel {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
}

.toolbox-panel--muted {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 12px;
  padding: 20px 24px;
  background: rgba(255, 255, 255, 0.2);
}
</style>
