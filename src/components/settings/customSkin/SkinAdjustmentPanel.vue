<script setup lang="ts">
import type { ThemeSettings } from '../../../types';
import RangeSlider from '../../common/RangeSlider.vue';

type SkinDraft = ThemeSettings['customBackground'];

defineProps<{
  /** 皮肤预览草稿（响应式对象，滑杆直接原地更新） */
  draft: SkinDraft;
}>();

// 前景字体色档位（文案对用户可见，保持原样）
const foregroundOptions = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
] as const;

const sliderChromeClass = 'w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-[#EC4141]';
</script>

<template>
  <div class="space-y-5">
    <div class="space-y-2">
      <div class="flex items-center justify-between text-xs text-white/60">
        <span>模糊度</span>
        <span>{{ draft.blur }}px</span>
      </div>
      <RangeSlider
        v-model="draft.blur"
        :min="0"
        :max="50"
        :step="1"
        variant="skin"
        :class="sliderChromeClass"
      />
    </div>

    <div class="space-y-2">
      <div class="flex items-center justify-between text-xs text-white/60">
        <span>遮罩浓度</span>
        <span>{{ Math.round(draft.maskAlpha * 100) }}%</span>
      </div>
      <RangeSlider
        v-model="draft.maskAlpha"
        :min="0"
        :max="1"
        :step="0.01"
        variant="skin"
        :class="sliderChromeClass"
      />
    </div>

    <div class="space-y-2">
      <div class="flex items-center justify-between text-xs text-white/60">
        <span>背景亮度</span>
        <span>{{ Math.round(draft.opacity * 100) }}%</span>
      </div>
      <RangeSlider
        v-model="draft.opacity"
        :min="0.1"
        :max="1"
        :step="0.01"
        variant="skin"
        :class="sliderChromeClass"
      />
    </div>

    <div class="space-y-2">
      <div class="flex items-center justify-between text-xs text-white/60">
        <span>画面缩放</span>
        <span>{{ draft.scale.toFixed(2) }}x</span>
      </div>
      <RangeSlider
        v-model="draft.scale"
        :min="1"
        :max="2.0"
        :step="0.01"
        variant="skin"
        :class="sliderChromeClass"
      />
    </div>

    <div class="space-y-2">
      <div class="flex items-center justify-between text-xs text-white/60">
        <span>字体颜色</span>
      </div>
      <div class="flex gap-1 rounded-lg bg-white/10 p-1">
        <button
          v-for="option in foregroundOptions"
          :key="option.value"
          class="flex-1 rounded-md py-1.5 text-xs font-medium transition-all"
          :class="draft.foregroundStyle === option.value ? 'bg-[#EC4141] text-white shadow-sm' : 'text-white/60 hover:bg-white/5 hover:text-white'"
          @click="draft.foregroundStyle = option.value"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
  </div>
</template>
