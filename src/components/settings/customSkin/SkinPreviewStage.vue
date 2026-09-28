<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';

import type { ThemeSettings } from '../../../types';
import { calculateCoverGeometry } from '../../../composables/useThemeBackgroundGeometry';
import { probeImageSize } from './mediaProbe';

type SkinDraft = ThemeSettings['customBackground'];

const props = defineProps<{
  /** 皮肤预览草稿（响应式对象，拖拽/滚轮直接原地更新） */
  draft: SkinDraft;
}>();

// —— 视口与舞台测量 ——
const stageEl = ref<HTMLDivElement | null>(null);
const viewportWidth = ref(0);
const viewportHeight = ref(0);

// —— 拖拽瞬时状态 ——
const dragging = ref(false);
let grabX = 0;
let grabY = 0;
let grabTranslateX = 0;
let grabTranslateY = 0;
let stageDisposed = false;

// 模糊会放大边缘漏底，渲染尺度需要一并补偿
const blurCompensation = computed(() => Math.min(0.08, (props.draft.blur || 0) * 0.002));
const renderScale = computed(() => Math.max(1.0, (props.draft.scale || 1.0) + blurCompensation.value));

// 等比铺满几何：以媒体自然尺寸为基准
const coverGeometry = computed(() =>
  calculateCoverGeometry(
    viewportWidth.value,
    viewportHeight.value,
    props.draft.imageWidth || 0,
    props.draft.imageHeight || 0,
  ),
);

const darkForeground = computed(() => props.draft.foregroundStyle === 'dark');

// 媒体元素共用同一变换表达式
const mediaTransform = computed(
  () =>
    `translate3d(${(props.draft.translateX || 0) * viewportWidth.value}px, ${(props.draft.translateY || 0) * viewportHeight.value}px, 0) scale(${renderScale.value})`,
);

const mediaFilter = computed(() => `blur(${props.draft.blur}px)`);
const mediaOpacity = computed(() => props.draft.opacity ?? 1.0);

/** 全局背景的真实宽高比（兜底取窗口宽高比） */
const detectBackgroundRatio = () => {
  const bgEl = document.querySelector('[data-global-background]');
  if (bgEl) {
    const rect = bgEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return rect.width / rect.height;
    }
  }
  return window.innerWidth / window.innerHeight;
};

/** 以背景宽高比在舞台内取最大可视区 */
const measureViewport = () => {
  if (!stageEl.value) {
    return;
  }
  const stageRect = stageEl.value.getBoundingClientRect();
  const stageWidth = stageRect.width;
  const stageHeight = stageRect.height;
  if (stageWidth <= 0 || stageHeight <= 0) {
    return;
  }

  const ratio = detectBackgroundRatio();
  let width = stageWidth;
  let height = stageWidth / ratio;
  if (height > stageHeight) {
    height = stageHeight;
    width = stageHeight * ratio;
  }

  viewportWidth.value = Math.floor(width);
  viewportHeight.value = Math.floor(height);
};

/** 防漏底平移钳制：保证缩放后媒体始终覆盖视口 */
const clampTranslation = (tx: number, ty: number, scale = props.draft.scale) => {
  if (!coverGeometry.value) {
    return { tx: 0, ty: 0 };
  }

  const effectiveScale = Math.max(1.0, scale + blurCompensation.value);
  const scaledWidth = coverGeometry.value.width * effectiveScale;
  const scaledHeight = coverGeometry.value.height * effectiveScale;

  const maxShiftX = Math.max(0, (scaledWidth - viewportWidth.value) / 2);
  const maxShiftY = Math.max(0, (scaledHeight - viewportHeight.value) / 2);

  const rawShiftX = tx * viewportWidth.value;
  const rawShiftY = ty * viewportHeight.value;

  return {
    tx: Math.max(-maxShiftX, Math.min(maxShiftX, rawShiftX)) / viewportWidth.value,
    ty: Math.max(-maxShiftY, Math.min(maxShiftY, rawShiftY)) / viewportHeight.value,
  };
};

/** 媒体超出视口才允许拖拽 */
const draggable = computed(() => {
  if (!props.draft.imagePath || !coverGeometry.value || viewportWidth.value <= 0 || viewportHeight.value <= 0) {
    return false;
  }
  const effectiveScale = Math.max(1.0, (props.draft.scale || 1.0) + blurCompensation.value);
  const scaledWidth = coverGeometry.value.width * effectiveScale;
  const scaledHeight = coverGeometry.value.height * effectiveScale;
  const maxShiftX = Math.max(0, (scaledWidth - viewportWidth.value) / 2);
  const maxShiftY = Math.max(0, (scaledHeight - viewportHeight.value) / 2);
  return maxShiftX > 0.5 || maxShiftY > 0.5;
});

const beginDrag = (event: PointerEvent) => {
  if (!props.draft.imagePath || !draggable.value) {
    return;
  }
  event.preventDefault();

  const stage = event.currentTarget as HTMLDivElement;
  grabX = event.clientX;
  grabY = event.clientY;
  grabTranslateX = props.draft.translateX || 0;
  grabTranslateY = props.draft.translateY || 0;
  stage.setPointerCapture(event.pointerId);
  dragging.value = true;
};

const trackDrag = (event: PointerEvent) => {
  if (!dragging.value || viewportWidth.value <= 0 || viewportHeight.value <= 0) {
    return;
  }

  const rawTx = grabTranslateX + (event.clientX - grabX) / viewportWidth.value;
  const rawTy = grabTranslateY + (event.clientY - grabY) / viewportHeight.value;
  const clamped = clampTranslation(rawTx, rawTy);

  props.draft.translateX = clamped.tx;
  props.draft.translateY = clamped.ty;
};

const settleDrag = (event: PointerEvent) => {
  if (!dragging.value) {
    return;
  }
  const stage = event.currentTarget as HTMLDivElement;
  if (stage.hasPointerCapture(event.pointerId)) {
    try {
      stage.releasePointerCapture(event.pointerId);
    } catch {
      /* 指针已释放时忽略 */
    }
  }
  dragging.value = false;
};

/** 滚轮以光标为锚点缩放画面 */
const handleWheelZoom = (event: WheelEvent) => {
  if (!props.draft.imagePath || viewportWidth.value <= 0 || viewportHeight.value <= 0) {
    return;
  }
  event.preventDefault();

  const viewportEl = document.getElementById('skin-preview-viewport');
  if (!viewportEl) {
    return;
  }
  const viewportRect = viewportEl.getBoundingClientRect();

  const anchorX = event.clientX - viewportRect.left - viewportWidth.value / 2;
  const anchorY = event.clientY - viewportRect.top - viewportHeight.value / 2;

  const previousScale = props.draft.scale || 1.0;
  const previousShiftX = (props.draft.translateX || 0) * viewportWidth.value;
  const previousShiftY = (props.draft.translateY || 0) * viewportHeight.value;

  const zoomStep = 0.05;
  const delta = event.deltaY < 0 ? zoomStep : -zoomStep;
  let nextScale = previousScale + delta;
  nextScale = Math.max(1.0, Math.min(2.0, nextScale));
  nextScale = Math.round(nextScale * 100) / 100;
  if (nextScale === previousScale) {
    return;
  }

  // 保持光标下的画面点不动
  const ratio = nextScale / previousScale;
  const nextShiftX = anchorX - (anchorX - previousShiftX) * ratio;
  const nextShiftY = anchorY - (anchorY - previousShiftY) * ratio;

  const clamped = clampTranslation(nextShiftX / viewportWidth.value, nextShiftY / viewportHeight.value, nextScale);

  props.draft.scale = nextScale;
  props.draft.translateX = clamped.tx;
  props.draft.translateY = clamped.ty;
};

// 视口/媒体尺寸或缩放变化后做一次安全钳制
watch(
  [viewportWidth, viewportHeight, () => props.draft.imageWidth, () => props.draft.imageHeight, () => props.draft.scale],
  () => {
    if (viewportWidth.value <= 0 || viewportHeight.value <= 0) {
      return;
    }
    const clamped = clampTranslation(props.draft.translateX || 0, props.draft.translateY || 0);
    props.draft.translateX = clamped.tx;
    props.draft.translateY = clamped.ty;
  },
);

let resizeObserver: ResizeObserver | null = null;

onMounted(async () => {
  measureViewport();
  window.addEventListener('resize', measureViewport);

  if (typeof ResizeObserver !== 'undefined' && stageEl.value) {
    resizeObserver = new ResizeObserver(() => {
      measureViewport();
    });
    resizeObserver.observe(stageEl.value);
  }

  // 草稿缺失自然尺寸时补测一次
  if (props.draft.imagePath && (!props.draft.imageWidth || !props.draft.imageHeight)) {
    try {
      const metadata = await probeImageSize(convertFileSrc(props.draft.imagePath));
      if (stageDisposed) {
        return;
      }
      props.draft.imageWidth = metadata.width;
      props.draft.imageHeight = metadata.height;
    } catch {
      /* 补测失败时沿用兜底几何 */
    }
  }
});

onUnmounted(() => {
  stageDisposed = true;
  window.removeEventListener('resize', measureViewport);
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
});
</script>

<template>
  <div
    ref="stageEl"
    class="group relative h-48 w-full overflow-hidden rounded-xl border border-white/5 bg-[#262626] select-none touch-none flex items-center justify-center"
    style="isolation: isolate;"
    :class="{
      'cursor-grab': draggable && !dragging,
      'cursor-grabbing': draggable && dragging
    }"
    @pointerdown="beginDrag"
    @pointermove="trackDrag"
    @pointerup="settleDrag"
    @pointercancel="settleDrag"
    @lostpointercapture="settleDrag"
    @wheel="handleWheelZoom"
  >
    <div
      id="skin-preview-viewport"
      class="relative overflow-visible z-10 transition-all duration-300"
      :style="{
        width: `${viewportWidth}px`,
        height: `${viewportHeight}px`
      }"
    >
      <template v-if="draft.imagePath">
        <div class="absolute inset-0">
          <div
            v-if="coverGeometry"
            class="absolute"
            :style="{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: `${coverGeometry.width}px`,
              height: `${coverGeometry.height}px`,
              transform: 'translate(-50%, -50%)',
            }"
          >
            <video
              v-if="draft.mediaType === 'video'"
              :src="convertFileSrc(draft.imagePath)"
              muted
              loop
              playsinline
              autoplay
              preload="metadata"
              class="absolute block max-w-none max-h-none select-none pointer-events-none"
              :style="{
                width: '100%',
                height: '100%',
                transform: mediaTransform,
                transformOrigin: 'center center',
                filter: mediaFilter,
                opacity: mediaOpacity,
              }"
            ></video>
            <img
              v-else
              :src="convertFileSrc(draft.imagePath)"
              class="absolute block max-w-none max-h-none select-none pointer-events-none"
              :style="{
                width: '100%',
                height: '100%',
                transform: mediaTransform,
                transformOrigin: 'center center',
                filter: mediaFilter,
                opacity: mediaOpacity,
              }"
            />
          </div>

          <!-- 遮罩层 -->
          <div
            class="absolute inset-0 z-[5] pointer-events-none"
            :style="{ backgroundColor: draft.maskColor, opacity: draft.maskAlpha }"
          ></div>
        </div>

        <!-- 前景字体预览 -->
        <div class="absolute inset-x-0 bottom-0 z-30 px-3 pb-3 pointer-events-none animate-in fade-in duration-300">
          <div class="flex items-end justify-between gap-3">
            <div class="min-w-0">
              <div
                class="text-[10px] font-medium uppercase tracking-[0.2em]"
                :class="darkForeground ? 'text-black/45' : 'text-white/60'"
              >
                字体预览
              </div>
              <div
                class="mt-1 truncate text-base font-bold"
                :class="darkForeground ? 'text-[#111111] drop-shadow-[0_1px_6px_rgba(255,255,255,0.18)]' : 'text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.4)]'"
              >
                夜航星
              </div>
              <div
                class="mt-1 truncate text-[12px]"
                :class="darkForeground ? 'text-black/65' : 'text-white/72'"
              >
                浅色和深色字体会直接预览在这里
              </div>
            </div>

            <div
              class="shrink-0 text-[11px] font-semibold"
              :class="darkForeground ? 'text-black/70' : 'text-white/85'"
            >
              {{ draft.foregroundStyle === 'light' ? '浅色字体' : '深色字体' }}
            </div>
          </div>
        </div>
      </template>

      <!-- 空态占位 -->
      <div v-else class="absolute inset-0 flex flex-col items-center justify-center text-white/20 pointer-events-none bg-[#262626]">
        <svg xmlns="http://www.w3.org/2000/svg" class="mb-2 h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span class="text-xs">未选择图片</span>
      </div>

      <!-- 视口虚线框 -->
      <div
        class="absolute inset-0 z-10 pointer-events-none border border-dashed border-white/50 rounded-[4px] transition-all duration-300"
        :class="{
          'shadow-[0_0_0_9999px_rgba(0,0,0,0.65)]': draft.imagePath
        }"
      ></div>

      <!-- 区域徽标 -->
      <div
        v-if="draft.imagePath"
        class="absolute right-2 top-2 z-20 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium tracking-wider text-white/40 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-0"
      >
        软件背景区域
      </div>
    </div>
  </div>
</template>
