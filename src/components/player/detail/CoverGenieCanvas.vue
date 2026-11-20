<script setup lang="ts">
// AMLL genie 屏幕空间形变层（C7）：Teleport 到 body 的视口固定画布。
// 静置窗内容器被冻结（cover-stage--genie-frozen），本层以屏幕坐标逐行切片，
// 把封面从展开 rect 漏斗式吸进 dock rect（或反向展开），飞行完全由此层提供。
// 前置条件不满足（无起点/终点矩形、无 ctx、加载失败、绘制异常）一律 finish
// 立即回退普通 morph。
import { onBeforeUnmount, onMounted, ref } from 'vue';
import {
  GENIE_DURATION_MS,
  computeGenieRectSlices,
  genieEase,
  genieRectAt,
  genieSliceCount,
  genieSourceCrop,
  type GenieRect,
} from './coverGenie';

const props = defineProps<{
  src: string;
  direction: 'enter' | 'exit';
  /** 翻转前预拾的起点矩形（视口坐标）；缺失则不启用 genie */
  fromRect: GenieRect | null;
  /** 终点元素取值器：冻结后的最终几何即目标 rect */
  toEl: () => HTMLElement | null;
}>();

const emit = defineEmits<{ (e: 'done'): void }>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const visible = ref(true);

let rafId = 0;
let running = false;
let finished = false;

function finish() {
  if (finished) return;
  finished = true;
  running = false;
  visible.value = false;
  emit('done');
}

function roundClipPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(Math.max(r, 0), w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function start() {
  const canvas = canvasRef.value;
  const from = props.fromRect;
  const el = props.toEl();
  if (!canvas || !from || !el) {
    finish();
    return;
  }
  const box = el.getBoundingClientRect();
  const to: GenieRect = { x: box.x, y: box.y, w: box.width, h: box.height };
  if (from.w <= 0 || from.h <= 0 || to.w <= 0 || to.h <= 0) {
    finish();
    return;
  }
  const radiusRaw = Number.parseFloat(getComputedStyle(el).borderRadius || '0');
  const radius = Number.isFinite(radiusRaw) && radiusRaw > 0 ? radiusRaw : 14;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    finish();
    return;
  }
  const slices = genieSliceCount(Math.max(from.h, to.h) * dpr);
  const image = new Image();
  image.referrerPolicy = 'no-referrer';
  image.decoding = 'async';

  const draw = (t: number) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const outer = genieRectAt(t, from, to);
    ctx.save();
    roundClipPath(ctx, outer.x, outer.y, outer.w, outer.h, radius);
    ctx.clip();
    const crop = genieSourceCrop(
      image.naturalWidth,
      image.naturalHeight,
      outer.w,
      outer.h,
    );
    const rows = computeGenieRectSlices(t, slices, from, to);
    const srcX = crop.sx * image.naturalWidth;
    const srcW = Math.max(crop.sw * image.naturalWidth, 1);
    const rowSrcH = Math.max((crop.sh / rows.length) * image.naturalHeight, 1);
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      ctx.drawImage(
        image,
        srcX,
        (crop.sy + (i / rows.length) * crop.sh) * image.naturalHeight,
        srcW,
        rowSrcH,
        row.x,
        row.y,
        row.w,
        row.h + 0.6,
      );
    }
    ctx.restore();
  };

  image.onload = () => {
    if (!running) return;
    const startedAt = performance.now();
    const step = () => {
      if (!running) return;
      if (!document.hidden) {
        const raw = Math.min(1, (performance.now() - startedAt) / GENIE_DURATION_MS);
        const eased = genieEase(raw);
        const t = props.direction === 'exit' ? eased : 1 - eased;
        try {
          draw(t);
        } catch {
          finish();
          return;
        }
        if (raw >= 1) {
          finish();
          return;
        }
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  };
  image.onerror = () => finish();
  running = true;
  image.src = props.src;
}

onMounted(start);

onBeforeUnmount(() => {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
});
</script>

<template>
  <Teleport to="body">
    <canvas
      v-show="visible"
      ref="canvasRef"
      class="genie-canvas"
      aria-hidden="true"
    ></canvas>
  </Teleport>
</template>

<style scoped>
.genie-canvas {
  position: fixed;
  inset: 0;
  z-index: 88;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
}
</style>
