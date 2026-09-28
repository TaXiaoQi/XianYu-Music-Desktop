<script setup lang="ts">
defineProps<{
  playing: boolean;
}>();

const emit = defineEmits<{
  previous: [];
  toggle: [];
  advance: [];
}>();
</script>

<template>
  <div class="shrink-0 flex items-center gap-3 pointer-events-auto -mt-1 mr-1">
    <button
      class="text-white/80 hover:text-white transition-colors hover:scale-110 transform duration-200"
      title="上一首"
      @click.stop="emit('previous')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" />
      </svg>
    </button>

    <button
      class="flex items-center justify-center transition-all active:scale-95 shrink-0 w-10 h-10 rounded-full border text-white bg-white/10 hover:bg-white/20 border-white/5"
      title="播放/暂停"
      @click.stop="emit('toggle')"
    >
      <svg v-if="playing" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 fill-current" viewBox="0 0 24 24">
        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
      </svg>
      <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 fill-current" viewBox="0 0 24 24">
        <path d="M8.3 5v14l11-7z" />
      </svg>
    </button>

    <button
      class="text-white/80 hover:text-white transition-colors hover:scale-110 transform duration-200"
      title="下一首"
      @click.stop="emit('advance')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
      </svg>
    </button>
  </div>
</template>
