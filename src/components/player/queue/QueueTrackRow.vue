<script setup lang="ts">
import { computed } from 'vue';

import type { Song } from '../../../types';
import { getSongSourceTag } from '../../../utils/remoteSong';

const props = defineProps<{
  /** 本行对应的曲目 */
  track: Song;
  /** 是否为正在播放的一首 */
  active: boolean;
  /** 触发播放的手势：单击或双击 */
  clickMode: 'single' | 'double';
}>();

const emit = defineEmits<{
  (e: 'activate', track: Song): void;
  (e: 'eject', track: Song): void;
}>();

// 插件 / 远程链路的曲目会在标题旁标注来源
const SOURCE_SCHEMES = ['lx://', 'plugin://', 'remote://'];

const sourceTagShown = computed(() => SOURCE_SCHEMES.some(scheme => props.track.path?.startsWith(scheme)));
const sourceTag = computed(() => getSongSourceTag(props.track));
const headingText = computed(() => props.track.title || props.track.name.replace(/\.[^/.]+$/, ''));
const subText = computed(() => props.track.artist || 'Unknown Artist');

const playsOnTap = computed(() => props.clickMode === 'single');

const onTap = () => {
  if (playsOnTap.value) emit('activate', props.track);
};

const onDoubleTap = () => {
  if (!playsOnTap.value) emit('activate', props.track);
};

const onEjectPress = (event: Event) => {
  // 防止误触整行的播放手势
  event.stopPropagation();
  emit('eject', props.track);
};
</script>

<template>
  <div
    class="group relative flex cursor-default select-none items-center justify-between rounded-xl border border-transparent p-2.5 transition-all duration-200 hover:border-white/80 hover:bg-white/70 dark:hover:border-white/12 dark:hover:bg-white/10"
    @click="onTap"
    @dblclick="onDoubleTap"
  >
    <div class="flex w-8 shrink-0 items-center justify-center">
      <svg v-if="active" class="h-[18px] w-[18px] text-[#EC4141]" viewBox="0 0 24 24" fill="currentColor">
        <path d="M7 18h2V6H7v12zm4 4h2V2h-2v20zm-8-8h2v-4H3v4zm12 4h2V6h-2v12zm4-8v4h2v-4h-2z" />
      </svg>
      <svg v-else class="h-[18px] w-[18px] text-[#52647d] dark:text-white/75" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
      </svg>
    </div>

    <div class="flex min-w-0 flex-1 flex-col pr-4">
      <div class="flex min-w-0 items-center gap-1.5">
        <span class="min-w-0 truncate text-sm leading-tight" :class="active ? 'font-bold text-[#EC4141]' : 'font-medium'">{{ headingText }}</span>
        <span
          v-if="sourceTagShown"
          class="shrink-0 rounded-full border border-[#EC4141]/20 bg-[#EC4141]/10 px-1.5 py-[1px] text-[10px] font-bold text-[#EC4141]"
        >{{ sourceTag.label }}</span>
      </div>
      <span class="mt-1 truncate text-[11px] font-medium text-[#42526a] dark:text-white/80">{{ subText }}</span>
    </div>

    <div class="flex shrink-0 items-center gap-1">
      <svg class="h-[18px] w-[18px] text-[#52647d] dark:text-white/75" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20 9H4v2h16V9zM4 15h16v-2H4v2z" />
      </svg>
      <button
        class="flex h-6 w-6 items-center justify-center rounded-full text-[#52647d] transition-colors hover:bg-black/5 hover:text-red-500 active:scale-90 dark:text-white/75 dark:hover:bg-white/10"
        title="移出队列"
        @click="onEjectPress"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  </div>
</template>
