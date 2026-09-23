<script setup lang="ts">
/**
 * 黑胶唱片皮肤容器：组合 VinylRecord + VinylTonearm，
 * 与 PlayerDetailLeft 占据同一布局位（左 40% 区域中央），
 * 封面加载逻辑复用 useDetailCover。点击唱片触发封面隐藏 toggle。
 */
import { computed, ref } from 'vue';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { useDetailCover } from '../../composables/useDetailCover';
import VinylRecord from './VinylRecord.vue';
import VinylTonearm from './VinylTonearm.vue';

const props = defineProps<{
  isExpanded?: boolean;
  coverHidden?: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle-cover'): void;
}>();

const { isPlaying, dominantColors } = usePlaybackController();
const isExpandedRef = computed(() => Boolean(props.isExpanded));

const {
  currentSongPath,
  displayedLocalCoverUrl,
  currentBigCoverUrl,
  onBigCoverLoad,
  onBigCoverError,
  onLocalCoverError,
} = useDetailCover({ isExpanded: isExpandedRef });

/** 唱片中心展示的封面：优先大图，回退缩略图 */
const labelCoverUrl = computed(() => currentBigCoverUrl.value || displayedLocalCoverUrl.value || '');

const accentColor = computed(() => dominantColors.value[0] || '#EC4141');

const detailCoverRef = ref<HTMLElement | null>(null);
defineExpose({ detailCoverRef });

const handleCoverClick = (event: MouseEvent) => {
  event.stopPropagation();
  emit('toggle-cover');
};
</script>

<template>
  <div class="pointer-events-none">
    <div
      ref="detailCoverRef"
      class="absolute aspect-square transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] z-[70] will-change-transform"
      :class="[
        props.isExpanded ? 'top-[45%] left-[calc(75px+18%)] -translate-x-1/2 -translate-y-1/2 w-[clamp(220px,45vh,580px)]' : 'top-[calc(100vh-64px)] left-[16px] translate-x-0 translate-y-0 w-12 rounded-full',
        props.coverHidden ? 'opacity-0 pointer-events-none' : (props.isExpanded ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'),
      ]"
      @click="handleCoverClick"
    >
      <!-- 大图预加载（隐藏 img，仅触发缓存加载与 onload 回调） -->
      <img
        v-if="currentBigCoverUrl"
        :key="`preload:${currentSongPath}:${currentBigCoverUrl}`"
        :src="currentBigCoverUrl"
        class="hidden"
        alt=""
        @load="onBigCoverLoad"
        @error="onBigCoverError"
        decoding="async"
        referrerpolicy="no-referrer"
      >
      <!-- 缩略图加载失败标记（不渲染，仅触发 onerror 回调） -->
      <img
        v-if="displayedLocalCoverUrl && !currentBigCoverUrl"
        :key="`thumb:${currentSongPath}:${displayedLocalCoverUrl}`"
        :src="displayedLocalCoverUrl"
        class="hidden"
        alt=""
        @error="onLocalCoverError"
        decoding="async"
        referrerpolicy="no-referrer"
      >

      <template v-if="props.isExpanded">
        <VinylRecord
          :cover="labelCoverUrl"
          :is-playing="isPlaying"
          :accent="accentColor"
          class="absolute inset-0"
        />
        <VinylTonearm
          :is-playing="isPlaying"
          :song-key="currentSongPath"
        />
      </template>
      <!-- 收起态（底栏小封面）保持普通缩略图 -->
      <div v-else class="h-full w-full overflow-hidden rounded-full">
        <img
          v-if="displayedLocalCoverUrl"
          :src="displayedLocalCoverUrl"
          class="h-full w-full object-cover"
          draggable="false"
          decoding="async"
          referrerpolicy="no-referrer"
        >
      </div>
    </div>
  </div>
</template>
