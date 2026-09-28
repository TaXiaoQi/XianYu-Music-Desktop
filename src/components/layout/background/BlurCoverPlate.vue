<script setup lang="ts">
import { computed } from 'vue';

// 模糊封面底图：优先使用预模糊产物，未命中时回退原图并由 CSS 滤镜实时模糊。
const props = defineProps<{
  rawSource: string;
  preblurredSource: string;
  isPreblurred: boolean;
  blurAmount: number;
  brightness: number;
  plateScale: number;
  plateOpacity: number;
  maskClass: string;
}>();

const displaySource = computed(() => props.preblurredSource || props.rawSource);

const displayFilter = computed(() => (
  props.isPreblurred ? 'none' : `blur(${props.blurAmount}px) brightness(${props.brightness})`
));
</script>

<template>
  <div class="absolute inset-0">
    <div class="absolute inset-0 z-10 transition-colors duration-500" :class="maskClass"></div>
    <img
      :src="displaySource"
      class="z-0 h-full w-full object-cover transition-opacity duration-1000"
      :style="{
        filter: displayFilter,
        transform: `scale(${plateScale})`,
        opacity: plateOpacity,
      }"
      referrerpolicy="no-referrer"
    />
  </div>
</template>
