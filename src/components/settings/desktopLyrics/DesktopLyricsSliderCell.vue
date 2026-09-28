<script setup lang="ts">
import { computed } from 'vue';

import RangeSlider from '../../common/RangeSlider.vue';

const props = withDefaults(
  defineProps<{
    modelValue: number;
    min: number;
    max: number;
    step: number;
    /** true 时按百分比展示，false 时展示原始数值 */
    percent?: boolean;
    /** 传给滑杆的 aria-label */
    ariaLabel?: string;
  }>(),
  { percent: true, ariaLabel: '' },
);

const emit = defineEmits<{ 'update:modelValue': [value: number] }>();

const shownValue = computed(() =>
  props.percent ? `${Math.round(props.modelValue * 100)}%` : `${props.modelValue}`,
);
</script>

<template>
  <div class="dlx-slider-cell">
    <div class="dlx-slider-label shrink-0 text-left"><slot /></div>
    <RangeSlider
      :model-value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      variant="compact"
      :aria-label="ariaLabel"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <span class="text-right font-mono text-[13px] font-bold text-gray-700 dark:text-gray-300">{{ shownValue }}</span>
  </div>
</template>

<style scoped>
.dlx-slider-cell {
  flex: 1;
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) 46px;
  align-items: center;
  gap: 12px;
  min-width: 0;
  min-height: 48px;
  padding: 7px 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(229, 231, 235, 0.4);
  transition: all 180ms ease;
}

:global(.dark) .dlx-slider-cell {
  background: rgba(0, 0, 0, 0.1);
  border-color: rgba(31, 41, 55, 0.4);
}

.dlx-slider-cell:hover {
  background: rgba(255, 255, 255, 0.3);
  border-color: rgba(236, 65, 65, 0.35);
}

:global(.dark) .dlx-slider-cell:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(236, 65, 65, 0.35);
}

.dlx-slider-label {
  font-size: 13px;
  font-weight: 700;
  color: rgb(55 65 81);
  user-select: none;
  white-space: nowrap;
}

:global(.dark) .dlx-slider-label {
  color: rgba(255, 255, 255, 0.68);
}
</style>
