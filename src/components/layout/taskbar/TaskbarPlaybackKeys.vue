<script setup lang="ts">
// 播控条右侧传输控制键：上一首 / 播放暂停 / 下一首。
defineProps<{
  playing: boolean;
}>();

defineEmits<{
  (event: 'key-press', action: 'prev-song' | 'toggle-play' | 'next-song'): void;
}>();
</script>

<template>
  <div class="z-20 mr-3 flex shrink-0 items-center gap-2.5">
    <button
      class="text-white/60 transition-colors duration-200 hover:text-white active:scale-90"
      title="上一首"
      @click.stop="$emit('key-press', 'prev-song')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5 fill-current" viewBox="0 0 24 24">
        <path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" />
      </svg>
    </button>

    <button
      class="flex h-7 w-11 items-center justify-center rounded-full border border-white/5 bg-white/10 text-white transition-all duration-200 hover:bg-white/20 active:scale-95"
      title="播放/暂停"
      @click.stop="$emit('key-press', 'toggle-play')"
    >
      <svg v-if="playing" xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
      </svg>
      <svg v-else xmlns="http://www.w3.org/2000/svg" class="ml-0.5 h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
        <path d="M8 5v14l11-7z" />
      </svg>
    </button>

    <button
      class="text-white/60 transition-colors duration-200 hover:text-white active:scale-90"
      title="下一首"
      @click.stop="$emit('key-press', 'next-song')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5 fill-current" viewBox="0 0 24 24">
        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
      </svg>
    </button>
  </div>
</template>
