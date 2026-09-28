<script setup lang="ts">
defineProps<{
  cover: string;
}>();

const emit = defineEmits<{
  restore: [];
}>();
</script>

<template>
  <div
    class="w-[64px] h-[64px] shrink-0 relative overflow-hidden rounded-[8px]"
    data-tauri-drag-region
    title="双击展开主窗口"
    @dblclick.stop="emit('restore')"
  >
    <img v-if="cover" :src="cover" class="w-full h-full object-cover pointer-events-none" />
    <div v-else class="w-full h-full bg-gray-700 flex items-center justify-center text-white/40 pointer-events-none">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
        />
      </svg>
    </div>
  </div>
</template>
