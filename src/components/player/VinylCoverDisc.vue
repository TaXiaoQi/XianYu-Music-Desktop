<script setup lang="ts">
/**
 * 转盘上的封面盘：专辑封面直接贴在金属转盘中央（不画黑色黑胶本体），
 * 播放时绕中心匀速旋转（目标 60°/s），暂停后减速停住并保留角度。
 * 光源固定在左上，故光泽与投影层不参与旋转（旋转层只带封面本体 + 底色）。
 * rAF 插值旋转的写法沿用原 VinylRecord（源自 mozarta-nexus/music-web-player，MIT）。
 *
 * 帧循环只在需要时存在：暂停且已停稳、或系统开启「减少动态效果」时都不排帧，
 * 避免展开态常驻一个按刷新率空转的回调。
 */
const props = withDefaults(defineProps<{
  cover: string;
  rotation: number;
  /** 主题色（仅用于无封面时的占位底色） */
  accent?: string;
}>(), {
  accent: '#EC4141',
});


</script>

<template>
  <div class="disc-root relative aspect-square w-full select-none">
    <!-- 封面本体（旋转层）：只放封面与底色，投影/光泽留在不旋转的层上 -->
    <div
      class="disc-body absolute inset-0 overflow-hidden rounded-full"
      :style="{ transform: `rotate(${props.rotation.toFixed(3)}deg)` }"
    >
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
      <div
        v-else
        class="flex h-full w-full items-center justify-center"
        :style="{ background: `radial-gradient(circle at 40% 32%, ${props.accent}, #16181c)` }"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-1/4 w-1/4 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
        </svg>
      </div>
    </div>

    <!-- 落地投影 + 边缘细亮环（不旋转，光源固定在左上） -->
    <div class="disc-edge pointer-events-none absolute inset-0 rounded-full" />
    <!-- 光泽：左上受光、右下压暗（不旋转，封面转动时才有流动感） -->
    <div class="disc-sheen pointer-events-none absolute inset-0 rounded-full" />
    <!-- 中心轴：真机的轴不跟着封面转 -->
    <div class="disc-spindle pointer-events-none absolute left-1/2 top-1/2 rounded-full" />
  </div>
</template>

<style scoped>
/* 封面本体：贴片底色（无封面时可见），图片铺满圆形 */
.disc-body {
  transform: rotate(0deg);
  will-change: transform;
  background: #101113;
}

/* 边缘：细亮环 + 底缘压暗 + 落地投影（投影放在不旋转层，转动时方向才不跟着转） */
.disc-edge {
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.24),
    inset 0 2px 4px rgba(255, 255, 255, 0.16),
    inset 0 -6px 14px rgba(0, 0, 0, 0.3),
    0 10px 24px rgba(0, 0, 0, 0.4),
    0 2px 6px rgba(0, 0, 0, 0.32);
}

/* 光泽：142° 斜向（约对齐左上光源），overlay 混合——亮部提亮、暗部压暗 */
.disc-sheen {
  background: linear-gradient(
    142deg,
    rgba(255, 255, 255, 0.34) 0%,
    rgba(255, 255, 255, 0.1) 20%,
    rgba(255, 255, 255, 0) 44%,
    rgba(0, 0, 0, 0.16) 100%
  );
  mix-blend-mode: overlay;
}

/* 中心轴：小金属圆柱，左上受光（不随封面旋转） */
.disc-spindle {
  width: 2.8%;
  height: 2.8%;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle at 38% 32%, #ffffff 0%, #dcdfe5 28%, #a1a7b0 60%, #666b74 100%);
  box-shadow:
    0 2px 5px rgba(0, 0, 0, 0.55),
    inset 0 -1px 2px rgba(0, 0, 0, 0.4);
}
</style>
