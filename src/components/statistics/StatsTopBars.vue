<script setup lang="ts">
/**
 * Top 榜横条列表：条长表达占比，数值显示播放次数。
 * 归一化由 statsCharts.normalizeBars 负责。
 */
import { computed } from 'vue';

import { normalizeBars } from './statsCharts';

const props = withDefaults(defineProps<{
  items: { label: string; sublabel?: string; value: number }[];
  accent?: string;
  emptyHint?: string;
}>(), {
  accent: '#EC4141',
  emptyHint: '',
});

const ratios = computed(() => normalizeBars(props.items.map(item => item.value)));

function barWidth(index: number): string {
  // 有值时至少给 4% 宽度，否则最小值几乎看不见
  return `${Math.max(ratios.value[index] * 100, 4)}%`;
}
</script>

<template>
  <div v-if="!items.length" class="py-6 text-center text-xs text-gray-400 dark:text-gray-500">
    {{ emptyHint }}
  </div>
  <ul v-else class="space-y-2.5">
    <li v-for="(item, index) in items" :key="`${item.label}-${index}`" class="min-w-0">
      <div class="flex items-baseline justify-between gap-2">
        <span class="truncate text-xs font-medium text-gray-800 dark:text-gray-200">{{ item.label }}</span>
        <span class="shrink-0 text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{{ item.value }}</span>
      </div>
      <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200/50 dark:bg-white/10">
        <div class="h-full rounded-full" :style="{ width: barWidth(index), backgroundColor: accent }"></div>
      </div>
      <p v-if="item.sublabel" class="mt-0.5 truncate text-[11px] text-gray-400 dark:text-gray-500">{{ item.sublabel }}</p>
    </li>
  </ul>
</template>
