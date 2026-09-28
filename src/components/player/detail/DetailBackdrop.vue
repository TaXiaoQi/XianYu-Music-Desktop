<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

const PlayerDetailMeshBackground = defineAsyncComponent(() => import('../PlayerDetailMeshBackground.vue'));
const PlayerDetailBackground = defineAsyncComponent(() => import('../PlayerDetailBackground.vue'));

defineProps<{
  /** 详情页重型内容放行后才渲染真实背景 */
  ready?: boolean;
  /** 详情页展开态：驱动整层滑入/滑出过渡 */
  active?: boolean;
  /** 多边形流光背景开关（电影模式下让位给背景视频） */
  meshOn?: boolean;
}>();
</script>

<template>
  <!-- 黑色底色由内层 backdrop-base 提供，外层带透明度过渡，避免切换瞬间遮住主页 -->
  <div
    class="backdrop-slide"
    :style="{
      opacity: active ? 1 : 0,
      transform: active ? 'translateY(0)' : 'translateY(100%)',
    }"
  >
    <PlayerDetailMeshBackground v-if="ready && meshOn" :active="Boolean(active)" />
    <PlayerDetailBackground v-else-if="ready" :bg-opacity="1" :active="Boolean(active)" />
    <div class="backdrop-base"></div>
  </div>
</template>

<style scoped>
.backdrop-slide {
  position: absolute;
  inset: 0;
  transition:
    opacity 600ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 600ms cubic-bezier(0.22, 1, 0.36, 1);
}

.backdrop-base {
  position: absolute;
  inset: 0;
  z-index: -1;
  background-color: #0a0a0a;
}
</style>
