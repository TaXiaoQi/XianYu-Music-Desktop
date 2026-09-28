<script setup lang="ts">
import type { StyleValue } from 'vue';

defineProps<{
  /** 详情页展开时才显示主标题，收起时整块淡出 */
  shown?: boolean;
  /** 入场位移样式（由父级按相位计算） */
  enterStyle?: StyleValue;
  /** 曲目标题 */
  title?: string;
  /** 歌手名 */
  artist?: string;
}>();
</script>

<template>
  <div
    class="marquee-dock"
    :class="shown ? 'marquee-dock--in' : 'marquee-dock--off'"
    :style="enterStyle"
  >
    <span class="truncate text-[clamp(15px,2.2vh,24px)] font-semibold tracking-wide text-white drop-shadow-md">{{ title }}</span>
    <span v-if="artist" class="truncate text-[clamp(11px,1.5vh,16px)] text-white/60">- {{ artist }}</span>
  </div>
</template>

<style scoped>
.marquee-dock {
  position: relative;
  z-index: 55;
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: center;
  gap: 0.75rem;
  padding-inline: 1.5rem;
  padding-bottom: clamp(2px, 1vh, 16px);
  text-align: center;
  pointer-events: none;
}

.marquee-dock--in {
  animation: marquee-rise 500ms cubic-bezier(0.22, 1, 0.36, 1) 200ms both;
}

.marquee-dock--off {
  opacity: 0;
}

@keyframes marquee-rise {
  from {
    opacity: 0;
    transform: translate(-30px, 30px);
  }
  to {
    opacity: 1;
    transform: translate(0, 0);
  }
}
</style>
