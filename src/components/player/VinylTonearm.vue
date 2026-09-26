<script setup lang="ts">
/**
 * 唱臂总成（俯视写实布局）。
 *
 * 真机形态：枢轴在转盘右上方，臂管向左下方伸出，唱头落在转盘右侧的金属盘面上
 * （封面盘只占盘心 0.5 直径，落针区在封面与盘缘之间）；暂停时唱臂摆出转盘、
 * 停靠在臂托上；切歌时小幅抬针后快速回落。
 *
 * 坐标系固定 1000×1000（= 容器边长，1 unit = 0.1% 边长），与 PlayerDetailVinyl 的
 * 转盘布局共用同一比例：转盘圆心 (500, 500)、转盘半径 450、封面盘半径 225。
 * 几何按参考机型比例推得：枢轴到圆心 504（1.12 × 半径 —— 枢轴落在盘缘之外，轴承圆钮
 * 不压在盘面上；轴承半径 38，内缘到圆心 466，离盘缘还有 16）、有效臂长 716（1.59 ×
 * 半径）。基准姿态落针在半径 387（0.86R，封面外的金属环上），相对「枢轴→圆心」连线偏
 * -31.3°（负号 = 沿屏幕顺时针的反向，即臂管朝下方垂落）；暂停时再偏 -9.9°、落针到半径
 * 472（1.05R）让开转盘 —— 参考机型没有臂托立柱，抬臂就是悬停在盘外。
 * 唱臂最短触及 211 略小于封面半径 225（真机的内圈极限也在标签附近），但落针/抬臂只在
 * 0.93R~1.05R 间活动，碰不到封面。
 * 唱头壳相对臂管轴向偏置 42°（真机 offset angle）—— 弯得明显一些，但靠「臂管末端切线 =
 * 唱头壳轴向」保持平滑，接缝处没有折角。折点 = 唱针沿唱头壳轴向往回一个壳长。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  isPlaying: boolean;
  /** 当前歌曲标识：变化时播放一次抬针→落针动画（切歌动作） */
  songKey?: string;
}>(), {
  songKey: '',
});

/**
 * 切歌动作：小幅抬针 + 快速回落。
 * 不能摆到暂停位 —— 那要 1s 以上的过渡，而切歌时播放已经开始、唱针还在归位途中。
 */
const SWITCH_LIFT_MS = 240;
const SWITCH_SETTLE_MS = 620;

/** 切歌抬针中 */
const isLifting = ref(false);
/** 整个切歌动作期间为真（含回落段），用于临时换成更短的过渡 */
const isSwitching = ref(false);
let liftTimer: ReturnType<typeof setTimeout> | null = null;
let switchTimer: ReturnType<typeof setTimeout> | null = null;

function clearSwitchTimers() {
  if (liftTimer) {
    clearTimeout(liftTimer);
    liftTimer = null;
  }
  if (switchTimer) {
    clearTimeout(switchTimer);
    switchTimer = null;
  }
}

watch(() => props.songKey, (next, prev) => {
  // 首次挂载不算切歌
  if (!prev || next === prev) return;

  clearSwitchTimers();
  isSwitching.value = true;
  isLifting.value = true;
  liftTimer = setTimeout(() => {
    isLifting.value = false;
    liftTimer = null;
  }, SWITCH_LIFT_MS);
  switchTimer = setTimeout(() => {
    isSwitching.value = false;
    switchTimer = null;
  }, SWITCH_SETTLE_MS);
});

onBeforeUnmount(clearSwitchTimers);

/** 几何参数（坐标系 1000×1000，与 PlayerDetailVinyl 的转盘布局对齐） */
const TONEARM_PARAMS = {
  pivotX: 876,
  pivotY: 164,
  /** 有效臂长：枢轴 → 唱针的直线距离（不是画出来的臂管长度） */
  armLength: 716,
  platterCenterX: 500,
  platterCenterY: 500,
  /** 基准姿态相对「枢轴→圆心」连线的偏角（负 = 朝屏幕下方垂落，落针在 0.86R） */
  baseOffsetDeg: -31.3,
  /** 抬臂（暂停）：向盘外摆出，落针到 1.05R 让开转盘（半径 450） */
  upOffsetDeg: -9.9,
  /** 切歌：小幅抬针（落针移到 ~0.91R） */
  switchOffsetDeg: -2.6,
  /** 臂管直径（细金属管） */
  tubeWidth: 13,
  /** 唱头壳长度（含末端唱头；按参考机型量得约 0.21 × 臂长） */
  headshellLength: 150,
  /** 唱头壳相对臂管轴向的偏置角（真机 offset angle）—— 臂管的折点由它和壳长决定；
   *  值越大弯得越明显（42° 是肉眼可见的弯，末端仍与唱头壳相切） */
  headshellOffsetDeg: 42,
  /** 唱头壳管径 */
  headshellWidth: 26,
  /** 配重长度 / 直径 */
  counterweightLength: 96,
  counterweightWidth: 46,
  /** 配重距枢轴中心的距离 */
  counterweightGap: 46,
} as const;

const params = TONEARM_PARAMS;
const VIEW = 1000;

const toPct = (value: number) => `${(value / VIEW * 100).toFixed(2)}%`;

const rotateVec = (v: { x: number; y: number }, deg: number) => {
  const rad = deg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
};

/** 枢轴 → 唱片圆心 的单位方向；抬臂偏角以此为基准 */
const centerDir = (() => {
  const dx = params.platterCenterX - params.pivotX;
  const dy = params.platterCenterY - params.pivotY;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
})();

const dirAt = (offsetDeg: number) => rotateVec(centerDir, params.baseOffsetDeg + offsetDeg);

/** 某个抬臂偏角下的唱针位置 */
const stylusAt = (offsetDeg: number) => {
  const dir = dirAt(offsetDeg);
  return {
    x: params.pivotX + dir.x * params.armLength,
    y: params.pivotY + dir.y * params.armLength,
  };
};

/** 基准（落针）姿态：唱针落在转盘右侧的金属环上 */
const stylus = stylusAt(0);
const baseDir = dirAt(0);
/** 唱头壳轴向 = 臂管轴向再偏置一个角度（真机 offset angle），折点由此产生 */
const headshellDeg = Math.atan2(baseDir.y, baseDir.x) * 180 / Math.PI + params.headshellOffsetDeg;
const headshellDir = {
  x: Math.cos(headshellDeg * Math.PI / 180),
  y: Math.sin(headshellDeg * Math.PI / 180),
};
/** 折点：从唱针沿唱头壳轴向往回量一个壳长，臂管画到这里为止 */
const headshellStart = {
  x: stylus.x - headshellDir.x * params.headshellLength,
  y: stylus.y - headshellDir.y * params.headshellLength,
};

/**
 * 臂管：枢轴 → 折点，用一段平滑曲线连接。
 * 起点切线沿「枢轴 → 折点」，终点切线取唱头壳轴向 —— 与唱头壳切线连续，
 * 接缝处因此没有折角，整根杆看起来是一路平滑弯下去的（弯势落在金属杆上段）。
 */
const tubePathD = (() => {
  const dx = headshellStart.x - params.pivotX;
  const dy = headshellStart.y - params.pivotY;
  const len = Math.hypot(dx, dy) || 1;
  const cx1 = params.pivotX + dx * 0.28;
  const cy1 = params.pivotY + dy * 0.28;
  // 尾部直线段占比：越小，弯势越集中在金属杆上、越显眼（末端仍与唱头壳相切）
  const tail = len * 0.26;
  const cx2 = headshellStart.x - headshellDir.x * tail;
  const cy2 = headshellStart.y - headshellDir.y * tail;
  return `M ${params.pivotX} ${params.pivotY} C ${cx1.toFixed(1)} ${cy1.toFixed(1)} ${cx2.toFixed(1)} ${cy2.toFixed(1)} ${headshellStart.x.toFixed(1)} ${headshellStart.y.toFixed(1)}`;
})();

/** 配重：枢轴后方，沿臂管起始方向的反向（臂管是曲线，取起点切线，才与杆身同轴） */
const counterweight = (() => {
  const dx = headshellStart.x - params.pivotX;
  const dy = headshellStart.y - params.pivotY;
  const len = Math.hypot(dx, dy) || 1;
  const dir = { x: dx / len, y: dy / len };
  const offset = params.counterweightGap + params.counterweightLength / 2;
  return {
    x: params.pivotX - dir.x * offset,
    y: params.pivotY - dir.y * offset,
    deg: Math.atan2(-dir.y, -dir.x) * 180 / Math.PI,
  };
})();

/** 唱臂姿态：暂停摆到盘外，切歌小幅抬针，播放落针 */
const rotationDeg = computed(() => {
  if (!props.isPlaying) return params.upOffsetDeg;
  if (isLifting.value) return params.switchOffsetDeg;
  return 0;
});

/** 抬臂时影子离唱片更远、更虚（离面高度的视觉线索） */
const shadow = computed(() => {
  const lifted = !props.isPlaying || isLifting.value;
  return lifted
    ? { dx: 9, dy: 16, blur: 10, opacity: 0.34 }
    : { dx: 5, dy: 8, blur: 5, opacity: 0.5 };
});

const transformOrigin = `${toPct(params.pivotX)} ${toPct(params.pivotY)}`;

const bearingStyle = {
  left: toPct(params.pivotX),
  top: toPct(params.pivotY),
};
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-30 overflow-visible">
    <!-- 唱臂总成（绕枢轴旋转） -->
    <div
      class="tonearm-swing absolute inset-0"
      :style="{
        transformOrigin,
        transform: `rotate(${rotationDeg}deg)`,
        transition: isSwitching
          ? 'transform 0.26s cubic-bezier(0.22, 1, 0.36, 1)'
          : undefined,
      }"
    >
      <svg
        class="absolute inset-0 h-full w-full overflow-visible"
        :viewBox="`0 0 ${VIEW} ${VIEW}`"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id="tonearm-tube-gradient"
            gradientUnits="userSpaceOnUse"
            :x1="params.pivotX - 40"
            :y1="params.pivotY - 40"
            :x2="stylus.x"
            :y2="stylus.y + 30"
          >
            <stop offset="0" stop-color="#eef0f4" />
            <stop offset="0.4" stop-color="#c9ccd4" />
            <stop offset="0.72" stop-color="#9aa0aa" />
            <stop offset="1" stop-color="#b6bac3" />
          </linearGradient>
          <linearGradient
            id="tonearm-counterweight-gradient"
            gradientUnits="userSpaceOnUse"
            :x1="counterweight.x - 30"
            :y1="counterweight.y - 30"
            :x2="counterweight.x + 30"
            :y2="counterweight.y + 30"
          >
            <stop offset="0" stop-color="#f5f7fa" />
            <stop offset="0.42" stop-color="#d2d6dd" />
            <stop offset="1" stop-color="#8f959e" />
          </linearGradient>
          <linearGradient
            id="tonearm-headshell-gradient"
            gradientUnits="userSpaceOnUse"
            :x1="headshellStart.x"
            :y1="headshellStart.y - 16"
            :x2="stylus.x"
            :y2="stylus.y + 16"
          >
            <stop offset="0" stop-color="#f8f9fb" />
            <stop offset="0.5" stop-color="#e2e5ea" />
            <stop offset="1" stop-color="#bfc4cc" />
          </linearGradient>
          <filter id="tonearm-shadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow
              :dx="shadow.dx"
              :dy="shadow.dy"
              :stdDeviation="shadow.blur"
              flood-color="#000000"
              :flood-opacity="shadow.opacity"
            />
          </filter>
        </defs>

        <g filter="url(#tonearm-shadow)">
          <!-- 配重：枢轴后方，哑光金属圆柱 + 顶面背光 -->
          <g :transform="`translate(${counterweight.x.toFixed(1)} ${counterweight.y.toFixed(1)}) rotate(${counterweight.deg.toFixed(2)})`">
            <rect
              :x="(-params.counterweightLength / 2).toFixed(1)"
              :y="(-params.counterweightWidth / 2).toFixed(1)"
              :width="params.counterweightLength"
              :height="params.counterweightWidth"
              rx="7"
              fill="url(#tonearm-counterweight-gradient)"
            />
            <rect
              :x="(-params.counterweightLength / 2).toFixed(1)"
              :y="(params.counterweightWidth / 2 - 9).toFixed(1)"
              :width="params.counterweightLength"
              height="9"
              rx="4.5"
              fill="rgba(0, 0, 0, 0.4)"
            />
            <rect
              :x="(-params.counterweightLength / 2 + 6).toFixed(1)"
              :y="(-params.counterweightWidth / 2 + 2).toFixed(1)"
              :width="(params.counterweightLength - 12)"
              height="3"
              rx="1.5"
              fill="rgba(255, 255, 255, 0.16)"
            />
          </g>

          <!-- 臂管：暗轮廓 + 金属主色 + 高光芯线 -->
          <path
            :d="tubePathD"
            stroke="rgba(14, 16, 22, 0.72)"
            :stroke-width="params.tubeWidth + 4"
            stroke-linecap="round"
          />
          <path
            :d="tubePathD"
            stroke="url(#tonearm-tube-gradient)"
            :stroke-width="params.tubeWidth"
            stroke-linecap="round"
          />
          <path
            :d="tubePathD"
            stroke="rgba(255, 255, 255, 0.8)"
            :stroke-width="params.tubeWidth * 0.3"
            stroke-linecap="round"
          />

          <!-- 唱头壳 + 唱头 + 针尖 -->
          <g :transform="`translate(${stylus.x.toFixed(1)} ${stylus.y.toFixed(1)}) rotate(${headshellDeg.toFixed(2)})`">
            <rect
              :x="(-params.headshellLength).toFixed(1)"
              :y="(-params.headshellWidth / 2).toFixed(1)"
              :width="params.headshellLength"
              :height="params.headshellWidth"
              :rx="(params.headshellWidth / 5).toFixed(1)"
              fill="url(#tonearm-headshell-gradient)"
            />
            <rect
              :x="(-params.headshellLength + 5).toFixed(1)"
              :y="(-params.headshellWidth / 2 + 2).toFixed(1)"
              :width="params.headshellLength - 10"
              height="4.5"
              rx="2.2"
              fill="rgba(255, 255, 255, 0.62)"
            />
            <!-- 唱头块 -->
            <rect x="-26" y="-7.5" width="30" height="15" rx="2.5" fill="#1b1c21" />
            <rect x="-26" y="-7.5" width="30" height="3.5" rx="1.7" fill="rgba(255, 255, 255, 0.1)" />
            <!-- 针尖（俯视只见前端一点点） -->
            <path d="M 4 -2.6 L 10 0 L 4 2.6 Z" fill="#e9ebef" />
            <circle cx="9.4" cy="0" r="1.5" fill="#f7f8fa" />
          </g>
        </g>
      </svg>
    </div>

    <!-- 枢轴轴承：静态，盖住旋转中心（臂在它内部转动） -->
    <div class="tonearm-bearing absolute rounded-full" :style="bearingStyle">
      <div class="tonearm-bearing-ring absolute inset-[12%] rounded-full" />
      <div class="tonearm-bearing-cap absolute inset-[26%] rounded-full" />
      <div class="tonearm-bearing-specular absolute rounded-full" />
    </div>
  </div>
</template>

<style scoped>
.tonearm-swing {
  /* 落针 / 抬臂绕枢轴旋转的过渡（切歌时由内联样式临时缩短） */
  transition: transform 1.1s cubic-bezier(0.34, 1.3, 0.64, 1);
  will-change: transform;
}

/* 枢轴轴承：拉丝铝圆柱，左上受光 */
.tonearm-bearing {
  width: 7.6%;
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  background:
    radial-gradient(circle at 34% 26%, #ffffff 0%, #e3e6ec 34%, #b3b8c1 66%, #7d828b 100%);
  box-shadow:
    0 6px 16px rgba(0, 0, 0, 0.6),
    0 1px 3px rgba(0, 0, 0, 0.5),
    inset 0 -2px 4px rgba(0, 0, 0, 0.22),
    inset 0 2px 3px rgba(255, 255, 255, 0.9);
}

/* 轴承内圈（车削台阶） */
.tonearm-bearing-ring {
  background:
    radial-gradient(circle at 38% 30%, rgba(255, 255, 255, 0.95) 0%, rgba(226, 229, 235, 0.6) 46%, rgba(140, 145, 154, 0.6) 100%);
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.85),
    inset 0 -1px 2px rgba(0, 0, 0, 0.3);
}

/* 中心轴帽 */
.tonearm-bearing-cap {
  background: radial-gradient(circle at 38% 32%, #9ea3ac 0%, #62666e 52%, #33363c 100%);
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.6),
    0 0 4px rgba(0, 0, 0, 0.35);
}

/* 高光点 */
.tonearm-bearing-specular {
  left: 24%;
  top: 16%;
  width: 26%;
  height: 20%;
  transform: rotate(-32deg);
  background: rgba(255, 255, 255, 0.9);
  filter: blur(1px);
}
</style>
