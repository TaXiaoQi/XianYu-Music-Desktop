<script setup lang="ts">
// 播控条左侧拖拽握把：悬停浮现竖条指示，按下时交由父级启动拖拽流程。
defineProps<{
  engaged: boolean;
}>();

defineEmits<{
  (event: 'grip-press', pointer: PointerEvent): void;
}>();
</script>

<template>
  <div
    class="group -ml-1.5 mr-1 flex h-[34px] w-[22px] shrink-0 cursor-move items-center justify-center"
    title="按住拖拽调整播控条位置"
    @pointerdown.prevent.stop="$emit('grip-press', $event)"
  >
    <div
      class="pointer-events-none h-[16px] w-[4px] rounded-full bg-white/50 opacity-0 transition-all duration-300 group-hover:scale-x-125 group-hover:opacity-100 group-hover:shadow-[0_0_8px_rgba(255,255,255,0.6)] group-active:bg-white"
      :class="[engaged ? 'scale-x-125 bg-white opacity-100 shadow-[0_0_8px_rgba(255,255,255,0.6)]' : '']"
    ></div>
  </div>
</template>
