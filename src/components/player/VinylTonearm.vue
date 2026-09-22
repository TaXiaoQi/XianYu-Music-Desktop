<script setup lang="ts">
/**
 * 唱针组件。
 * UI 移植自 mozarta-nexus/music-web-player（src/components/Tonearm.tsx，MIT），
 * 等价重写为 Vue scoped CSS：
 * - 悬浮在唱片右上方，绕底座旋转
 * - 播放落下（rotate 32deg）/ 暂停抬起（rotate -8deg），回弹曲线过渡
 */
withDefaults(defineProps<{
  isPlaying: boolean;
  accent?: string;
}>(), {
  accent: '#EC4141',
});
</script>

<template>
  <div class="pointer-events-none absolute right-[8%] top-[2%] z-20 h-[42%] w-[42%]">
    <!-- 唱针整体绕底座旋转 -->
    <div
      class="absolute inset-0"
      :class="isPlaying ? 'tonearm-down' : 'tonearm-up'"
    >
      <!-- 底座 -->
      <div class="tonearm-base absolute rounded-full" :style="{ right: '6%', bottom: '6%', width: '18%', height: '18%' }">
        <!-- 底座中心装饰 -->
        <div
          class="absolute left-1/2 top-1/2 rounded-full"
          :style="{
            width: '40%',
            height: '40%',
            transform: 'translate(-50%, -50%)',
            background: `radial-gradient(circle, ${accent} 0%, #6d28d9 100%)`,
            boxShadow: `0 0 12px ${accent}`,
          }"
        />
      </div>

      <!-- 臂杆 -->
      <div class="tonearm-arm absolute" :style="{ right: '14%', bottom: '14%', width: '78%', height: '5%' }">
        <!-- 臂杆高光 -->
        <div class="tonearm-arm-highlight absolute inset-x-0 top-0 h-1/2 rounded-t-full" />
      </div>

      <!-- 唱针头（前端） -->
      <div class="tonearm-head absolute" :style="{ right: '82%', bottom: '30%', width: '14%', height: '14%' }">
        <!-- 针尖发光 -->
        <div
          class="tonearm-tip absolute rounded-full"
          :class="isPlaying ? 'tonearm-tip--playing' : ''"
          :style="{
            left: '20%',
            bottom: '0%',
            width: '30%',
            height: '30%',
            background: `radial-gradient(circle, ${accent} 0%, transparent 70%)`,
            boxShadow: `0 0 ${isPlaying ? 10 : 8}px ${accent}`,
          }"
        />
      </div>
    </div>

    <!-- 底座投影 -->
    <div class="tonearm-base-shadow absolute rounded-full blur-md" :style="{ right: '8%', bottom: '8%', width: '14%', height: '14%' }" />
  </div>
</template>

<style scoped>
.tonearm-down {
  transition: transform 1.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  transform: rotate(32deg);
}

.tonearm-up {
  transition: transform 1s cubic-bezier(0.34, 1.56, 0.64, 1);
  transform: rotate(-8deg);
}

.tonearm-down,
.tonearm-up {
  transform-origin: 88% 88%;
}

.tonearm-base {
  background: radial-gradient(circle at 35% 35%, #4a4a52 0%, #2a2a30 40%, #1a1a1f 100%);
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.8),
    inset 0 1px 2px rgba(255, 255, 255, 0.2),
    0 0 20px rgba(236, 65, 65, 0.2);
}

.tonearm-arm {
  transform-origin: 100% 50%;
  transform: rotate(-32deg);
  background: linear-gradient(180deg, #6a6a72 0%, #3a3a42 50%, #1a1a1f 100%);
  border-radius: 999px;
  box-shadow:
    0 2px 6px rgba(0, 0, 0, 0.6),
    inset 0 1px 1px rgba(255, 255, 255, 0.25);
}

.tonearm-arm-highlight {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.3), transparent);
}

.tonearm-head {
  transform: rotate(-32deg);
  background: radial-gradient(circle at 40% 30%, #5a5a62 0%, #2a2a30 60%, #0a0a0c 100%);
  border-radius: 30% 30% 50% 50%;
  box-shadow:
    0 3px 8px rgba(0, 0, 0, 0.8),
    inset 0 1px 2px rgba(255, 255, 255, 0.2);
}

.tonearm-tip {
  transition: all 0.4s ease;
  opacity: 0.75;
}

.tonearm-tip--playing {
  opacity: 1;
}

.tonearm-base-shadow {
  background: radial-gradient(circle, rgba(0, 0, 0, 0.6), transparent 70%);
}
</style>
