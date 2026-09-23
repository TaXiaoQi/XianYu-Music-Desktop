<script setup lang="ts">
/**
 * 唱针组件（网易云播放页风格）：
 * - 臂杆为长直斜杆 + 末端短弧折向陡角，白色小圆头唱针在末端
 * - 播放：落针姿态；暂停：整臂绕枢轴向外摆起离开唱片
 * - 几何完全由下方 TONEARM_PARAMS 参数化（1 unit = 0.001 × 唱片边长），
 *   数值来自可视化调参面板实调结果（面板已移除，如需再调可临时恢复）。
 */
import { computed } from 'vue';

const props = defineProps<{
  isPlaying: boolean;
}>();

// 实调固化的几何参数（坐标系：viewBox 400×460，容器 40%×46%，1 unit = 0.001S）
const TONEARM_PARAMS = {
  pivotX: 0,
  pivotY: 39,
  elbowX: 283,
  elbowY: 273,
  tipX: 313,
  tipY: 450,
  bendIn: 10,
  bendOut: 14,
  strokeW: 35,
  headW: 15,
  headH: 16,
  headRotOffset: 0,
  downDeg: 0,
  upDeg: -46,
} as const;

const params = TONEARM_PARAMS;

// viewBox 固定 400×460 作为坐标系
const VIEW_W = 400;
const VIEW_H = 460;

const norm = (dx: number, dy: number) => {
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
};

const straightDir = norm(params.elbowX - params.pivotX, params.elbowY - params.pivotY);
const tipDir = norm(params.tipX - params.elbowX, params.tipY - params.elbowY);

const pathD = computed(() => {
  const c1x = params.elbowX + straightDir.x * params.bendIn;
  const c1y = params.elbowY + straightDir.y * params.bendIn;
  const c2x = params.tipX - tipDir.x * params.bendOut;
  const c2y = params.tipY - tipDir.y * params.bendOut;
  return `M ${params.pivotX} ${params.pivotY} L ${params.elbowX} ${params.elbowY} C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${params.tipX} ${params.tipY}`;
});

/** 与竖直方向的夹角（屏幕坐标向下为正） */
const angleFromVertical = (dir: { x: number; y: number }) =>
  Math.atan2(dir.x, dir.y) * 180 / Math.PI;

const headRotation = angleFromVertical(tipDir) + params.headRotOffset;

const pct = (value: number, total: number) => `${(value / total * 100).toFixed(2)}%`;

const pivotLeft = pct(params.pivotX, VIEW_W);
const pivotTop = pct(params.pivotY, VIEW_H);
const headLeft = pct(params.tipX, VIEW_W);
const headTop = pct(params.tipY, VIEW_H);

const transformOrigin = `${pivotLeft} ${pivotTop}`;
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-30 overflow-visible">
    <!-- 臂杆旋转容器：坐标系 1 unit = 0.001 × 唱片边长 -->
    <div
      class="tonearm-swing absolute"
      :style="{
        left: '50%',
        top: '-14%',
        width: '40%',
        height: '46%',
        transformOrigin,
        transform: `rotate(${isPlaying ? params.downDeg : params.upDeg}deg)`,
      }"
    >
      <!-- 枢轴圆钮 -->
      <div
        class="tonearm-pivot absolute rounded-full"
        :style="{ left: pivotLeft, top: pivotTop }"
      >
        <div class="tonearm-pivot-dot absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full" />
      </div>

      <!-- 臂杆：参数化路径 -->
      <svg class="absolute inset-0 h-full w-full overflow-visible" :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="tonearm-arm-gradient" gradientUnits="userSpaceOnUse" x1="30" y1="0" :x2="params.tipX + 16" :y2="params.tipY + 50">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="0.55" stop-color="#f2f3f5" />
            <stop offset="1" stop-color="#d4d7dc" />
          </linearGradient>
        </defs>
        <path
          :d="pathD"
          stroke="url(#tonearm-arm-gradient)"
          :stroke-width="params.strokeW"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>

      <!-- 唱针头：位于臂杆末端，沿末端切线方向 -->
      <div
        class="tonearm-head absolute"
        :style="{
          left: headLeft,
          top: headTop,
          width: `${params.headW}%`,
          height: `${params.headH}%`,
          transform: `translate(-50%, -50%) rotate(${headRotation}deg)`,
        }"
      >
        <div class="tonearm-head-tip absolute rounded-full" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.tonearm-pivot {
  width: 15%;
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle at 35% 30%, #ffffff 0%, #f0f1f4 55%, #cfd2d8 100%);
  box-shadow:
    0 3px 10px rgba(0, 0, 0, 0.45),
    inset 0 -1px 2px rgba(0, 0, 0, 0.1);
  z-index: 1;
}

.tonearm-pivot-dot {
  width: 30%;
  height: 30%;
  background: radial-gradient(circle at 40% 35%, #8a8a92 0%, #55555d 60%, #33333a 100%);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5);
}

.tonearm-head {
  border-radius: 999px;
  background: linear-gradient(100deg, #ffffff 0%, #eef0f3 55%, #d0d3d9 100%);
  box-shadow:
    2px 4px 9px rgba(0, 0, 0, 0.35),
    inset 0 1px 1px rgba(255, 255, 255, 0.85);
}

.tonearm-head-tip {
  right: 16%;
  bottom: 12%;
  width: 30%;
  height: 26%;
  background: radial-gradient(circle at 40% 35%, #8a8a92 0%, #55555d 60%, #33333a 100%);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.55);
}
</style>
