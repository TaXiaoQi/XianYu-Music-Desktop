<script setup lang="ts">
interface DisplayRow {
  originalName: string;
  newName: string;
  changed: boolean;
}

defineProps<{
  rows: DisplayRow[];
  changedTotal: number;
  scanning: boolean;
  pendingFirstScan: boolean;
}>();

const ARROW_TRAIL = 'M5 12h14m-5-5 5 5-5 5';
</script>

<template>
  <section class="toolbox-section space-y-3">
    <div class="flex items-center justify-between gap-3">
      <h2 class="toolbox-section-title">
        <span class="toolbox-section-bar"></span>
        实时预览
      </h2>
      <div class="text-sm font-medium text-gray-600 dark:text-white/55">
        已扫描 {{ rows.length }} 首歌曲，发生变化 {{ changedTotal }} 首。
      </div>
    </div>

    <div class="toolbox-list overflow-hidden">
      <div class="toolbox-list-header grid grid-cols-[42px_minmax(0,1fr)_72px_minmax(0,1fr)] items-center gap-3">
        <span>标记</span>
        <span>原先的歌曲</span>
        <span></span>
        <span>修改后的歌曲</span>
      </div>

      <div
        v-if="scanning || pendingFirstScan"
        class="flex min-h-[360px] items-center justify-center px-6 py-8 text-sm text-gray-500 dark:text-white/45"
      >
        正在自动扫描当前文件夹...
      </div>

      <div
        v-else-if="rows.length === 0"
        class="flex min-h-[360px] items-center justify-center px-6 py-8 text-sm text-gray-500 dark:text-white/45"
      >
        当前文件夹中没有可显示的歌曲。
      </div>

      <div v-else class="max-h-[520px] space-y-2 overflow-y-auto p-3">
        <div
          v-for="row in rows"
          :key="`${row.originalName}-${row.newName}`"
          class="toolbox-item grid grid-cols-[42px_minmax(0,1fr)_72px_minmax(0,1fr)] items-center gap-3 px-3 py-3 text-sm"
        >
          <div class="flex items-center justify-center">
            <span
              class="text-lg leading-none"
              :class="row.changed ? 'text-amber-400' : 'text-gray-400 dark:text-white/30'"
            >
              ★
            </span>
          </div>
          <div class="truncate font-medium text-gray-600 dark:text-white/65">{{ row.originalName }}</div>
          <div class="flex items-center justify-center text-sky-500 dark:text-sky-300">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" :d="ARROW_TRAIL" />
            </svg>
          </div>
          <div class="truncate font-semibold text-gray-900 dark:text-white">{{ row.newName }}</div>
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
</style>
