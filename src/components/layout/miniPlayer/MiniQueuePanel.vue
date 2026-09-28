<script setup lang="ts">
import { formatDuration } from '../../../utils/format';
import type { Song } from '../../../types';

defineProps<{
  queue: Song[];
  activePath: string | null;
}>();

const emit = defineEmits<{
  play: [song: Song];
}>();
</script>

<template>
  <div
    class="absolute left-0 right-0 top-[144px] bottom-0 z-30"
    style="background-color: rgba(20, 20, 22, 0.96); backdrop-filter: blur(12px);"
  >
    <div class="h-full overflow-y-auto custom-scrollbar px-1.5 pt-0 pb-1.5">
      <div
        v-if="queue.length === 0"
        class="h-full flex items-center justify-center text-xs text-gray-400 dark:text-white/30"
      >
        暂无歌曲
      </div>

      <button
        v-for="(song, index) in queue"
        :key="song.path + index"
        class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors"
        :class="song.path === activePath
          ? 'bg-[#EC4141]/10 text-[#EC4141]'
          : 'text-gray-700 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/5'"
        @click="emit('play', song)"
      >
        <div
          class="w-5 shrink-0 text-[10px] text-center"
          :class="song.path === activePath ? 'text-[#EC4141]' : 'text-gray-400 dark:text-white/30'"
        >
          <svg v-if="song.path === activePath" xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mx-auto" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
          <span v-else>{{ index + 1 }}</span>
        </div>

        <div class="min-w-0 flex-1">
          <div class="text-xs truncate font-medium">{{ song.title || song.name.replace(/\.[^/.]+$/, '') }}</div>
          <div
            class="text-[10px] truncate"
            :class="song.path === activePath ? 'text-[#EC4141]/70' : 'text-gray-400 dark:text-white/30'"
          >{{ song.artist || 'Unknown Artist' }}</div>
        </div>

        <div
          class="text-[10px] shrink-0"
          :class="song.path === activePath ? 'text-[#EC4141]/70' : 'text-gray-400 dark:text-white/30'"
        >
          {{ formatDuration(song.duration) }}
        </div>
      </button>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 5px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(148, 163, 184, 0.35);
  border-radius: 3px;
}
</style>
