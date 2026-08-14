<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useCoverCache } from '../../composables/useCoverCache';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { usePlaybackStore } from '../../features/playback/store';

const props = defineProps<{
  isExpanded?: boolean;
  coverHidden?: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle-cover'): void;
}>();

const {
  currentSong, currentCover, currentCoverPath, currentCoverFull, isPlaying, dominantColors
} = usePlaybackController();
const { getFullCoverUrl, loadFullCover, preloadFullCovers, retainFullCoverPaths } = useCoverCache();
const playbackStore = usePlaybackStore();
const { playQueue, tempQueue } = storeToRefs(playbackStore);

const currentSongPath = computed(() => currentSong.value?.path ?? '');

const localCoverUrl = ref('');
const localCoverLoadFailed = ref(false);
const bigCoverLoaded = ref(false);
const fullCoverLoading = ref(false);
const reflectionCoverUrl = ref('');
let fullCoverRequestId = 0;
const currentLocalCoverUrl = computed(() => {
  if (props.isExpanded && currentCoverPath.value !== currentSongPath.value) {
    return '';
  }

  return localCoverUrl.value;
});
const currentBigCoverUrl = computed(() => (
  props.isExpanded && currentCoverFull.value && currentCoverFull.value !== currentLocalCoverUrl.value
    ? currentCoverFull.value
    : ''
));
const displayedLocalCoverUrl = computed(() => (
  localCoverLoadFailed.value ? '' : currentLocalCoverUrl.value
));
const showCoverPlaceholder = computed(() => !displayedLocalCoverUrl.value && !bigCoverLoaded.value);

const getRetainedFullCoverPaths = (path: string) => {
  if (!path) {
    return [];
  }

  const retainedPaths: string[] = [path];
  const pushUniquePath = (candidatePath: string | undefined) => {
    if (!candidatePath || retainedPaths.includes(candidatePath)) {
      return;
    }

    retainedPaths.push(candidatePath);
  };

  // Temp queue items will be played before the regular queue.
  pushUniquePath(tempQueue.value[0]?.path);

  const queue = playQueue.value;
  const currentIndex = queue.findIndex(song => song.path === path);
  if (currentIndex >= 0 && queue.length > 1) {
    pushUniquePath(queue[(currentIndex - 1 + queue.length) % queue.length]?.path);
    pushUniquePath(queue[(currentIndex + 1) % queue.length]?.path);
  }

  return retainedPaths.slice(0, 4);
};

watch(currentCover, (cover) => {
  localCoverUrl.value = cover || '';
}, { immediate: true });

watch([currentSongPath, currentLocalCoverUrl], () => {
  localCoverLoadFailed.value = false;
}, { immediate: true });

watch([currentSongPath, () => props.isExpanded], async ([path, isExpanded]) => {
  const cachedFullCoverUrl = path ? getFullCoverUrl(path) : '';
  bigCoverLoaded.value = Boolean(cachedFullCoverUrl);
  fullCoverLoading.value = false;

  if (!path || !isExpanded) {
    fullCoverRequestId += 1;
    return;
  }

  const retainedPaths = getRetainedFullCoverPaths(path);
  retainFullCoverPaths(retainedPaths);

  if (cachedFullCoverUrl) {
    currentCoverFull.value = cachedFullCoverUrl;
    preloadFullCovers(retainedPaths.filter(candidatePath => candidatePath !== path));
    return;
  }

  const requestId = ++fullCoverRequestId;
  const fullCoverLoad = loadFullCover(path);
  fullCoverLoading.value = true;
  preloadFullCovers(retainedPaths.filter(candidatePath => candidatePath !== path));

  try {
    const fullCoverUrl = await fullCoverLoad;
    if (requestId !== fullCoverRequestId || path !== currentSongPath.value || !props.isExpanded) return;
    currentCoverFull.value = fullCoverUrl || '';
    fullCoverLoading.value = false;
  } catch {
    if (requestId !== fullCoverRequestId || path !== currentSongPath.value || !props.isExpanded) return;
    currentCoverFull.value = '';
    fullCoverLoading.value = false;
  }
}, { immediate: true });

watch(() => props.isExpanded, (isExpanded) => {
  if (isExpanded) {
    return;
  }

  bigCoverLoaded.value = false;
  fullCoverLoading.value = false;
  reflectionCoverUrl.value = '';
});

watch([currentSongPath, displayedLocalCoverUrl, () => props.isExpanded], ([path, localUrl, isExpanded]) => {
  if (!path) {
    reflectionCoverUrl.value = '';
    return;
  }

  if (!isExpanded) {
    reflectionCoverUrl.value = '';
    return;
  }

  const nextReflectionUrl = localUrl || '';
  if (nextReflectionUrl === reflectionCoverUrl.value) {
    return;
  }

  reflectionCoverUrl.value = nextReflectionUrl;
}, { immediate: true });

const onBigCoverLoad = () => {
  bigCoverLoaded.value = true;
  fullCoverLoading.value = false;
};

const onBigCoverError = () => {
  bigCoverLoaded.value = false;
  fullCoverLoading.value = false;
};

const onLocalCoverError = () => {
  localCoverLoadFailed.value = true;
};

const detailCoverRef = ref<HTMLElement | null>(null);
defineExpose({ detailCoverRef });

const handleCoverClick = (event: MouseEvent) => {
  event.stopPropagation();
  emit('toggle-cover');
};
</script>

<template>
  <div class="pointer-events-none">
    
    <!-- Album Art -->
    <div
      ref="detailCoverRef"
      class="absolute aspect-square transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] z-[70] will-change-transform"
      :class="[
        props.isExpanded ? 'top-[45%] left-[calc(75px+18%)] -translate-x-1/2 -translate-y-1/2 w-[clamp(220px,45vh,580px)] rounded-2xl' : 'top-[calc(100vh-64px)] left-[16px] translate-x-0 translate-y-0 w-12 rounded-lg',
        props.coverHidden ? 'opacity-0 pointer-events-none' : (props.isExpanded ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'),
      ]"
      :style="{
        boxShadow: props.isExpanded && isPlaying
          ? `0 30px 60px -12px rgba(0,0,0,0.6), 0 18px 36px -18px rgba(0,0,0,0.7), 0 0 80px -20px ${dominantColors[0]}44`
          : (props.isExpanded ? `0 10px 20px -5px rgba(0,0,0,0.4)` : 'none'),
        transform: 'scale(1)',
      }"
      @click="handleCoverClick"
    >
      <!-- Main Cover Container -->
      <div class="w-full h-full rounded-[inherit] overflow-hidden relative isolate z-20">
        <img v-if="displayedLocalCoverUrl" :key="`thumb:${currentSongPath}:${displayedLocalCoverUrl}`" :src="displayedLocalCoverUrl" @error="onLocalCoverError" class="absolute inset-0 w-full h-full object-cover select-none transition-[transform,filter,opacity] duration-[240ms] ease-out z-10" :class="props.isExpanded ? (fullCoverLoading ? 'scale-[1.03] blur-[10px] brightness-90' : 'scale-100 blur-0 brightness-100') : 'scale-125 blur-0 brightness-100'" draggable="false" decoding="async" />
        <img v-if="currentBigCoverUrl" :key="`big:${currentSongPath}:${currentBigCoverUrl}`" :src="currentBigCoverUrl" @load="onBigCoverLoad" @error="onBigCoverError" class="absolute inset-0 w-full h-full object-cover select-none transition-opacity duration-[240ms] ease-out z-20" :class="[props.isExpanded ? 'scale-100' : 'scale-125', bigCoverLoaded ? 'opacity-100' : 'opacity-0']" draggable="false" decoding="async" />
        <div v-if="showCoverPlaceholder" class="absolute inset-0 z-0 flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200 text-zinc-400 dark:from-zinc-700 dark:to-zinc-800 dark:text-zinc-400">
          <svg xmlns="http://www.w3.org/2000/svg" :class="props.isExpanded ? 'h-32 w-32' : 'h-6 w-6'" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" :stroke-width="props.isExpanded ? 1 : 1.7" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
        </div>
      </div>

      <!-- Glass Table Reflection Layer -->
      <transition name="reflection-reveal" appear>
        <div v-if="props.isExpanded" class="absolute top-[calc(100%+2px)] left-0 w-full h-[65%] pointer-events-none z-10 reflection-wrapper rounded-[inherit] overflow-hidden">
          <!-- 清晰层：中间清晰，四周淡出 -->
          <div class="absolute inset-0 reflection-glass reflection-glass--sharp rounded-[inherit] overflow-hidden">
            <img v-if="reflectionCoverUrl" :src="reflectionCoverUrl" class="absolute top-0 left-0 w-full aspect-square object-cover scale-y-[-1]" draggable="false" decoding="async" />
          </div>
          <!-- 模糊层：只在四周边缘显示，让边缘虚化 -->
          <div class="absolute inset-0 reflection-glass reflection-glass--blur rounded-[inherit] overflow-hidden">
            <img v-if="reflectionCoverUrl" :src="reflectionCoverUrl" class="absolute top-0 left-0 w-full aspect-square object-cover scale-y-[-1]" draggable="false" decoding="async" />
          </div>
        </div>
      </transition>
    </div>

  </div>
</template>

<style scoped>
.reflection-wrapper {
  perspective: 1500px;
  transform-origin: top;
  /* rotateX(50deg) 让倒影铺在桌面上 */
  /* skewX(-15deg) 让它变成平行四边形 */
  /* scale(1.1) 补偿旋转带来的视觉缩小，确保边缘对齐 */
  transform: rotateX(40deg) skewX(-18deg) scale(1.01);
  opacity: 0.2;
}

.reflection-glass {
  /* 上下方向的淡出（垂直渐变），两层共用 */
  -webkit-mask-image: linear-gradient(
    to bottom,
    black 0%,
    rgba(0, 0, 0, 0.5) 30%,
    transparent 85%
  );
  mask-image: linear-gradient(
    to bottom,
    black 0%,
    rgba(0, 0, 0, 0.5) 30%,
    transparent 85%
  );
}

/* 清晰层：中间清晰，靠近左右/底部边缘时淡出，把边缘让给模糊层 */
.reflection-glass--sharp {
  -webkit-mask-image:
    linear-gradient(to bottom, black 0%, rgba(0, 0, 0, 0.5) 30%, transparent 85%),
    linear-gradient(to right, transparent 0%, black 18%, black 82%, transparent 100%);
  mask-image:
    linear-gradient(to bottom, black 0%, rgba(0, 0, 0, 0.5) 30%, transparent 85%),
    linear-gradient(to right, transparent 0%, black 18%, black 82%, transparent 100%);
  -webkit-mask-composite: source-in;
  mask-composite: intersect;
}

/* 模糊层：整层模糊，用径向 mask 挖空中心，只在四周边缘可见，形成边缘虚化 */
.reflection-glass--blur {
  filter: blur(4px);
  -webkit-mask-image:
    linear-gradient(to bottom, black 0%, rgba(0, 0, 0, 0.5) 30%, transparent 85%),
    radial-gradient(ellipse 62% 62% at 50% 45%, transparent 55%, black 100%);
  mask-image:
    linear-gradient(to bottom, black 0%, rgba(0, 0, 0, 0.5) 30%, transparent 85%),
    radial-gradient(ellipse 62% 62% at 50% 45%, transparent 55%, black 100%);
  -webkit-mask-composite: source-in;
  mask-composite: intersect;
}

.reflection-reveal-enter-active,
.reflection-reveal-appear-active {
  transition:
    transform 560ms cubic-bezier(0.22, 1, 0.36, 1) 220ms,
    opacity 420ms ease-out 220ms,
    filter 560ms cubic-bezier(0.22, 1, 0.36, 1) 220ms;
}

.reflection-reveal-leave-active {
  transition:
    transform 220ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 180ms ease-in,
    filter 220ms cubic-bezier(0.4, 0, 0.2, 1);
}

.reflection-reveal-enter-from,
.reflection-reveal-appear-from,
.reflection-reveal-leave-to {
  opacity: 0;
  filter: blur(10px);
}

.reflection-reveal-enter-from,
.reflection-reveal-appear-from {
  transform: translateY(-18px) rotateX(58deg) skewX(-22deg) scale(0.96);
}

.reflection-reveal-leave-to {
  transform: translateY(-10px) rotateX(48deg) skewX(-20deg) scale(0.985);
}
</style>
