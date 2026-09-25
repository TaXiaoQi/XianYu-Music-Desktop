<script setup lang="ts">
import { computed } from 'vue';

/** 现有滑块的呈现变体，逐值对应迁移前的各类实现 */
type RangeSliderVariant =
  | 'brand'      // 红渐变轨道 + 16px 红圆点（原 .flow-slider / .fx-slider）
  | 'warm'       // 轨道红→橙（原 .desktop-slider）
  | 'native'     // 只统一 accent-color，轨道样式由调用方 class 提供
  | 'compact'    // 半透明细轨道 + 14px 白点（原 .desktop-compact-range-slider）
  | 'compact-sm' // 12px 白点（原 .font-size-slider）
  | 'fader'      // 竖直推子（原 .eq-fader-input）
  | 'skin'       // 6px 轨道 + 14px 白色圆点 + 外发光（原 CustomSkinModal 的 scoped input[type=range]）
  | 'hue'        // 8px 彩虹轨道 + 14px 空心圆点（原 .hue-slider）
  | 'hue-lg';    // 14px 彩虹轨道 + 22px 空心圆点（原 .desktop-custom-hue-slider）

const props = withDefaults(defineProps<{
  modelValue?: number;
  // min/max/step 允许字符串：与原生 <input type="range"> 的写法一致，原样透传给 input
  min?: number | string;
  max?: number | string;
  step?: number | string;
  disabled?: boolean;
  variant?: RangeSliderVariant;
  /** 仅 brand：hover / 按住时圆点放大（原 .fx-slider 的交互反馈） */
  interactive?: boolean;
  /** 仅 brand：0~100，轨道按该百分比填充（替代原 --pitch-progress 写法） */
  progress?: number;
}>(), {
  min: 0,
  max: 100,
  step: 1,
  disabled: false,
  variant: 'brand',
  interactive: false,
});

const emit = defineEmits<{ 'update:modelValue': [value: number] }>();

// attrs 由本组件显式转交到 input 上（class / style / aria-label 等原样透传）
defineOptions({ inheritAttrs: false });

const rangeClass = computed(() => [
  'xy-range',
  `xy-range--${props.variant}`,
  {
    'xy-range--interactive': props.interactive,
    'xy-range--progress': props.variant === 'brand' && props.progress !== undefined,
  },
]);

const rangeStyle = computed(() => {
  if (props.progress === undefined) return undefined;
  const clamped = Math.min(100, Math.max(0, props.progress));
  return { '--xy-progress': `${clamped}%` };
});

function handleInput(event: Event) {
  emit('update:modelValue', Number((event.target as HTMLInputElement).value));
}
</script>

<template>
  <input
    type="range"
    :class="rangeClass"
    :min="min"
    :max="max"
    :step="step"
    :disabled="disabled"
    :value="modelValue"
    :style="rangeStyle"
    v-bind="$attrs"
    @input="handleInput"
  >
</template>

<style>
/* ==========================================================================
   共用 range 滑块。
   每个变体的取值都逐字复制自迁移前的实现，观感与迁移前保持一致；
   改这里的任何数值都会同时影响所有引用处。
   类名带 xy-range 命名空间，只命中本组件渲染出的 input。
   ========================================================================== */

/* ---------- brand：红渐变轨道 + 16px 红圆点 ---------- */
.xy-range--brand {
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  border-radius: 9999px;
  background: linear-gradient(90deg, rgba(236, 65, 65, 0.18), rgba(236, 65, 65, 0.62));
  outline: none;
  cursor: pointer;
}

.xy-range--brand::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.95);
  border-radius: 9999px;
  background: #ec4141;
  box-shadow: 0 4px 10px rgba(236, 65, 65, 0.35);
  cursor: pointer;
}

.xy-range--brand::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.95);
  border-radius: 9999px;
  background: #ec4141;
  box-shadow: 0 4px 10px rgba(236, 65, 65, 0.35);
  cursor: pointer;
}

.xy-range--brand.xy-range--interactive::-webkit-slider-thumb {
  transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.xy-range--brand.xy-range--interactive::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.xy-range--brand.xy-range--interactive:active::-webkit-slider-thumb {
  transform: scale(1.35);
}

/* 禁用态：轨道与圆点置灰，且不再放大 */
.xy-range--brand:disabled {
  background: linear-gradient(90deg, rgba(0, 0, 0, 0.06), rgba(0, 0, 0, 0.14));
  cursor: not-allowed;
}

html.dark .xy-range--brand:disabled {
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.14));
}

.xy-range--brand:disabled::-webkit-slider-thumb {
  background: #b9b9b9;
  box-shadow: none;
  cursor: not-allowed;
}

.xy-range--brand:disabled::-webkit-slider-thumb:hover,
.xy-range--brand:disabled:active::-webkit-slider-thumb {
  transform: none;
}

.xy-range--brand:disabled::-moz-range-thumb {
  background: #b9b9b9;
  box-shadow: none;
  cursor: not-allowed;
}

/* 进度填充：与禁用态同优先级，沿用原实现的先后顺序（进度在后，故优先） */
.xy-range--brand.xy-range--progress {
  background: linear-gradient(
    to right,
    rgba(236, 65, 65, 0.5) 0%,
    rgba(236, 65, 65, 0.5) var(--xy-progress, 50%),
    rgba(0, 0, 0, 0.08) var(--xy-progress, 50%),
    rgba(0, 0, 0, 0.08) 100%
  );
}

html.dark .xy-range--brand.xy-range--progress {
  background: linear-gradient(
    to right,
    rgba(236, 65, 65, 0.55) 0%,
    rgba(236, 65, 65, 0.55) var(--xy-progress, 50%),
    rgba(255, 255, 255, 0.12) var(--xy-progress, 50%),
    rgba(255, 255, 255, 0.12) 100%
  );
}

/* ---------- warm：轨道红 → 橙 ---------- */
.xy-range--warm {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(236, 65, 65, 0.88), rgba(251, 146, 60, 0.88));
  outline: none;
  cursor: pointer;
}

.xy-range--warm::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border: 2px solid #fff;
  border-radius: 999px;
  background: #ec4141;
  box-shadow: 0 2px 8px rgba(236, 65, 65, 0.3);
  cursor: pointer;
}

.xy-range--warm::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: 2px solid #fff;
  border-radius: 999px;
  background: #ec4141;
  box-shadow: 0 2px 8px rgba(236, 65, 65, 0.3);
  cursor: pointer;
}

/* ---------- native：只统一强调色，轨道由调用方 class 决定 ---------- */
.xy-range--native {
  accent-color: #ec4141;
}

/* ---------- compact：半透明细轨道 + 14px 白点 ---------- */
.xy-range--compact {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 20px;
  background: transparent;
  border: none;
  outline: none;
  cursor: pointer;
  margin: 0;
  padding: 0;
}

.xy-range--compact::-webkit-slider-runnable-track {
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.1);
  transition: background 150ms ease;
}

html.dark .xy-range--compact::-webkit-slider-runnable-track {
  background: rgba(255, 255, 255, 0.16);
}

.xy-range--compact:hover::-webkit-slider-runnable-track {
  background: rgba(15, 23, 42, 0.16);
}

html.dark .xy-range--compact:hover::-webkit-slider-runnable-track {
  background: rgba(255, 255, 255, 0.24);
}

.xy-range--compact::-moz-range-track {
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.1);
  border: none;
  transition: background 150ms ease;
}

html.dark .xy-range--compact::-moz-range-track {
  background: rgba(255, 255, 255, 0.16);
}

.xy-range--compact:hover::-moz-range-track {
  background: rgba(15, 23, 42, 0.16);
}

html.dark .xy-range--compact:hover::-moz-range-track {
  background: rgba(255, 255, 255, 0.24);
}

.xy-range--compact::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.06);
  box-shadow: 0 2px 4px rgba(15, 23, 42, 0.12), 0 0 1px rgba(15, 23, 42, 0.2);
  margin-top: -5px;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.xy-range--compact::-webkit-slider-thumb:hover {
  transform: scale(1.18);
  box-shadow: 0 3px 6px rgba(15, 23, 42, 0.16), 0 0 2px rgba(15, 23, 42, 0.24);
}

.xy-range--compact::-webkit-slider-thumb:active {
  transform: scale(1.05);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.14);
}

.xy-range--compact::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.06);
  box-shadow: 0 2px 4px rgba(15, 23, 42, 0.12), 0 0 1px rgba(15, 23, 42, 0.2);
  transition: transform 120ms ease, box-shadow 120ms ease;
  box-sizing: border-box;
}

.xy-range--compact::-moz-range-thumb:hover {
  transform: scale(1.18);
  box-shadow: 0 3px 6px rgba(15, 23, 42, 0.16), 0 0 2px rgba(15, 23, 42, 0.24);
}

.xy-range--compact::-moz-range-thumb:active {
  transform: scale(1.05);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.14);
}

/* ---------- compact-sm：12px 白点（进度渐变由调用方 :style 提供） ---------- */
.xy-range--compact-sm::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 9999px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(0, 0, 0, 0.05);
}

.xy-range--compact-sm::-moz-range-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border: 0;
  border-radius: 9999px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(0, 0, 0, 0.05);
}

.xy-range--compact-sm::-moz-range-track {
  height: 4px;
  border-radius: 9999px;
  background: transparent;
}

/* ---------- fader：竖直推子 ---------- */
.xy-range--fader {
  -webkit-appearance: none;
  appearance: none;
  writing-mode: vertical-lr;
  direction: rtl;
  width: 6px;
  height: 140px;
  background: linear-gradient(to top, rgba(236, 65, 65, 0.15), rgba(236, 65, 65, 0.5));
  border-radius: 9999px;
  outline: none;
  cursor: pointer;
  position: relative;
  z-index: 1;
}

.xy-range--fader::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 24px;
  height: 10px;
  border-radius: 3px;
  background: #ec4141;
  cursor: grab;
  border: 1px solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  transition: transform 0.1s, box-shadow 0.15s;
}

.xy-range--fader::-webkit-slider-thumb:hover {
  transform: scaleY(1.15);
  box-shadow: 0 2px 6px rgba(236, 65, 65, 0.4);
}

.xy-range--fader:active::-webkit-slider-thumb {
  cursor: grabbing;
  transform: scaleY(1.25);
}

.xy-range--fader::-moz-range-thumb {
  width: 24px;
  height: 10px;
  border-radius: 3px;
  background: #ec4141;
  cursor: grab;
  border: 1px solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}

.xy-range--fader::-moz-range-thumb:hover {
  transform: scaleY(1.15);
  box-shadow: 0 2px 6px rgba(236, 65, 65, 0.4);
}

.xy-range--fader:active::-moz-range-thumb {
  cursor: grabbing;
  transform: scaleY(1.25);
}

/* ---------- skin：6px 轨道 + 14px 白色圆点 + 外发光 ---------- */
.xy-range--skin {
  height: 6px;
}

.xy-range--skin::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  background: white;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
}

/* ---------- hue：8px 彩虹轨道 + 14px 空心圆点 ---------- */
.xy-range--hue {
  width: 100%;
  height: 8px;
  border-radius: 9999px;
  appearance: none;
  background: linear-gradient(
    to right,
    #ff0000 0%,
    #ffff00 17%,
    #00ff00 33%,
    #00ffff 50%,
    #0000ff 67%,
    #ff00ff 83%,
    #ff0000 100%
  );
  outline: none;
  cursor: pointer;
}

.xy-range--hue::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  border: 2px solid #ffffff;
  border-radius: 9999px;
  appearance: none;
  background: transparent;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  cursor: pointer;
}

.xy-range--hue::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 2px solid #ffffff;
  border-radius: 9999px;
  background: transparent;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  cursor: pointer;
}

/* ---------- hue-lg：14px 彩虹轨道 + 22px 空心圆点 ---------- */
.xy-range--hue-lg {
  width: 100%;
  height: 14px;
  border-radius: 999px;
  background: linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
  appearance: none;
  cursor: pointer;
}

.xy-range--hue-lg::-webkit-slider-thumb {
  width: 22px;
  height: 22px;
  border: 3px solid #fff;
  border-radius: 999px;
  background: transparent;
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.2), 0 2px 8px rgba(15, 23, 42, 0.22);
  appearance: none;
}

.xy-range--hue-lg::-moz-range-thumb {
  width: 22px;
  height: 22px;
  border: 3px solid #fff;
  border-radius: 999px;
  background: transparent;
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.2), 0 2px 8px rgba(15, 23, 42, 0.22);
}
</style>
