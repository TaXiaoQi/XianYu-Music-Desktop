<script setup lang="ts">
import type { LibraryScanProgress } from '../../../types';

// 音乐库扫描进度角标：展示阶段文案、当前目录与进度条（含不定长动画）。
defineProps<{
  snapshot: LibraryScanProgress | null;
  phaseLabel: string;
  folderLabel: string;
  percent: number;
}>();
</script>

<template>
  <div
    v-if="snapshot"
    class="hidden absolute right-4 top-14 z-[145] w-[320px] overflow-hidden rounded-[22px] border border-white/45 bg-white/82 p-4 shadow-[0_24px_60px_rgba(15,23,42,0.18)] backdrop-blur-2xl dark:border-white/10 dark:bg-black/70"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#ec4141]/80">
          {{ phaseLabel }}
        </div>
        <div class="mt-1 text-sm font-medium text-gray-900 dark:text-white">
          {{ snapshot.message || '正在处理音乐库' }}
        </div>
        <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500 dark:text-white/55">
          <span v-if="folderLabel">{{ folderLabel }}</span>
          <span v-if="snapshot.total > 0">
            {{ snapshot.current }}/{{ snapshot.total }}
          </span>
          <span class="truncate max-w-[220px]" :title="snapshot.folder_path">
            {{ snapshot.folder_path }}
          </span>
        </div>
      </div>
      <div
        class="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
        :class="snapshot.failed ? 'bg-rose-500' : snapshot.done ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'"
      ></div>
    </div>

    <div class="mt-3 h-2 overflow-hidden rounded-full bg-black/8 dark:bg-white/10">
      <div
        class="h-full rounded-full bg-gradient-to-r from-[#ec4141] via-[#ff8364] to-[#f7b267] transition-[width] duration-300 ease-out"
        :class="{ 'scan-progress-bar-indeterminate': snapshot.total <= 0 && !snapshot.done }"
        :style="{ width: `${percent}%` }"
      ></div>
    </div>
  </div>
</template>

<style scoped>
.scan-progress-enter-active,
.scan-progress-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.scan-progress-enter-from,
.scan-progress-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.98);
}

.scan-progress-bar-indeterminate {
  min-width: 28%;
  animation: scan-progress-indeterminate 1.1s ease-in-out infinite alternate;
}

@keyframes scan-progress-indeterminate {
  from {
    transform: translateX(-14%);
  }

  to {
    transform: translateX(14%);
  }
}
</style>
