<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { Song } from '../../../types';

// 播控条中部曲目信息：封面（点击唤回主窗口）+ 标题跑马灯 + 歌手名。
const props = defineProps<{
  coverUrl: string;
  song: Song | null;
}>();

defineEmits<{
  (event: 'cover-activated'): void;
}>();

const headlineLane = ref<HTMLElement | null>(null);
const headlineTrack = ref<HTMLElement | null>(null);
const headlineOverflows = ref(false);

const headline = computed(() => (props.song ? (props.song.title || props.song.name) : 'XianYu Music'));
const subline = computed(() => (props.song ? props.song.artist : '享受音乐时光'));

const syncHeadlineOverflow = () => {
  void nextTick(() => {
    if (headlineTrack.value && headlineLane.value) {
      headlineOverflows.value = headlineTrack.value.scrollWidth > headlineLane.value.clientWidth;
    } else {
      headlineOverflows.value = false;
    }
  });
};

watch([() => props.song, () => props.coverUrl], () => syncHeadlineOverflow(), { immediate: true });
</script>

<template>
  <div class="pointer-events-none mr-4 flex min-w-0 flex-1 items-center gap-2.5">
    <div
      class="group/cover pointer-events-auto relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-white/5 bg-white/5 text-white/40"
      @mousedown.stop.prevent
      @click.stop="$emit('cover-activated')"
    >
      <img
        v-if="coverUrl"
        :src="coverUrl"
        class="h-full w-full object-cover transition-all duration-200 group-hover/cover:scale-[0.96] group-hover/cover:brightness-[0.75]"
        draggable="false"
        decoding="async"
      />
      <svg
        v-else
        xmlns="http://www.w3.org/2000/svg"
        class="h-[18px] w-[18px] transition-all duration-200 group-hover/cover:scale-[0.96] group-hover/cover:brightness-[0.75]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M9 18V5l12-2v13"></path>
        <circle cx="6" cy="18" r="3"></circle>
        <circle cx="18" cy="16" r="3"></circle>
      </svg>

      <div class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity duration-200 ease-out group-hover/cover:opacity-100">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4 stroke-[2.5] text-white"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </div>
    </div>

    <div class="flex min-w-0 flex-col leading-tight">
      <div
        ref="headlineLane"
        class="relative w-full max-w-[110px] overflow-hidden truncate text-xs font-semibold text-white/95"
      >
        <div
          ref="headlineTrack"
          class="inline-block whitespace-nowrap"
          :class="{ 'headline-marquee': headlineOverflows }"
        >
          {{ headline }}
        </div>
      </div>

      <div class="w-full max-w-[110px] truncate text-[10px] text-white/50">
        {{ subline }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.headline-marquee {
  display: inline-block;
  padding-left: 20px;
  animation: headline-slide 8s linear infinite;
}

@keyframes headline-slide {
  0% { transform: translate3d(0, 0, 0); }
  50% { transform: translate3d(-35%, 0, 0); }
  100% { transform: translate3d(0, 0, 0); }
}
</style>
