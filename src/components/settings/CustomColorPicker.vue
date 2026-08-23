<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { Pipette } from 'lucide-vue-next';

const props = defineProps<{
  modelValue: string;
  isOpen: boolean;
  triggerRef?: HTMLElement | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: string): void;
  (e: 'close'): void;
}>();

const panelRef = ref<HTMLElement | null>(null);
const satValBoxRef = ref<HTMLElement | null>(null);
const nativeColorInputRef = ref<HTMLInputElement | null>(null);
const panelStyle = ref<Record<string, string>>({});

// ----- HSV <-> RGB <-> HEX 工具函数 -----
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean.split('').map(c => c + c).join('');
  }
  const num = parseInt(clean, 16);
  if (isNaN(num)) return { r: 236, g: 65, b: 65 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), v: Math.round(v * 100) };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  h = (h % 360) / 360;
  s = s / 100;
  v = v / 100;

  let r = 0, g = 0, b = 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

// ----- 状态 -----
const hsv = ref({ h: 0, s: 100, v: 100 });
const rgb = ref({ r: 236, g: 65, b: 65 });
const isDraggingSatVal = ref(false);

// 依据 props.modelValue 初始化
watch(() => props.modelValue, (val) => {
  if (isDraggingSatVal.value) return;
  const newRgb = hexToRgb(val);
  rgb.value = newRgb;
  hsv.value = rgbToHsv(newRgb.r, newRgb.g, newRgb.b);
}, { immediate: true });

// 色相纯色背景
const huePureBg = computed(() => {
  const { r, g, b } = hsvToRgb(hsv.value.h, 100, 100);
  return `rgb(${r}, ${g}, ${b})`;
});

// 指示光标位置
const cursorStyle = computed(() => ({
  left: `${hsv.value.s}%`,
  top: `${100 - hsv.value.v}%`,
}));

// 更新并触发回调
function updateFromHsv(h: number, s: number, v: number) {
  hsv.value = { h, s, v };
  const newRgb = hsvToRgb(h, s, v);
  rgb.value = newRgb;
  const hex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
  emit('update:modelValue', hex);
}

function updateFromRgb(r: number, g: number, b: number) {
  rgb.value = { r, g, b };
  hsv.value = rgbToHsv(r, g, b);
  const hex = rgbToHex(r, g, b);
  emit('update:modelValue', hex);
}

// ----- 2D 饱和度/明度画布拖拽 -----
function handleSatValPointerDown(e: PointerEvent) {
  isDraggingSatVal.value = true;
  updateSatValFromPointer(e);
  window.addEventListener('pointermove', handleSatValPointerMove);
  window.addEventListener('pointerup', stopSatValDrag);
}

function handleSatValPointerMove(e: PointerEvent) {
  if (!isDraggingSatVal.value) return;
  updateSatValFromPointer(e);
}

function stopSatValDrag() {
  isDraggingSatVal.value = false;
  window.removeEventListener('pointermove', handleSatValPointerMove);
  window.removeEventListener('pointerup', stopSatValDrag);
}

function updateSatValFromPointer(e: PointerEvent) {
  const box = satValBoxRef.value;
  if (!box) return;
  const rect = box.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

  const s = Math.round((x / rect.width) * 100);
  const v = Math.round((1 - y / rect.height) * 100);
  updateFromHsv(hsv.value.h, s, v);
}

// ----- 吸管工具 -----
async function openEyeDropper() {
  if ('EyeDropper' in window) {
    try {
      const eyeDropper = new (window as any).EyeDropper();
      const result = await eyeDropper.open();
      if (result?.sRGBHex) {
        emit('update:modelValue', result.sRGBHex.toUpperCase());
      }
    } catch {
      // 用户取消取色
    }
  } else {
    nativeColorInputRef.value?.click();
  }
}

// ----- 定位计算 -----
function updatePosition() {
  if (!props.triggerRef) return;
  const rect = props.triggerRef.getBoundingClientRect();
  const menuWidth = 280;
  const menuHeight = 320;
  const gap = 10;

  let left = rect.left;
  if (left + menuWidth > window.innerWidth - 12) {
    left = window.innerWidth - menuWidth - 12;
  }
  if (left < 12) left = 12;

  const spaceBelow = window.innerHeight - rect.bottom;
  const shouldOpenUpward = spaceBelow < menuHeight && rect.top > menuHeight;

  panelStyle.value = shouldOpenUpward
    ? {
        position: 'fixed',
        left: `${Math.round(left)}px`,
        bottom: `${Math.round(window.innerHeight - rect.top + gap)}px`,
        width: `${menuWidth}px`,
      }
    : {
        position: 'fixed',
        left: `${Math.round(left)}px`,
        top: `${Math.round(rect.bottom + gap)}px`,
        width: `${menuWidth}px`,
      };
}

watch(() => props.isOpen, (open) => {
  if (open) {
    nextTick(updatePosition);
  }
});

function handlePointerDownOutside(event: MouseEvent) {
  if (!props.isOpen) return;
  const target = event.target as Node | null;
  if (!target) return;
  if (props.triggerRef?.contains(target)) return;
  if (panelRef.value?.contains(target)) return;
  emit('close');
}

function handleEscape(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.isOpen) {
    emit('close');
  }
}

onMounted(() => {
  window.addEventListener('mousedown', handlePointerDownOutside);
  window.addEventListener('keydown', handleEscape);
  window.addEventListener('resize', updatePosition);
  document.addEventListener('scroll', updatePosition, true);
});

onUnmounted(() => {
  window.removeEventListener('mousedown', handlePointerDownOutside);
  window.removeEventListener('keydown', handleEscape);
  window.removeEventListener('resize', updatePosition);
  document.removeEventListener('scroll', updatePosition, true);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="picker-pop">
      <div
        v-if="isOpen"
        ref="panelRef"
        class="picker-pop-panel select-none backdrop-blur-2xl shadow-2xl rounded-2xl border p-3 z-[130] overflow-hidden"
        :style="panelStyle"
        @click.stop
        @mousedown.stop
      >
        <!-- 1. 二维 2D HSV 饱和度/明度选择面板（外层大圆角 rounded-xl） -->
        <div
          ref="satValBoxRef"
          class="relative w-full h-44 rounded-xl cursor-crosshair overflow-hidden touch-none"
          :style="{ backgroundColor: huePureBg }"
          @pointerdown="handleSatValPointerDown"
        >
          <!-- 白色到透明渐变 (左到右) -->
          <div class="absolute inset-0 bg-gradient-to-r from-white to-transparent"></div>
          <!-- 黑色到透明渐变 (下到上) -->
          <div class="absolute inset-0 bg-gradient-to-t from-black to-transparent"></div>
          
          <!-- 选色光标指示环（带白色边框与阴影） -->
          <div
            class="absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full border-2 border-white shadow-md pointer-events-none transition-transform duration-75"
            :style="cursorStyle"
          >
            <div class="w-full h-full rounded-full border border-black/30"></div>
          </div>
        </div>

        <!-- 2. 中间控制行：吸管 + 颜色预览球 + 彩虹色相 Hue 滑块 -->
        <div class="mt-3 flex items-center gap-3 px-1">
          <!-- 吸管工具按键 -->
          <button
            type="button"
            class="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 dark:text-white/60 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            title="吸管取色"
            @click="openEyeDropper"
          >
            <Pipette class="h-4 w-4" />
          </button>

          <!-- 挂载点（给不支持 EyeDropper 的浏览器回退使用原生色盘吸管） -->
          <input
            ref="nativeColorInputRef"
            :value="modelValue"
            type="color"
            class="sr-only"
            @input="emit('update:modelValue', ($event.target as HTMLInputElement).value.toUpperCase())"
          />

          <!-- 颜色预览图圆球 -->
          <div
            class="w-6 h-6 rounded-full border border-black/10 dark:border-white/20 shadow-sm shrink-0"
            :style="{ backgroundColor: modelValue }"
          ></div>

          <!-- 彩虹色相 (Hue) 渐变滑块 -->
          <div class="relative flex-1 h-3 flex items-center">
            <input
              :value="hsv.h"
              type="range"
              min="0"
              max="360"
              step="1"
              class="hue-slider"
              @input="updateFromHsv(Number(($event.target as HTMLInputElement).value), hsv.s, hsv.v)"
            />
          </div>
        </div>

        <!-- 3. 底部 R / G / B 数字输入区 -->
        <div class="mt-3 grid grid-cols-3 gap-2 px-1 text-center">
          <div class="flex flex-col gap-1">
            <input
              :value="rgb.r"
              type="number"
              min="0"
              max="255"
              class="h-8 rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 font-mono text-xs text-center text-gray-800 dark:text-gray-100 outline-none focus:border-[#EC4141]/50 focus:ring-1 focus:ring-[#EC4141]/20"
              @input="updateFromRgb(Number(($event.target as HTMLInputElement).value), rgb.g, rgb.b)"
            />
            <span class="text-[10px] font-medium text-gray-400">R</span>
          </div>

          <div class="flex flex-col gap-1">
            <input
              :value="rgb.g"
              type="number"
              min="0"
              max="255"
              class="h-8 rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 font-mono text-xs text-center text-gray-800 dark:text-gray-100 outline-none focus:border-[#EC4141]/50 focus:ring-1 focus:ring-[#EC4141]/20"
              @input="updateFromRgb(rgb.r, Number(($event.target as HTMLInputElement).value), rgb.b)"
            />
            <span class="text-[10px] font-medium text-gray-400">G</span>
          </div>

          <div class="flex flex-col gap-1">
            <input
              :value="rgb.b"
              type="number"
              min="0"
              max="255"
              class="h-8 rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 font-mono text-xs text-center text-gray-800 dark:text-gray-100 outline-none focus:border-[#EC4141]/50 focus:ring-1 focus:ring-[#EC4141]/20"
              @input="updateFromRgb(rgb.r, rgb.g, Number(($event.target as HTMLInputElement).value))"
            />
            <span class="text-[10px] font-medium text-gray-400">B</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 面板底色与模糊造型 */
.picker-pop-panel {
  background: rgba(255, 255, 255, 0.92);
  border-color: rgba(0, 0, 0, 0.08);
}

:deep(.dark) .picker-pop-panel,
.dark .picker-pop-panel {
  background: rgba(38, 38, 38, 0.92);
  border-color: rgba(255, 255, 255, 0.1);
}

/* 进退场弹性缩放与渐变动画 */
.picker-pop-enter-active,
.picker-pop-leave-active {
  transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.picker-pop-enter-from,
.picker-pop-leave-to {
  opacity: 0;
  transform: scale(0.9) translateY(8px);
}

/* 彩虹色相滑块自定义 */
.hue-slider {
  width: 100%;
  height: 8px;
  border-radius: 9999px;
  appearance: none;
  background: linear-gradient(
    to right,
    #ff0000 0%, #ffff00 17%, #00ff00 33%,
    #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%
  );
  outline: none;
  cursor: pointer;
}

.hue-slider::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  border: 2px solid #ffffff;
  border-radius: 9999px;
  appearance: none;
  background: transparent;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  cursor: pointer;
}

.hue-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 2px solid #ffffff;
  border-radius: 9999px;
  background: transparent;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  cursor: pointer;
}
</style>
