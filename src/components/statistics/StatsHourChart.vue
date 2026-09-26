<script setup lang="ts">
/**
 * 24 小时播放分布：hour_distribution 下标即小时，值是该小时的播放次数。
 * 复用 StatsTrendChart，只在 0/6/12/18/23 点标刻度，并标出峰值小时。
 */
import { computed } from 'vue';

import { useI18n } from '../../features/i18n';
import { computePeakIndex } from './statsCharts';
import StatsTrendChart from './StatsTrendChart.vue';

const props = defineProps<{ values: number[] }>();

const { t } = useI18n();

const peakIndex = computed(() => computePeakIndex(props.values));

// 24 根柱子太密，偶数列标刻度即可
const labels = computed(() => props.values.map((_value, hour) => (
  hour % 6 === 0 || hour === props.values.length - 1 ? String(hour) : ''
)));

const peakLabel = computed(() => (
  peakIndex.value >= 0 ? t('stats.peakHour', { hour: peakIndex.value }) : ''
));
</script>

<template>
  <div class="space-y-2">
    <StatsTrendChart
      :values="values"
      :labels="labels"
      :highlight-index="peakIndex"
      :empty-hint="t('stats.hourEmpty')"
    />
    <p v-if="peakLabel" class="text-center text-[11px] text-gray-400 dark:text-gray-500">{{ peakLabel }}</p>
  </div>
</template>
