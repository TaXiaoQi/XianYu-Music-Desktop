<script setup lang="ts">
defineProps<{
  /** Shows the spinner (progress toasts). */
  busy: boolean;
  kind?: 'success' | 'error' | 'info';
}>();
</script>

<template>
  <svg
    v-if="busy"
    xmlns="http://www.w3.org/2000/svg"
    class="h-4 w-4 shrink-0 animate-spin text-white/80"
    viewBox="0 0 24 24"
    fill="none"
  >
    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" class="opacity-25" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-90" />
  </svg>
  <svg
    v-if="kind === 'success'"
    xmlns="http://www.w3.org/2000/svg"
    class="h-4 w-4 text-green-400"
    viewBox="0 0 20 20"
    fill="currentColor"
  >
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M16.72 6.03a.85.85 0 0 1 0 1.2l-7.1 7.1a.85.85 0 0 1-1.2 0l-3.14-3.13a.85.85 0 1 1 1.2-1.2l2.54 2.53 6.5-6.5a.85.85 0 0 1 1.2 0Z"
    />
  </svg>
  <svg
    v-if="kind === 'error'"
    xmlns="http://www.w3.org/2000/svg"
    class="h-4 w-4 text-red-400"
    viewBox="0 0 20 20"
    fill="currentColor"
  >
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Zm0-3.4a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2Zm.9-7.2a.9.9 0 1 0-1.8 0v3.4a.9.9 0 1 0 1.8 0V6.9Z"
    />
  </svg>
</template>
