<script setup lang="ts">
import { Music2 } from 'lucide-vue-next';
import { convertFileSrc } from '@tauri-apps/api/core';
import { computed } from 'vue';

import type { Song } from '../../../types';

const props = defineProps<{
  track: Song | null;
}>();

const heading = computed(() => {
  const song = props.track;
  if (!song) return 'XianYu Music';
  return song.title || song.name.replace(/\.[^/.]+$/, '');
});

const byline = computed(() => props.track?.artist || '');

const artwork = computed(() => {
  const path = props.track?.cover_thumb_path;
  if (!path) return '';
  if (path.startsWith('http') || path.startsWith('asset:') || path.startsWith('data:')) {
    return path;
  }
  return convertFileSrc(path);
});
</script>

<template>
  <section class="nowPlaying">
    <div class="artwork">
      <img v-if="artwork" :src="artwork" alt="" class="artwork__bitmap" />
      <Music2 v-else class="artwork__fallback" :size="24" :stroke-width="2.1" />
    </div>
    <div class="captions">
      <span class="captions__title" :title="heading">{{ heading }}</span>
      <span v-if="byline" class="captions__byline" :title="byline">{{ byline }}</span>
    </div>
  </section>
</template>

<style scoped>
.nowPlaying {
  display: flex;
  align-items: center;
  height: 64px;
  gap: 11px;
  padding: 6px 14px 0;
  flex-shrink: 0;
}

.artwork {
  flex: 0 0 auto;
  width: 50px;
  height: 50px;
  border-radius: 8px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: var(--trayHover);
}

.artwork__bitmap {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.artwork__fallback {
  color: var(--trayInkSoft);
}

.captions {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.captions__title {
  min-width: 0;
  overflow: hidden;
  color: var(--trayInk);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.captions__byline {
  min-width: 0;
  overflow: hidden;
  color: var(--trayInkSoft);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
