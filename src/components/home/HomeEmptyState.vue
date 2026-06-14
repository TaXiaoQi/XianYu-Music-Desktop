<script setup lang="ts">
interface Props {
  message: string;
  iconPath: string;
}

defineProps<Props>();
</script>

<template>
  <div class="flex min-h-[400px] flex-col items-center justify-center text-gray-400 dark:text-gray-500">
    <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="iconPath" />
    </svg>
    <p class="text-sm">{{ message }}</p>
  </div>
</template>
