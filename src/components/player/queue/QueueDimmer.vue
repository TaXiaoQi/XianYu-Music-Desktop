<script setup lang="ts">
// 队列面板展开时铺满窗口的暗色遮罩，点击任意处即收起面板。
defineEmits<{ (e: 'dismiss'): void }>();
</script>

<template>
  <div
    class="fixed inset-0 z-[90] bg-black/20 backdrop-blur-[2px]"
    @click="$emit('dismiss')"
  />
</template>
