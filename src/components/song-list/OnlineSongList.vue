<script setup lang="ts">
import { computed } from 'vue';
import type { Song } from '../../types';
import { useSettings } from '../../features/settings/useSettings';
import { launchFlyingCover } from '../../composables/useFlyingCover';

const { settings } = useSettings();
const songClickAction = computed(() => settings.value.songClickAction || 'double');

const props = defineProps<{
  songs: Song[];
}>();

const emit = defineEmits<{
  (e: 'play', song: Song): void;
  (e: 'contextmenu', event: MouseEvent, song: Song): void;
}>();

const formatDuration = (seconds: number): string => {
  if (!seconds || seconds <= 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const handleImgError = (e: Event) => {
  (e.target as HTMLImageElement).style.display = 'none';
};

/** 点击/双击播放：触发飞入封面动画并立即 emit 播放 */
const handlePlayClick = (song: Song) => {
  launchFlyingCover(song.path, song.cover_thumb_path || '');
  emit('play', song);
};
</script>

<template>
  <table class="w-full text-left">
    <tbody>
      <tr
        v-for="(item, index) in props.songs"
        :key="`${item.path}-${index}`"
        class="group border-b border-black/5 dark:border-white/5 cursor-default select-none transition-colors hover:bg-black/5 dark:hover:bg-white/5"
        @click="songClickAction === 'single' && handlePlayClick(item)"
        @dblclick="songClickAction !== 'single' && handlePlayClick(item)"
        @contextmenu="emit('contextmenu', $event, item)"
      >
        <td class="py-2 px-4 text-center text-xs text-black/40 dark:text-white/40">
          {{ index + 1 }}
        </td>
        <td class="py-2 px-2">
          <div class="w-11 h-11 rounded-lg bg-black/10 dark:bg-white/10 overflow-hidden flex items-center justify-center text-[#EC4141] text-lg font-black shrink-0" :data-cover-path="item.path">
            <img
              v-if="item.cover_thumb_path"
              :src="item.cover_thumb_path"
              class="w-full h-full object-cover"
              alt=""
              loading="lazy"
              @error="handleImgError"
            />
            <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>
        </td>
        <td class="py-2 px-2 text-sm text-black dark:text-white font-medium truncate max-w-[200px]">
          {{ item.title || item.name }}
        </td>
        <td class="py-2 px-2 text-sm text-black/60 dark:text-white/60 truncate max-w-[150px]">
          {{ item.artist }}
        </td>
        <td class="py-2 px-2 text-sm text-black/40 dark:text-white/40 truncate max-w-[150px]">
          {{ item.album }}
        </td>
        <td class="py-2 px-4 text-xs text-black/40 dark:text-white/40 text-right whitespace-nowrap">
          {{ formatDuration(item.duration) }}
        </td>
      </tr>
    </tbody>
  </table>
</template>
