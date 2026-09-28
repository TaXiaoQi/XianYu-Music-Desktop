<script setup lang="ts">
import type { DragSessionType } from '../../../composables/dragState';

defineProps<{
  dragType: DragSessionType;
  /** Resolved thumbnail for a dragged song, empty when unavailable. */
  cover: string;
}>();
</script>

<template>
  <div
    class="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden shadow-sm bg-gray-200/50 dark:bg-white/10"
    :class="dragType === 'artist' ? 'rounded-full' : 'rounded'"
  >
    <img v-if="dragType === 'song' && cover" :src="cover" class="h-full w-full object-cover" alt="" />

    <template v-else>
      <svg
        v-if="dragType === 'song' || dragType === 'playlist'"
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6 text-gray-400 dark:text-white/40"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.6 18.6V6.9l11-2.7v11.7" />
        <ellipse cx="6.2" cy="18.6" rx="2.4" ry="2.1" />
        <ellipse cx="17.2" cy="15.9" rx="2.4" ry="2.1" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.6 10.4l11-2.7" />
      </svg>
      <svg
        v-else-if="dragType === 'folder'"
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6 text-gray-400 dark:text-white/40"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M3 7.2c0-1 .8-1.7 1.7-1.7h4.4l2 2.1h8.2c1 0 1.7.8 1.7 1.7v8.5c0 1-.8 1.7-1.7 1.7H4.7c-1 0-1.7-.8-1.7-1.7V7.2Z"
        />
      </svg>
      <div v-else-if="dragType === 'artist'" class="text-2xl">👤</div>
      <div v-else-if="dragType === 'album'" class="text-2xl">💿</div>
    </template>

    <div class="absolute inset-0 bg-black/5"></div>
  </div>
</template>
