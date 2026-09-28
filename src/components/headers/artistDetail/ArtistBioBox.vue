<script setup lang="ts">
defineProps<{
  text: string;
  opacity: number;
  maxHeight: string;
}>();
</script>

<template>
  <div class="mb-5 px-1 -mt-1 overflow-hidden" :style="{ opacity, maxHeight }">
    <div class="text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-xl px-4 py-3 max-w-3xl whitespace-pre-line break-words">
      {{ text }}
    </div>
  </div>
</template>
