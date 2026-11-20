<script setup lang="ts">
// AMLL 封面 genie 式形变绘制层：过渡窗口内覆盖在 .art-frame 上，
// 逐行 drawImage 切片实现曲线收缩/展开；首帧就绪 emit ready（父层才隐藏原生
// img 防双绘），任何前置条件不满足（无尺寸/加载失败/画布被污染）emit ready+done
// 回退为现有 CSS morph。
import { onBeforeUnmount, onMounted, ref } from 'vue';
import {
  GENIE_DURATION_MS,
  computeGenieSlices,
  genieEase,
  genieSliceCount,
} from './coverGenie';

const props = defineProps<{
  src: string;
  direction: 'enter' | 'exit';
}>();

const emit = defineEmits<{
  (e: 'ready'): void;
  (e: 'done'): void;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);

// 模块级图片缓存：同一封面反复进出不重复解码
const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  let pending = imageCache.get(src);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('genie cover load failed'));
      img.src = src;
    });
    imageCache.set(src, pending);
  }
  return pending;
}

let rafId = 0;
let disposed = false;
let firstFrameDone = false;

function failOpen() {
  if (firstFrameDone) return;
  firstFrameDone = true;
  emit('ready');
  emit('done');
}

function drawFrame(
  t: number,
  img: HTMLImageElement,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height);
  const slices = genieSliceCount(height);
  const rows = computeGenieSlices(t, slices);
  const srcRow = img.naturalHeight / rows.length;
  for (let i = 0; i < rows.length; i += 1) {
    const slice = rows[i];
    ctx.drawImage(
      img,
      0,
      i * srcRow,
      img.naturalWidth,
      srcRow,
      slice.dstX * width,
      slice.dstY * height,
      slice.dstW * width,
      Math.max(slice.dstH * height, 1),
    );
  }
}

function start() {
  const canvas = canvasRef.value;
  const host = canvas?.parentElement;
  if (!canvas || !host || disposed) {
    failOpen();
    return;
  }
  const boxWidth = host.clientWidth;
  const boxHeight = host.clientHeight;
  if (boxWidth <= 0 || boxHeight <= 0) {
    failOpen();
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(boxWidth * dpr);
  canvas.height = Math.round(boxHeight * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    failOpen();
    return;
  }
  loadImage(props.src)
    .then((img) => {
      if (disposed) return;
      const startedAt = performance.now();
      const step = () => {
        if (disposed) return;
        if (document.hidden) {
          rafId = requestAnimationFrame(step);
          return;
        }
        const raw = Math.min(1, (performance.now() - startedAt) / GENIE_DURATION_MS);
        const eased = genieEase(raw);
        const t = props.direction === 'exit' ? eased : 1 - eased;
        try {
          drawFrame(t, img, ctx, canvas.width, canvas.height);
        } catch {
          // 画布被跨源封面污染等异常：回退普通 morph
          failOpen();
          return;
        }
        if (!firstFrameDone) {
          firstFrameDone = true;
          emit('ready');
        }
        if (raw >= 1) {
          emit('done');
          return;
        }
        rafId = requestAnimationFrame(step);
      };
      rafId = requestAnimationFrame(step);
    })
    .catch(() => failOpen());
}

onMounted(start);

onBeforeUnmount(() => {
  disposed = true;
  if (rafId) cancelAnimationFrame(rafId);
});
</script>

<template>
  <canvas ref="canvasRef" class="genie-canvas" aria-hidden="true"></canvas>
</template>

<style scoped>
.genie-canvas {
  position: absolute;
  inset: 0;
  z-index: 2;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
