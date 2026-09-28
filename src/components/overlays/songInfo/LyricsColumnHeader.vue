<!-- 歌词栏顶部条：标题、内嵌歌曲摘要（封面+歌名+歌手）与放大/还原按钮 -->
<script setup lang="ts">
import type { Song } from '../../../types';

defineProps<{
  song: Song | null;
  coverSrc: string;
  titleText: string;
  expanded: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle-expand'): void;
}>();

const ENLARGE_CORNERS = 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5';
const RESTORE_CORNERS = 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5';
</script>

<template>
  <div class="lyrics-editor-header modal-external-header">
    <div class="lyrics-editor-heading">
      <div class="lyrics-editor-title" :class="expanded ? 'lyrics-editor-title--expanded' : ''">
        编辑歌词
      </div>
      <div
        v-if="song"
        class="lyrics-editor-inline-song"
        :class="expanded ? '' : 'lyrics-editor-inline-song--hidden'"
      >
        <div class="lyrics-editor-cover">
          <img v-if="coverSrc" alt="" decoding="async" draggable="false" :src="coverSrc" />
          <svg v-else class="h-5 w-5 dark:text-white/40 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path
              d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
        <div class="min-w-0">
          <div class="truncate text-sm font-bold dark:text-white text-gray-900" :title="titleText">
            {{ titleText }}
          </div>
          <div class="truncate text-xs dark:text-white/50 text-gray-500" :title="song.artist">
            {{ song.artist }}
          </div>
        </div>
      </div>
    </div>
    <button
      type="button"
      class="lyrics-editor-expand-button"
      :title="expanded ? '还原歌词编辑器' : '放大歌词编辑器'"
      @click="emit('toggle-expand')"
    >
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path
          :d="expanded ? RESTORE_CORNERS : ENLARGE_CORNERS"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  </div>
</template>
