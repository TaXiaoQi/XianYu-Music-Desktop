<script setup lang="ts">
/**
 * 唱针组件（网易云播放页风格）：
 * - 臂杆为长直斜杆 + 末端短弧折向陡角，白色小圆头唱针在末端
 * - 播放：落针姿态；暂停：整臂绕枢轴向外摆起离开唱片
 * - 几何完全由下方 TONEARM_PARAMS 参数化（1 unit = 0.001 × 唱片边长），
 *   数值来自可视化调参面板实调结果（面板已移除，如需再调可临时恢复）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  isPlaying: boolean;
  /** 当前歌曲标识：变化时播放一次抬针→落针动画（切歌动作） */
  songKey?: string;
}>(), {
  songKey: '',
});

/** 切歌动作中的抬针状态 */
const isLifting = ref(false);
let liftTimer: ReturnType<typeof setTimeout> | null = null;

watch(() => props.songKey, (next, prev) => {
  // 首次挂载不算切歌
  if (!prev || next === prev) return;

  isLifting.value = true;
  if (liftTimer) clearTimeout(liftTimer);
  liftTimer = setTimeout(() => {
    isLifting.value = false;
    liftTimer = null;
  }, 760);
});

onBeforeUnmount(() => {
  if (liftTimer) {
    clearTimeout(liftTimer);
    liftTimer = null;
  }
});

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

/** 抬针 = 暂停态或切歌动作中 */
const rotationDeg = computed(() => (
  isLifting.value || !props.isPlaying ? params.upDeg : params.downDeg
));
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
        transform: `rotate(${rotationDeg}deg)`,
      }"
    >
      <!-- 枢轴圆钮（多层金属 + 高光点） -->
      <div
        class="tonearm-pivot absolute rounded-full"
        :style="{ left: pivotLeft, top: pivotTop }"
      >
        <div class="tonearm-pivot-ring absolute inset-[8%] rounded-full" />
        <div class="tonearm-pivot-dot absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full" />
        <div class="tonearm-pivot-specular absolute left-[22%] top-[16%] h-[22%] w-[30%] -rotate-[30deg] rounded-full bg-white/85 blur-[1px]" />
      </div>

      <!-- 臂杆：参数化路径（暗轮廓 + 金属渐变 + 高光芯线 + 投影，营造圆柱金属质感） -->
      <svg class="absolute inset-0 h-full w-full overflow-visible" :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="tonearm-arm-gradient" gradientUnits="userSpaceOnUse" x1="30" y1="0" :x2="params.tipX + 16" :y2="params.tipY + 50">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="0.35" stop-color="#f4f5f8" />
            <stop offset="0.62" stop-color="#d9dce2" />
            <stop offset="0.85" stop-color="#aeb3bd" />
            <stop offset="1" stop-color="#c8ccd4" />
          </linearGradient>
          <filter id="tonearm-shadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="5" dy="10" stdDeviation="7" flood-color="#000000" flood-opacity="0.45" />
          </filter>
        </defs>
        <g filter="url(#tonearm-shadow)">
          <!-- 底层暗轮廓（管壁背光侧） -->
          <path
            :d="pathD"
            stroke="rgba(20, 22, 30, 0.55)"
            :stroke-width="params.strokeW + 7"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <!-- 金属主体 -->
          <path
            :d="pathD"
            stroke="url(#tonearm-arm-gradient)"
            :stroke-width="params.strokeW"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <!-- 高光芯线（圆柱受光的高反射带） -->
          <path
            :d="pathD"
            stroke="rgba(255, 255, 255, 0.75)"
            :stroke-width="params.strokeW * 0.28"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <!-- 细亮缘（管壁顶部反光） -->
          <path
            :d="pathD"
            stroke="rgba(255, 255, 255, 0.9)"
            :stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            transform="translate(-2 -3)"
            opacity="0.65"
          />
        </g>
      </svg>

      <!-- 唱针头：位于臂杆末端，沿末端切线方向（多层渐变 + 斜向光泽） -->
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
        <div class="tonearm-head-sheen absolute inset-[12%] rounded-[inherit]" />
        <div class="tonearm-head-tip absolute rounded-full" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.tonearm-swing {
  /* 落针/抬臂绕枢轴旋转的过渡动画（内联 transform 变化时生效） */
  transition: transform 1.1s cubic-bezier(0.34, 1.3, 0.64, 1);
  will-change: transform;
}
.tonearm-pivot {
  width: 15%;
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  background:
    radial-gradient(circle at 32% 26%, #ffffff 0%, #f2f3f6 40%, #d5d8de 68%, #a9adb7 100%);
  box-shadow:
    0 5px 14px rgba(0, 0, 0, 0.5),
    0 1px 3px rgba(0, 0, 0, 0.4),
    inset 0 -2px 4px rgba(0, 0, 0, 0.18),
    inset 0 2px 3px rgba(255, 255, 255, 0.9);
  z-index: 1;
}

/* 内圈金属环（分层车削质感） */
.tonearm-pivot-ring {
  background:
    radial-gradient(circle at 38% 32%, rgba(255, 255, 255, 0.9) 0%, rgba(235, 237, 241, 0.6) 45%, rgba(150, 154, 163, 0.55) 100%);
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.8),
    inset 0 -1px 2px rgba(0, 0, 0, 0.25);
}

.tonearm-pivot-dot {
  width: 30%;
  height: 30%;
  background: radial-gradient(circle at 38% 32%, #9a9aa2 0%, #5b5b64 55%, #2c2c33 100%);
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.6),
    0 0 3px rgba(0, 0, 0, 0.3);
}

.tonearm-head {
  border-radius: 999px;
  background: linear-gradient(100deg, #ffffff 0%, #f0f2f5 40%, #d3d6dd 72%, #b4b8c2 100%);
  box-shadow:
    3px 6px 14px rgba(0, 0, 0, 0.45),
    inset 0 1px 1px rgba(255, 255, 255, 0.95),
    inset 0 -2px 3px rgba(0, 0, 0, 0.15);
}

/* 针头斜向光泽扫过 */
.tonearm-head-sheen {
  background: linear-gradient(
    115deg,
    rgba(255, 255, 255, 0.95) 0%,
    rgba(255, 255, 255, 0.25) 38%,
    transparent 55%,
    rgba(0, 0, 0, 0.12) 85%
  );
  mix-blend-mode: screen;
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
