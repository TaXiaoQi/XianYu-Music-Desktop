<script setup lang="ts">
defineProps<{
  /** 队列内曲目总数 */
  total: number;
  /** 为 true 表示表面已不透明，无需再叠加毛玻璃 */
  frosted: boolean;
}>();

defineEmits<{ (e: 'clear-requested'): void }>();
</script>

<template>
  <div
    class="z-10 flex items-center justify-between border-b border-[#d9e0ea] bg-[#f8fafc]/95 px-5 py-4 shadow-sm dark:border-white/10 dark:bg-[#262626]/95"
    :class="frosted ? 'backdrop-blur-sm' : ''"
  >
    <div class="flex items-center gap-3">
      <h3 class="text-lg font-bold tracking-tight text-[#172033] dark:text-white">播放队列</h3>
      <span class="rounded-full bg-[#e7edf5] px-2 py-0.5 text-xs font-semibold text-[#34445c] dark:bg-white/12 dark:text-white">{{ total }}</span>
    </div>

    <button
      class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-[#34445c] transition-all hover:bg-[#EC4141]/10 hover:text-[#EC4141] active:scale-95 dark:text-white/90 dark:hover:bg-red-500/15"
      title="清空队列"
      @click="$emit('clear-requested')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
        />
      </svg>
      <span>清空</span>
    </button>
  </div>
</template>
