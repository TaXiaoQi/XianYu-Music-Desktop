<script setup lang="ts">
/**
 * 通用竖向柱状图（纯内联 SVG，无图表库）。
 * 归一化、最小可见高度等几何计算都在 statsCharts.ts，这里只做渲染。
 * 趋势图（近 7 天）与时段分布（24 小时）都用它，靠 highlightIndex 高亮峰值。
 */
import { computed } from 'vue';

import { barHeights, normalizeBars } from './statsCharts';

const VIEW_HEIGHT = 100;
const MIN_VISIBLE_HEIGHT = 2;

const props = withDefaults(defineProps<{
  values: number[];
  labels?: string[];
  highlightIndex?: number;
  accent?: string;
  emptyHint?: string;
  formatValue?: (value: number) => string;
}>(), {
  labels: () => [],
  highlightIndex: -1,
  accent: '#EC4141',
  emptyHint: '',
  formatValue: (value: number) => String(value),
});

const heights = computed(() => barHeights(props.values, VIEW_HEIGHT, MIN_VISIBLE_HEIGHT));
const hasData = computed(() => normalizeBars(props.values).some(ratio => ratio > 0));
const slotWidth = computed(() => (props.values.length > 0 ? 100 / props.values.length : 100));
const barWidth = computed(() => slotWidth.value * 0.6);

function barX(index: number): number {
  return index * slotWidth.value + (slotWidth.value - barWidth.value) / 2;
}

function barTitle(index: number): string {
  const label = props.labels[index] ?? '';
  const text = props.formatValue(props.values[index] ?? 0);
  return label ? `${label} · ${text}` : text;
}

function barColor(index: number): string {
  // 峰值用实心主题色，其余半透明
  return index === props.highlightIndex ? props.accent : `${props.accent}99`;
}
</script>

<template>
  <div class="w-full">
    <div
      v-if="!hasData"
      class="flex h-28 items-center justify-center rounded-xl border border-dashed border-gray-200/60 px-3 text-center text-xs text-gray-400 dark:border-gray-700/60 dark:text-gray-500"
    >
      {{ emptyHint }}
    </div>
    <template v-else>
      <svg :viewBox="`0 0 100 ${VIEW_HEIGHT}`" preserveAspectRatio="none" class="h-28 w-full">
        <rect
          v-for="(height, index) in heights"
          :key="index"
          :x="barX(index)"
          :y="VIEW_HEIGHT - height"
          :width="barWidth"
          :height="height"
          rx="1.5"
          :fill="barColor(index)"
        >
          <title>{{ barTitle(index) }}</title>
        </rect>
      </svg>
      <div v-if="labels.length" class="mt-1 flex w-full">
        <span
          v-for="(label, index) in labels"
          :key="index"
          class="block flex-1 truncate text-center text-[10px] text-gray-400 dark:text-gray-500"
        >
          {{ label }}
        </span>
      </div>
    </template>
  </div>
</template>
