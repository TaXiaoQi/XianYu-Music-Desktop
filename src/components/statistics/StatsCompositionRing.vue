<script setup lang="ts">
/**
 * 环形占比图（内联 SVG stroke-dasharray）+ 数字图例。
 * 各段弧长与偏移由 statsCharts.ringSegments 计算，占比由 sharePercentages 计算。
 */
import { computed } from 'vue';

import { ringSegments, sharePercentages } from './statsCharts';

const RADIUS = 40;
const STROKE_WIDTH = 12;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const props = defineProps<{
  segments: { label: string; value: number; color: string }[];
  /** 占比分母（例如曲库总歌曲数）；缺省时用各段之和。 */
  total?: number;
}>();

const geometry = computed(() => ringSegments(props.segments.map(segment => segment.value), RADIUS));
const percents = computed(() => sharePercentages(props.segments.map(segment => segment.value), props.total));

function dashArray(index: number): string {
  const dash = geometry.value[index]?.dash ?? 0;
  return `${dash} ${CIRCUMFERENCE - dash}`;
}
</script>

<template>
  <div class="flex items-center gap-5">
    <svg viewBox="0 0 100 100" class="h-24 w-24 shrink-0">
      <circle
        cx="50"
        cy="50"
        :r="RADIUS"
        fill="none"
        stroke="currentColor"
        :stroke-width="STROKE_WIDTH"
        class="text-gray-200/60 dark:text-white/10"
      />
      <circle
        v-for="(segment, index) in segments"
        :key="segment.label"
        cx="50"
        cy="50"
        :r="RADIUS"
        fill="none"
        :stroke="segment.color"
        :stroke-width="STROKE_WIDTH"
        :stroke-dasharray="dashArray(index)"
        :stroke-dashoffset="geometry[index]?.offset ?? 0"
        transform="rotate(-90 50 50)"
      />
    </svg>
    <ul class="min-w-0 flex-1 space-y-2">
      <li v-for="(segment, index) in segments" :key="segment.label" class="flex items-center gap-2 text-xs">
        <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: segment.color }"></span>
        <span class="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300">{{ segment.label }}</span>
        <span class="shrink-0 tabular-nums text-gray-800 dark:text-gray-200">{{ segment.value }}</span>
        <span class="w-10 shrink-0 text-right tabular-nums text-gray-400 dark:text-gray-500">{{ Math.round(percents[index] ?? 0) }}%</span>
      </li>
    </ul>
  </div>
</template>
