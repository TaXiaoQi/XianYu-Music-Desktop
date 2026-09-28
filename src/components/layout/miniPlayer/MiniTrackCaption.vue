<script setup lang="ts">
import { computed } from 'vue';

import type { Song } from '../../../types';

const props = defineProps<{
  track: Song | null;
}>();

const heading = computed(() => {
  const song = props.track;
  return song ? song.title || song.name.replace(/\.[^/.]+$/, '') : 'XianYu Music';
});

const byline = computed(() => {
  const song = props.track;
  if (!song || (!song.artist && !song.album)) return '';
  const artist = song.artist || '未知歌手';
  return song.album ? `${artist} - ${song.album}` : artist;
});
</script>

<template>
  <div class="flex-1 min-w-0 flex flex-col gap-0.5" data-tauri-drag-region>
    <div class="text-[14px] font-medium text-white truncate leading-tight">{{ heading }}</div>
    <div class="text-[12px] text-white/60 truncate leading-tight">
      <template v-if="byline">{{ byline }}</template>
      <template v-else>未知歌曲</template>
    </div>
  </div>
</template>
