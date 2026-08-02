<script setup lang="ts">
import { CircleCheck, Download, Gauge, Loader2, SlidersHorizontal } from 'lucide-vue-next';
import type { FooterItemKey } from '../../types';

defineOptions({ inheritAttrs: false });

withDefaults(defineProps<{
  itemKey: FooterItemKey;
  active?: boolean;
  loading?: boolean;
  completed?: boolean;
  playMode?: number;
  volume?: number;
  qualityLabel?: string;
}>(), {
  active: false,
  loading: false,
  completed: false,
  playMode: 0,
  volume: 100,
  qualityLabel: 'SQ',
});
</script>

<template>
  <svg v-if="itemKey === 'favorite'" v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" :fill="active ? 'currentColor' : 'none'" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
  </svg>
  <Loader2 v-else-if="itemKey === 'download' && loading" v-bind="$attrs" class="animate-spin" />
  <CircleCheck v-else-if="itemKey === 'download' && completed" v-bind="$attrs" />
  <Download v-else-if="itemKey === 'download'" v-bind="$attrs" />
  <template v-else-if="itemKey === 'playMode'">
    <svg v-if="playMode === 0" v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
    <svg v-else-if="playMode === 1" v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /><text x="12" y="16" font-family="sans-serif" font-size="10" font-weight="bold" text-anchor="middle" fill="currentColor" stroke="none">1</text></svg>
    <svg v-else v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
  </template>
  <span v-else-if="itemKey === 'desktopLyrics'" v-bind="$attrs" class="text-[14px] font-bold leading-none">词</span>
  <span v-else-if="itemKey === 'quality'" v-bind="$attrs" class="whitespace-nowrap text-[11px] font-semibold leading-none">{{ qualityLabel }}</span>
  <Gauge v-else-if="itemKey === 'speed'" v-bind="$attrs" />
  <template v-else-if="itemKey === 'volume'">
    <svg v-if="volume === 0" v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
    <svg v-else-if="volume < 30" v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /></svg>
    <svg v-else-if="volume < 70" v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
    <svg v-else v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
  </template>
  <SlidersHorizontal v-else-if="itemKey === 'equalizer'" v-bind="$attrs" :stroke-width="2.2" />
  <svg v-else-if="itemKey === 'playlist'" v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
</template>
