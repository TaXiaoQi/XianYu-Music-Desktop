<script setup lang="ts">
import { computed } from 'vue';
import { Minus, Plus } from 'lucide-vue-next';

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

// 步进调节：±1 step 并夹紧到 [min, max]；toFixed 消除浮点累加误差（0.05 步进）
const stepBy = (direction: 1 | -1) => {
  const next = parseFloat((props.modelValue + direction * props.step).toFixed(4));
  emit('update:modelValue', Math.min(props.max, Math.max(props.min, next)));
};

const atMin = computed(() => props.modelValue <= props.min);
const atMax = computed(() => props.modelValue >= props.max);
</script>

<template>
  <div class="dlx-slider-cell">
    <div class="dlx-slider-label shrink-0 text-left"><slot /></div>
    <button
      type="button"
      class="dlx-step-btn"
      :aria-label="`${ariaLabel}减小`"
      :disabled="atMin"
      @click="stepBy(-1)"
    >
      <Minus :size="12" :stroke-width="2.5" aria-hidden="true" />
    </button>
    <RangeSlider
      :model-value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      variant="compact"
      :aria-label="ariaLabel"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <button
      type="button"
      class="dlx-step-btn"
      :aria-label="`${ariaLabel}增大`"
      :disabled="atMax"
      @click="stepBy(1)"
    >
      <Plus :size="12" :stroke-width="2.5" aria-hidden="true" />
    </button>
    <span class="text-right font-mono text-[13px] font-bold text-gray-700 dark:text-gray-300">{{ shownValue }}</span>
  </div>
</template>

<style scoped>
.dlx-slider-cell {
  flex: 1;
  display: grid;
  grid-template-columns: 56px 22px minmax(0, 1fr) 22px 46px;
  align-items: center;
  gap: 10px;
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

.dlx-step-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 9999px;
  color: rgb(107 114 128);
  background: rgba(255, 255, 255, 0.4);
  border: 1px solid rgba(229, 231, 235, 0.5);
  transition: all 150ms ease;
  user-select: none;
}

.dlx-step-btn:hover:not(:disabled) {
  color: #ec4141;
  border-color: rgba(236, 65, 65, 0.5);
  background: rgba(236, 65, 65, 0.08);
}

:global(.dark) .dlx-step-btn {
  color: rgba(255, 255, 255, 0.55);
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.12);
}

:global(.dark) .dlx-step-btn:hover:not(:disabled) {
  color: #ec4141;
  border-color: rgba(236, 65, 65, 0.5);
  background: rgba(236, 65, 65, 0.12);
}

.dlx-step-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
