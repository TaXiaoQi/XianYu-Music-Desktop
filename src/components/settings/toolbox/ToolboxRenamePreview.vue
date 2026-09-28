<script setup lang="ts">
interface RenameEntry {
  originalName: string;
  newName: string;
}

defineProps<{
  report: {
    items: RenameEntry[];
    isScanning: boolean;
  };
}>();
</script>

<template>
  <section class="toolbox-section space-y-3">
    <div class="flex items-center justify-between gap-3">
      <h2 class="toolbox-section-title">
        <span class="toolbox-section-bar"></span>
        实时预览
      </h2>
      <div class="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
        {{ report.items.length }} 项
      </div>
    </div>

    <div
      v-if="report.isScanning"
      class="toolbox-panel toolbox-panel--muted text-sm text-gray-500 dark:text-white/45"
    >
      正在生成重命名预览，请稍候...
    </div>

    <div
      v-else-if="report.items.length === 0"
      class="toolbox-panel toolbox-panel--muted text-sm text-gray-500 dark:text-white/45"
    >
      暂无可显示的重命名结果。
    </div>

    <div v-else class="toolbox-list">
      <div class="toolbox-list-header">重命名预览</div>
      <div class="max-h-[420px] overflow-y-auto">
        <div
          v-for="entry in report.items"
          :key="`${entry.originalName}-${entry.newName}`"
          class="toolbox-list-row grid grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] items-center gap-2"
        >
          <div class="truncate text-sm text-gray-600 dark:text-white/60">{{ entry.originalName }}</div>
          <div class="text-center text-gray-300 dark:text-white/30">→</div>
          <div class="truncate text-sm font-medium text-gray-900 dark:text-white">{{ entry.newName }}</div>
        </div>
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

.toolbox-list {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
  overflow: hidden;
}

.toolbox-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary, #1f2937);
  border-bottom: 1px solid rgba(229, 231, 235, 0.3);
}

:root.dark .toolbox-list-header {
  color: var(--text-primary, #ffffff);
}

.toolbox-list-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(229, 231, 235, 0.2);
  transition: background 160ms ease;
}

.toolbox-list-row:last-child {
  border-bottom: none;
}

.toolbox-list-row:hover {
  background: rgba(243, 244, 246, 0.5);
}
</style>
