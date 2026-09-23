<script setup lang="ts">
/**
 * 黑胶唱片核心视觉组件。
 * UI 移植自 mozarta-nexus/music-web-player（src/components/VinylRecord.tsx，MIT），
 * 由 React 内联 style 等价重写为 Vue scoped CSS：
 * - 同心圆沟槽（repeating-radial-gradient 双层）
 * - vinyl-sheen 反光（conic-gradient，随唱片旋转）
 * - 中心 38% 专辑封面 + 中心孔
 * - 顶部固定不旋转的高光层
 * - rAF 驱动旋转：播放 60°/s，暂停缓慢减速停住并保留角度
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  cover: string;
  isPlaying: boolean;
  /** 主题色（取当前歌曲主色） */
  accent?: string;
}>(), {
  accent: '#EC4141',
});

const recordRef = ref<HTMLDivElement | null>(null);
const speedRef = ref(0);
const angleRef = ref(0);
let rafId = 0;
let lastTime = 0;

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const tick = (time: number) => {
  const last = lastTime || time;
  const dt = (time - last) / 1000;
  lastTime = time;

  // 播放目标 60°/s；暂停缓慢减速（与参考实现相同的插值系数）
  if (props.isPlaying) {
    speedRef.value += (60 - speedRef.value) * Math.min(dt * 2, 1);
  } else {
    speedRef.value *= Math.max(0, 1 - dt * 1.2);
  }

  angleRef.value = (angleRef.value + speedRef.value * dt) % 360;
  if (recordRef.value) {
    recordRef.value.style.transform = `rotate(${angleRef.value.toFixed(3)}deg)`;
  }
  rafId = requestAnimationFrame(tick);
};

onMounted(() => {
  if (prefersReducedMotion()) return;
  rafId = requestAnimationFrame(tick);
});

// 播放态变化时重置时间基准，避免暂停期间累积的 dt 造成角度跳变
watch(() => props.isPlaying, () => {
  lastTime = 0;
});

onBeforeUnmount(() => {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  lastTime = 0;
});
</script>

<template>
  <div class="vinyl-root relative aspect-square w-full select-none">
    <!-- 外圈主题色光晕（不旋转） -->
    <div
      class="absolute inset-0 rounded-full blur-2xl"
      :style="{ background: `radial-gradient(circle, ${props.accent}33 0%, transparent 70%)` }"
    />

    <!-- 唱片本体（旋转层） -->
    <div ref="recordRef" class="vinyl-body absolute inset-0 rounded-full">
      <!-- 沟槽反光层 -->
      <div class="vinyl-sheen absolute inset-0 rounded-full" />
      <!-- 第二层细密沟槽 -->
      <div class="vinyl-grooves absolute inset-0 rounded-full" />
      <!-- 第三层宽距深沟（增强沟槽立体感） -->
      <div class="vinyl-grooves-deep absolute inset-0 rounded-full" />

      <!-- 中心标签（专辑封面） -->
      <div class="vinyl-label absolute left-1/2 top-1/2 overflow-hidden rounded-full">
        <img
          v-if="props.cover"
          :key="props.cover"
          :src="props.cover"
          alt="album cover"
          class="h-full w-full object-cover"
          draggable="false"
          decoding="async"
          referrerpolicy="no-referrer"
        >
        <div v-else class="flex h-full w-full items-center justify-center" :style="{ background: `radial-gradient(circle, ${props.accent}, #1a0b2e)` }">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-1/3 w-1/3 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        </div>
        <!-- 封面光泽 -->
        <div class="vinyl-label-sheen absolute inset-0 rounded-full" />
        <!-- 标签外圈压痕（环境光遮蔽） -->
        <div class="vinyl-label-ao absolute inset-0 rounded-full" />
      </div>

      <!-- 中心孔 -->
      <div class="vinyl-spindle absolute left-1/2 top-1/2 rounded-full" />
    </div>

    <!-- 固定光源各向异性反光（不随唱片旋转，沟槽转动时产生真实流动光泽） -->
    <div class="vinyl-light-sweep pointer-events-none absolute inset-0 rounded-full" />
    <!-- 边缘轮辉（rim light）：外圈细亮环 + 主题色环境反射 -->
    <div class="vinyl-rim-light pointer-events-none absolute inset-0 rounded-full" />
    <!-- 环境色反射（左上冷调 / 右下暖调） -->
    <div class="vinyl-ambient pointer-events-none absolute inset-0 rounded-full" />

    <!-- 顶部高光（固定不旋转） -->
    <div class="vinyl-top-highlight pointer-events-none absolute inset-0 rounded-full" />
  </div>
</template>

<style scoped>
.vinyl-root {
  will-change: transform;
}

.vinyl-body {
  transform: rotate(0deg);
  will-change: transform;
  background:
    radial-gradient(circle at 50% 50%,
      #1a1a1f 0%,
      #0d0d10 28%,
      #161618 30%,
      #0a0a0c 32%,
      #141416 100%
    ),
    repeating-radial-gradient(circle at 50% 50%,
      transparent 0px,
      transparent 2px,
      rgba(255, 255, 255, 0.018) 2.5px,
      transparent 3px
    );
  box-shadow:
    inset 0 0 40px rgba(0, 0, 0, 0.9),
    inset 0 0 120px rgba(255, 255, 255, 0.03),
    0 20px 60px rgba(0, 0, 0, 0.8),
    0 0 80px v-bind('props.accent + "22"');
}

.vinyl-sheen {
  background: conic-gradient(
    from 0deg,
    transparent 0deg,
    rgba(255, 255, 255, 0.04) 30deg,
    transparent 60deg,
    transparent 180deg,
    rgba(255, 255, 255, 0.06) 210deg,
    transparent 240deg,
    transparent 360deg
  );
  mix-blend-mode: screen;
}

.vinyl-grooves {
  background: repeating-radial-gradient(circle at 50% 50%,
    transparent 0px,
    transparent 4px,
    rgba(0, 0, 0, 0.25) 4.5px,
    transparent 5px
  );
}

/* 第三层宽距深沟：偶发粗沟槽，增强盘面立体层次 */
.vinyl-grooves-deep {
  background: repeating-radial-gradient(circle at 50% 50%,
    transparent 0px,
    transparent 22px,
    rgba(0, 0, 0, 0.32) 23px,
    rgba(255, 255, 255, 0.03) 23.6px,
    transparent 24.5px
  );
}

.vinyl-label {
  width: 52%;
  height: 52%;
  transform: translate(-50%, -50%);
  box-shadow:
    0 0 0 2px rgba(0, 0, 0, 0.6),
    0 0 0 4px v-bind('props.accent + "55"'),
    0 0 30px v-bind('props.accent + "66"'),
    inset 0 0 20px rgba(0, 0, 0, 0.4);
}

/* 标签外圈压痕：内圈环境光遮蔽 + 顶部受光 */
.vinyl-label-ao {
  box-shadow:
    inset 0 0 0 3px rgba(0, 0, 0, 0.35),
    inset 0 10px 18px rgba(255, 255, 255, 0.12),
    inset 0 -8px 16px rgba(0, 0, 0, 0.3);
}

.vinyl-label-sheen {
  background: conic-gradient(
    from 45deg,
    transparent 0deg,
    rgba(255, 255, 255, 0.15) 90deg,
    transparent 180deg,
    rgba(0, 0, 0, 0.2) 270deg,
    transparent 360deg
  );
  mix-blend-mode: overlay;
}

.vinyl-spindle {
  width: 4%;
  height: 4%;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle, #000 30%, #1a1a1f 100%);
  box-shadow: inset 0 0 4px rgba(255, 255, 255, 0.2);
}

.vinyl-top-highlight {
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.08) 0%,
    transparent 30%,
    transparent 70%,
    rgba(255, 255, 255, 0.03) 100%
  );
  mix-blend-mode: screen;
}

/* 固定光源各向异性反光：两道楔形亮带斜跨盘面（沟槽转动时呈现流动光泽） */
.vinyl-light-sweep {
  background: conic-gradient(
    from 315deg at 50% 50%,
    transparent 0deg,
    rgba(255, 255, 255, 0.09) 14deg,
    rgba(255, 255, 255, 0.02) 30deg,
    transparent 46deg,
    transparent 158deg,
    rgba(255, 255, 255, 0.06) 172deg,
    rgba(255, 255, 255, 0.015) 190deg,
    transparent 206deg,
    transparent 360deg
  );
  mix-blend-mode: screen;
}

/* 边缘轮辉：外圈细亮环 + 主题色氛围边光 */
.vinyl-rim-light {
  box-shadow:
    inset 0 0 0 1.5px rgba(255, 255, 255, 0.22),
    inset 0 0 12px rgba(255, 255, 255, 0.06),
    0 0 24px v-bind('props.accent + "30"');
}

/* 环境色反射：左上冷调 / 右下主题色暖调 */
.vinyl-ambient {
  background:
    radial-gradient(circle at 18% 14%, rgba(160, 190, 255, 0.08) 0%, transparent 42%),
    radial-gradient(circle at 84% 88%, v-bind('props.accent + "14"') 0%, transparent 40%);
  mix-blend-mode: screen;
}
</style>
