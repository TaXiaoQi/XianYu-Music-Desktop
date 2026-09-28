<script setup lang="ts">
import { computed } from 'vue';

import type { Song } from '../../../types';
import { formatDuration } from '../../../utils/format';

const props = defineProps<{
  /** 本行对应的待播曲目 */
  entry: Song;
  /** 在清单中的序号（从 0 计） */
  ordinal: number;
  /** 是否正在播放 */
  active: boolean;
  /** 触发播放的手势：单击或双击 */
  clickMode: 'single' | 'double';
}>();

const emit = defineEmits<{
  (e: 'activate', entry: Song): void;
}>();

const headingText = computed(() => props.entry.title || props.entry.name);
const subText = computed(() => props.entry.artist || 'Unknown');
const runLengthText = computed(() => formatDuration(props.entry.duration));

const playsOnTap = computed(() => props.clickMode === 'single');

const onTap = () => {
  if (playsOnTap.value) emit('activate', props.entry);
};

const onDoubleTap = () => {
  if (!playsOnTap.value) emit('activate', props.entry);
};
</script>

<template>
  <div
    class="group flex cursor-pointer items-center gap-3 rounded-lg p-3 transition-colors duration-200 hover:bg-white/10"
    :class="active ? 'bg-white/15' : ''"
    @click="onTap"
    @dblclick="onDoubleTap"
  >
    <div class="flex w-8 justify-center text-sm font-medium text-white/40">
      <div v-if="active" class="animate-pulse text-white">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16" />
          <rect x="14" y="4" width="4" height="16" />
        </svg>
      </div>
      <span v-else class="group-hover:hidden">{{ ordinal + 1 }}</span>
      <svg xmlns="http://www.w3.org/2000/svg" class="hidden h-5 w-5 text-white group-hover:block" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z" />
      </svg>
    </div>

    <div class="min-w-0 flex-1">
      <div class="mb-0.5 truncate text-sm font-medium" :class="active ? 'text-white' : 'text-white/90'">{{ headingText }}</div>
      <div class="truncate text-xs" :class="active ? 'text-white/60' : 'text-white/40'">{{ subText }}</div>
    </div>

    <div class="text-xs tabular-nums" :class="active ? 'text-white/60' : 'text-white/30'">{{ runLengthText }}</div>
  </div>
</template>
