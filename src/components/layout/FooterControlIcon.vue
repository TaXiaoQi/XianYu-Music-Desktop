<script setup lang="ts">
import { AudioLines, Cast, CircleCheck, Clapperboard, Download, Eye, EyeOff, MessageCircle, Palette, Share2, SlidersHorizontal } from 'lucide-vue-next';
import type { FooterItemKey } from '../../types';
import { useDownloadStore } from '../../features/download/store';

defineOptions({ inheritAttrs: false });

const downloadStore = useDownloadStore();

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
  <div v-else-if="itemKey === 'download' && loading" v-bind="$attrs" class="relative inline-flex items-center justify-center">
    <svg class="h-full w-full -rotate-90" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-opacity="0.15" stroke-width="4" />
      <circle
        cx="12" cy="12" r="9" fill="none" stroke="currentColor"
        stroke-width="4" stroke-linecap="round"
        :stroke-dasharray="56.55"
        :stroke-dashoffset="56.55 * (1 - downloadStore.progress / 100)"
        class="transition-[stroke-dashoffset] duration-150"
      />
    </svg>
  </div>
  <CircleCheck v-else-if="itemKey === 'download' && completed" v-bind="$attrs" />
  <Download v-else-if="itemKey === 'download'" v-bind="$attrs" />
  <template v-else-if="itemKey === 'playMode'">
    <svg v-if="playMode === 0" v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
    <svg v-else-if="playMode === 1" v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /><text x="12" y="16" font-family="sans-serif" font-size="10" font-weight="bold" text-anchor="middle" fill="currentColor" stroke="none">1</text></svg>
    <svg v-else v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
  </template>
  <span v-else-if="itemKey === 'desktopLyrics'" v-bind="$attrs" class="text-[14px] font-bold leading-none">词</span>
  <span v-else-if="itemKey === 'quality'" v-bind="$attrs" class="whitespace-nowrap text-[11px] font-semibold leading-none">{{ qualityLabel }}</span>
  <template v-else-if="itemKey === 'volume'">
    <svg v-if="volume === 0" v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
    <svg v-else-if="volume < 30" v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /></svg>
    <svg v-else-if="volume < 70" v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
    <svg v-else v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
  </template>
  <SlidersHorizontal v-else-if="itemKey === 'equalizer'" v-bind="$attrs" :stroke-width="2.2" />
  <svg v-else-if="itemKey === 'playlist'" v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zm16-6v6.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5v4z" /></svg>
  <MessageCircle v-else-if="itemKey === 'comment'" v-bind="$attrs" :stroke-width="2.2" />
  <Clapperboard v-else-if="itemKey === 'mv'" v-bind="$attrs" :stroke-width="2.2" />
  <Share2 v-else-if="itemKey === 'share'" v-bind="$attrs" :stroke-width="2.2" />
  <Cast v-else-if="itemKey === 'cast'" v-bind="$attrs" :stroke-width="2.2" />
  <AudioLines v-else-if="itemKey === 'visualizer'" v-bind="$attrs" :stroke-width="2.2" />
  <component
    :is="active ? EyeOff : Eye"
    v-else-if="itemKey === 'progress'"
    v-bind="$attrs"
    :stroke-width="2.2"
  />
  <Palette v-else-if="itemKey === 'pageStyle'" v-bind="$attrs" :stroke-width="2.2" />
  <svg v-else-if="itemKey === 'pin'" v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <template v-if="active">
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </template>
    <template v-else>
      <path d="m2 2 20 20" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-.82" />
      <path d="M12 17v5" />
      <path d="M15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </template>
  </svg>
</template>
