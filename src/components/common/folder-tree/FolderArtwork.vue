<script setup lang="ts">
defineProps<{ cover: string }>();
</script>

<template>
  <div class="relative mr-2 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-black/5 bg-gray-200 dark:border-white/5 dark:bg-gray-700">
    <img v-if="cover" :src="cover" class="h-full w-full object-cover transition-opacity duration-300" loading="lazy" decoding="async" />
    <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M2.5 6.4c0-.9.7-1.6 1.6-1.6h3.4l1.7 1.7h6.7c.9 0 1.6.7 1.6 1.6v6.5c0 .9-.7 1.6-1.6 1.6H4.1c-.9 0-1.6-.7-1.6-1.6V6.4Z" />
    </svg>
  </div>
</template>
