<script setup lang="ts">
// 拖放导入提示浮层：外部音频/文件夹拖入主窗口时展示的居中卡片。
</script>

<template>
  <div class="absolute inset-0 z-[140] pointer-events-none flex items-center justify-center bg-black/15 backdrop-blur-sm">
    <div class="rounded-[28px] border border-white/35 bg-white/75 px-8 py-6 text-center shadow-[0_24px_60px_rgba(0,0,0,0.2)] dark:border-white/10 dark:bg-black/65">
      <div class="text-lg font-semibold text-gray-900 dark:text-white">松开即可导入或播放</div>
      <div class="mt-2 text-sm text-gray-600 dark:text-white/70">音频文件将直接播放，文件夹将导入音乐库</div>
    </div>
  </div>
</template>

<style scoped>
.drop-overlay-enter-active,
.drop-overlay-leave-active {
  transition: opacity 0.18s ease;
}

.drop-overlay-enter-from,
.drop-overlay-leave-to {
  opacity: 0;
}
</style>
