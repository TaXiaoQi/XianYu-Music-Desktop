<script setup lang="ts"> // 实现
import { computed, ref } from 'vue';
import { usePlaybackController as useStageControl } from '../../features/playback/usePlaybackController';
import { useDetailCover } from '../../composables/useDetailCover';
import CoverReflection from './detail/CoverReflection.vue';

const props = defineProps<{ isExpanded?: boolean; coverHidden?: boolean }>();

const emit = defineEmits<{ (e: 'toggle-cover'): void }>();

const { isPlaying, dominantColors } = useStageControl();
const expandFlag = computed(() => Boolean(props.isExpanded));

const {
  currentSongPath,
  displayedLocalCoverUrl,
  currentBigCoverUrl,
  showCoverPlaceholder,
  fullCoverLoading,
  bigCoverLoaded,
  onBigCoverLoad,
  onBigCoverError,
  onLocalCoverError,
} = useDetailCover({ isExpanded: expandFlag });

/** 展开时封面下方的镜面倒影取图（跟手缩略图），收起即清空 */
const reflectionSource = computed(() => {
  if (!currentSongPath.value || !expandFlag.value) {
    return '';
  }
  return displayedLocalCoverUrl.value || '';
});

/** 播放中光环投影 / 静止时常规投影 / 收起时无投影 */
const frameShadow = computed(() => {
  if (!props.isExpanded) {
    return 'none';
  }
  if (!isPlaying.value) {
    return '0 10px 20px -5px rgba(0, 0, 0, 0.4)';
  }
  return [
    '0 30px 60px -12px rgba(0, 0, 0, 0.6)',
    '0 18px 36px -18px rgba(0, 0, 0, 0.7)',
    `0 0 80px -20px ${dominantColors.value[0]}44`,
  ].join(', ');
});

const thumbTuning = computed(() => {
  if (!props.isExpanded) {
    return 'art-thumb--docked';
  }
  return fullCoverLoading.value ? 'art-thumb--soft' : 'art-thumb--crisp';
});

const fullTuning = computed(() => [
  props.isExpanded ? 'art-full--settled' : 'art-full--zoomed',
  bigCoverLoaded.value ? 'art-full--shown' : 'art-full--veiled',
]);

const stageMode = computed(() => (props.isExpanded ? 'cover-stage--open' : 'cover-stage--docked'));
const stageModeExtra = computed(() => {
  if (props.coverHidden) {
    return 'cover-stage--masked';
  }
  return props.isExpanded ? 'cover-stage--interactive' : 'cover-stage--passive';
});

const detailCoverRef = ref<HTMLDivElement | null>(null);
const exposedRefs = { detailCoverRef };
defineExpose(exposedRefs);

const onCoverActivate = (event: MouseEvent) => {
  event.stopPropagation(); // 实现
  emit('toggle-cover'); // 实现
};
</script>

<template>
  <div class="cover-host">
    <div
      ref="detailCoverRef" 
      class="cover-stage"
      :class="[stageMode, stageModeExtra]"
      :style="{ boxShadow: frameShadow, transform: 'scale(1)' }"
      @click="onCoverActivate"
    >
      <div class="art-frame">
        <img
          v-if="displayedLocalCoverUrl"
          :key="`thumb:${currentSongPath}:${displayedLocalCoverUrl}`"
          :src="displayedLocalCoverUrl"
          class="art-thumb"
          :class="thumbTuning"
          @error="onLocalCoverError"
          draggable="false"
          decoding="async"
          referrerpolicy="no-referrer"
        />
        <img
          v-if="currentBigCoverUrl"
          :key="`big:${currentSongPath}:${currentBigCoverUrl}`"
          :src="currentBigCoverUrl"
          class="art-full"
          :class="fullTuning"
          @load="onBigCoverLoad"
          @error="onBigCoverError"
          draggable="false"
          decoding="async"
          referrerpolicy="no-referrer"
        />
        <div
          v-if="showCoverPlaceholder"
          class="art-fallback bg-gradient-to-br from-zinc-100 to-zinc-200 text-zinc-400 dark:from-zinc-700 dark:to-zinc-800 dark:text-zinc-400"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            :class="props.isExpanded ? 'h-32 w-32' : 'h-6 w-6'"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path stroke-linecap="round" stroke-linejoin="round" :stroke-width="props.isExpanded ? 1 : 1.7" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        </div>
      </div>

      <CoverReflection :visible="props.isExpanded" :source="reflectionSource" />
    </div>
  </div>
</template>

<style scoped> /* 样式 */
.cover-host {
  pointer-events: none;
}

.cover-stage {
  position: absolute;
  aspect-ratio: 1 / 1;
  z-index: 70;
  transition: all 700ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

.cover-stage--open {
  top: 45%;
  left: calc(75px + 18%);
  width: clamp(220px, 45vh, 580px);
  border-radius: 1rem;
  translate: -50% -50%;
}

.cover-stage--docked {
  top: calc(100vh - 64px);
  left: 16px;
  width: 3rem;
  border-radius: 0.5rem;
}

.cover-stage--masked {
  opacity: 0;
  pointer-events: none;
}

.cover-stage--interactive {
  pointer-events: auto;
  cursor: pointer;
}

.cover-stage--passive {
  pointer-events: none;
}

.art-frame {
  position: relative;
  z-index: 20;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: inherit;
  isolation: isolate;
}

.art-thumb {
  position: absolute;
  inset: 0;
  z-index: 10;
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
  transition:
    transform 240ms ease-out, filter 240ms ease-out, opacity 240ms ease-out;
}

.art-thumb--soft {
  scale: 1.03;
  filter: blur(10px) brightness(0.9);
}

.art-thumb--crisp {
  scale: 1;
  filter: blur(0) brightness(1);
}

.art-thumb--docked {
  scale: 1.25;
  filter: blur(0) brightness(1);
}

.art-full {
  position: absolute;
  inset: 0;
  z-index: 20;
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
  transition: opacity 240ms ease-out;
}

.art-full--settled {
  scale: 1;
}

.art-full--zoomed {
  scale: 1.25;
}

.art-full--shown {
  opacity: 1;
}

.art-full--veiled {
  opacity: 0;
}

.art-fallback {
  position: absolute;
  inset: 0;
  z-index: 0;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
}
</style>
