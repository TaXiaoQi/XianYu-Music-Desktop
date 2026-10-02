<script setup lang="ts"> // 实现
import { useSearchAwareTitle } from '../../composables/useSearchAwareTitle';
import SortModeButton from '../common/SortModeButton.vue';

type RoundKey = 'play' | 'enqueue' | 'wipe';

interface ActionSpec<K extends string> {
  key: K;
  tip: string;
  strokes: string[];
  weight?: number;
}

const emit = defineEmits<{
  playAll: [];
  clearHistory: [];
  addAllToQueue: [];
}>();

const heading = useSearchAwareTitle('最近播放');

const roundEntries: ActionSpec<RoundKey>[] = [
  { key: 'play', tip: '播放全部', weight: 2.2, strokes: ['M9 5.5v13l10-6.5-10-6.5Z'] },
  {
    key: 'enqueue',
    tip: '全部添加至播放列表',
    strokes: ['M3.5 6H17', 'M3.5 12H14', 'M3.5 18H11', 'M18 14v6', 'M15 17h6'],
  },
  {
    key: 'wipe',
    tip: '清空播放记录',
    strokes: [
      'M3 6h18',
      'M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2',
      'M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6',
      'M10 11v6',
      'M14 11v6',
    ],
  },
];

const ROUND_BUTTON =
  'grid size-7 place-items-center rounded-full border border-white/1 bg-white/1 text-gray-500 shadow-sm transition active:scale-95 dark:text-gray-400';

const CALM_HOVER =
  'hover:border-gray-200 hover:bg-white/10 hover:text-gray-700 dark:hover:border-white/20 dark:hover:text-gray-200';

const WIPE_HOVER =
  'hover:border-red-200 hover:bg-red-50 hover:text-[#EC4141] dark:hover:border-red-500/30 dark:hover:bg-red-500/10';

const dispatchRound = (key: RoundKey) => {
  const byKey: Record<RoundKey, () => void> = {
    play: () => emit('playAll'),
    enqueue: () => emit('addAllToQueue'),
    wipe: () => emit('clearHistory'),
  };
  byKey[key]();
};
</script>

<template>
  <div
    class="flex h-auto shrink-0 select-none flex-col justify-center px-6 pb-[clamp(6px,1vh,12px)] pt-[clamp(0px,0.3vh,4px)]"
  >
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2 pb-1">
        <h2 class="text-xl font-bold text-gray-900 dark:text-white">{{ heading }}</h2>
      </div>

      <div class="flex gap-2 items-center">
        <button
          v-for="entry in roundEntries"
          :key="entry.key"
          :class="[ROUND_BUTTON, entry.key === 'wipe' ? WIPE_HOVER : CALM_HOVER]"
          :title="entry.tip"
          @click="dispatchRound(entry.key)"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            :stroke-width="entry.weight ?? 2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path v-for="(seg, idx) in entry.strokes" :key="idx" :d="seg" />
          </svg>
        </button>

        <SortModeButton />
      </div>
    </div>
  </div>
</template>
