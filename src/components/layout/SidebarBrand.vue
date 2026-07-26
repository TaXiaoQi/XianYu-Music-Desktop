<script setup lang="ts">
import { ref } from 'vue';

const isEasterEgg = ref(false);
const isAnimating = ref(false);

const toggleEasterEgg = () => {
  if (isAnimating.value) return;
  isAnimating.value = true;
  isEasterEgg.value = !isEasterEgg.value;
  setTimeout(() => {
    isAnimating.value = false;
  }, 250);
};
</script>

<template>
  <div class="h-16 relative px-6 shrink-0 mb-2 cursor-pointer" data-tauri-drag-region>
    <!-- 原状态：居中 -->
    <div
      class="absolute inset-0 flex items-center justify-center transition-opacity duration-200"
      :class="isEasterEgg ? 'opacity-0 pointer-events-none' : 'opacity-100'"
      @click.stop="toggleEasterEgg"
    >
      <img
        src="/logo.png"
        alt="Logo"
        class="object-contain drop-shadow-sm opacity-80 w-[29px] h-[29px] mr-[7px] dark:invert pointer-events-none"
      />
      <h1 class="font-medium tracking-wide text-[17px] text-[#353A3E] dark:text-white/80 pointer-events-none">
        弦予音乐
      </h1>
    </div>
    <!-- 彩蛋状态：居中 -->
    <div
      class="absolute inset-0 flex items-center justify-center transition-opacity duration-200"
      :class="isEasterEgg ? 'opacity-100' : 'opacity-0 pointer-events-none'"
      @click.stop="toggleEasterEgg"
    >
      <h1 class="font-black tracking-wider text-[17px] text-[#353A3E] dark:text-white/80 pointer-events-none">
        XY Music
      </h1>
    </div>
  </div>
</template>

<style scoped>
</style>
