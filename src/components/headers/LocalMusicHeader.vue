<script setup lang="ts">
import { computed } from 'vue';
import { useSearchAwareTitle } from '../../composables/useSearchAwareTitle';
import SortModeButton from '../common/SortModeButton.vue';

type BatchKey = 'toggleAll' | 'move' | 'collect' | 'remove';
type PrimaryKey = 'play' | 'rescan' | 'enqueue' | 'bulk';

interface ActionSpec<K extends string> {
  key: K;
  tip: string;
  strokes: string[];
  weight?: number;
}

const props = defineProps<{ isBatchMode: boolean; selectedCount?: number; totalSongCount?: number }>();

const emit = defineEmits<{
  'update:isBatchMode': [value: boolean];
  playAll: [];
  addToPlaylist: [];
  batchDelete: [];
  batchMove: [];
  refreshAll: [];
  addAllToQueue: [];
  selectAll: [];
}>();

const heading = useSearchAwareTitle('本地音乐');

const everythingPicked = computed(() => {
  const total = props.totalSongCount ?? 0;
  const picked = props.selectedCount ?? 0;
  return total > 0 && picked >= total;
});

const UNPICKED_RING = 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18';
const PICKED_RING = 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z';

const batchEntries = computed<ActionSpec<BatchKey>[]>(() => [
  {
    key: 'toggleAll',
    tip: everythingPicked.value ? '取消全选' : '全选',
    strokes: [everythingPicked.value ? PICKED_RING : UNPICKED_RING],
  },
  { key: 'move', tip: '移动到文件夹', strokes: ['M4 6h16', 'M4 12h16', 'M4 18h16'] },
  { key: 'collect', tip: '添加到歌单', strokes: ['M12 4v16m8-8H4'] },
  {
    key: 'remove',
    tip: '删除',
    strokes: [
      'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
    ],
  },
]);

const runBatchEntry = (key: BatchKey) => {
  switch (key) {
    case 'toggleAll':
      emit('selectAll');
      break;
    case 'move':
      emit('batchMove');
      break;
    case 'collect':
      emit('addToPlaylist');
      break;
    case 'remove':
      emit('batchDelete');
      break;
  }
};

const leaveBatchMode = () => {
  emit('update:isBatchMode', false);
};

const ROUND_BUTTON =
  'grid size-7 place-items-center rounded-full border border-white/1 bg-white/1 text-gray-900 shadow-sm transition hover:border-gray-200 hover:bg-white/10 hover:text-black active:scale-95 dark:text-gray-100 dark:hover:border-white/20 dark:hover:text-white';

const primaryEntries: ActionSpec<PrimaryKey>[] = [
  { key: 'play', tip: '播放全部', weight: 2.2, strokes: ['M9 5.5v13l10-6.5-10-6.5Z'] },
  {
    key: 'rescan',
    tip: '刷新音乐库',
    strokes: [
      'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
    ],
  },
  {
    key: 'enqueue',
    tip: '全部添加至播放队列',
    strokes: ['M3.5 6H17', 'M3.5 12H14', 'M3.5 18H11', 'M18 14v6', 'M15 17h6'],
  },
  {
    key: 'bulk',
    tip: '批量操作',
    strokes: [
      'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
    ],
  },
];

const runPrimaryEntry = (key: PrimaryKey) => {
  const outcomes: Record<PrimaryKey, () => void> = {
    play: () => emit('playAll'),
    rescan: () => emit('refreshAll'),
    enqueue: () => emit('addAllToQueue'),
    bulk: () => emit('update:isBatchMode', true),
  };
  outcomes[key]();
};
</script>

<template>
  <div
    class="flex h-auto shrink-0 select-none flex-col justify-center px-6 pb-[clamp(6px,1vh,12px)] pt-[clamp(0px,0.3vh,4px)]"
  >
    <div v-if="isBatchMode" class="flex animate-in items-center justify-between fade-in slide-in-from-top-1 duration-200">
      <div class="flex gap-3 items-center">
        <button
          v-for="entry in batchEntries"
          :key="entry.key"
          class="flex items-center gap-1 rounded bg-gray-100 px-4 py-1.5 text-sm text-gray-700 transition hover:bg-gray-200 active:scale-95 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20"
          @click="runBatchEntry(entry.key)"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path v-for="(seg, idx) in entry.strokes" :key="idx" :d="seg" />
          </svg>
          {{ entry.tip }}
        </button>
      </div>
      <div class="flex gap-4 items-center">
        <button
          class="rounded px-3 py-1 text-[#EC4141] transition hover:bg-red-50 dark:hover:bg-red-500/10"
          @click="leaveBatchMode"
        >
          取消
        </button>
      </div>
    </div>

    <div v-else class="justify-between flex items-center">
      <div class="flex items-center pb-1 gap-2">
        <h2 class="text-xl font-bold text-gray-900 dark:text-white">{{ heading }}</h2>
      </div>

      <div class="flex gap-2 items-center">
        <button
          v-for="entry in primaryEntries"
          :key="entry.key"
          :class="ROUND_BUTTON"
          :title="entry.tip"
          @click="runPrimaryEntry(entry.key)"
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
