<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';
import { usePlayer } from '../../features/playback';
import { useSoundEffectStore } from '../../features/playback/soundEffectStore';
import { lyricsSettings } from '../../composables/lyrics';
import { fileApi } from '../../services/tauri/fileApi';
import { useBilibiliVideoBackground } from '../../composables/useBilibiliVideoBackground';

const props = defineProps<{
  bgOpacity?: number;
  active?: boolean;
}>();

const { dominantColors, currentCover, currentCoverFull, currentSongPath, currentTime, isPlaying } = usePlayer();
const {
  active: videoBackgroundActive,
  videoUrl: backgroundVideoUrl,
  syncOffsetSec: mvSyncOffsetSec,
} = useBilibiliVideoBackground();
const soundEffectStore = useSoundEffectStore();
const videoRef = ref<HTMLVideoElement | null>(null);
const videoPlaybackFailed = ref(false);
const coverImgFailed = ref(false);

const viewportArea = ref(
  typeof window !== 'undefined' ? window.innerWidth * window.innerHeight : 0
);
const isLargeViewport = computed(() => viewportArea.value >= 2000000);

const updateViewportArea = () => {
  viewportArea.value = window.innerWidth * window.innerHeight;
};

const thumbCoverUrl = computed(() => {
  if (!(props.active ?? true)) return '';
  if (coverImgFailed.value && currentCoverFull.value) {
    return currentCoverFull.value;
  }
  return currentCover.value || currentCoverFull.value || '';
});

watch([currentCover, currentCoverFull], () => {
  coverImgFailed.value = false;
});

const songBgPath = ref<string | null>(null);

let fetchSeq = 0;
async function fetchSongBackground(path: string | null) {
  if (!path) {
    songBgPath.value = null;
    return;
  }
  const seq = ++fetchSeq;
  try {
    const result = await fileApi.getSongBackground(path);
    if (seq === fetchSeq) {
      songBgPath.value = result;
    }
  } catch {
    if (seq === fetchSeq) {
      songBgPath.value = null;
    }
  }
}

watch(currentSongPath, (path) => fetchSongBackground(path), { immediate: true });

const customBgUrl = computed(() => {
  const path = songBgPath.value || lyricsSettings.customBackgroundImage;
  if (!path) return '';
  return path.startsWith('http') || path.startsWith('data:') || path.startsWith('asset:')
    ? path
    : convertFileSrc(path);
});

const backgroundBlurPx = computed(() => {
  const percent = lyricsSettings.backgroundBlur;
  return (percent / 100) * 52;
});

const coverFilterStyle = computed(() => {
  const blur = backgroundBlurPx.value;
  if (blur === 0) return 'brightness(0.78) saturate(1.42) contrast(1.16)';
  return `blur(${blur}px) brightness(0.78) saturate(1.42) contrast(1.16)`;
});

const showBackgroundVideo = computed(() => (
  (props.active ?? true)
  && videoBackgroundActive.value
  && Boolean(backgroundVideoUrl.value)
  && !videoPlaybackFailed.value
));

const audioPlaybackRate = computed(() => {
  const percent = soundEffectStore.playbackRate;
  const rate = typeof percent === 'number' && percent > 0 ? percent / 100 : 1;
  return Math.min(2.5, Math.max(0.25, rate));
});

const syncBackgroundVideo = (force = false) => {
  const video = videoRef.value;
  if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
  const rawTarget = Math.max(0, currentTime.value) + mvSyncOffsetSec.value;
  const target = ((rawTarget % video.duration) + video.duration) % video.duration;
  let drift = target - video.currentTime;
  if (Math.abs(drift) > video.duration / 2) {
    drift += drift > 0 ? -video.duration : video.duration;
  }
  if (force || Math.abs(drift) > 0.6) {
    video.playbackRate = audioPlaybackRate.value;
    video.currentTime = target;
    return;
  }
  if (video.paused) {
    if (Math.abs(drift) > 0.05) video.currentTime = target;
    return;
  }
  const nudge = Math.abs(drift) <= 0.12
    ? 0
    : Math.max(-0.08, Math.min(0.08, drift * 0.5));
  const nextRate = audioPlaybackRate.value * (1 + nudge);
  if (Math.abs(video.playbackRate - nextRate) > 0.001) {
    video.playbackRate = nextRate;
  }
};

const updateVideoPlayback = () => {
  const video = videoRef.value;
  if (!video) return;
  if (showBackgroundVideo.value && isPlaying.value) {
    video.playbackRate = audioPlaybackRate.value;
    void video.play().catch(() => {});
  } else {
    video.pause();
  }
};

watch(backgroundVideoUrl, async () => {
  videoPlaybackFailed.value = false;
  await nextTick();
  syncBackgroundVideo(true);
  updateVideoPlayback();
});
watch([isPlaying, () => props.active, showBackgroundVideo], updateVideoPlayback);
watch(currentTime, () => syncBackgroundVideo(false));
watch(audioPlaybackRate, (rate) => {
  const video = videoRef.value;
  if (video) video.playbackRate = rate;
});
watch(mvSyncOffsetSec, () => syncBackgroundVideo(true));

const handleVideoLoaded = () => {
  syncBackgroundVideo(true);
  updateVideoPlayback();
};

const handleVideoError = () => {
  videoPlaybackFailed.value = true;
};

onMounted(() => {
  window.addEventListener('resize', updateViewportArea);
  updateViewportArea();
});

onUnmounted(() => {
  window.removeEventListener('resize', updateViewportArea);
});
</script>

<template>
  <div
    class="absolute inset-0 z-0 overflow-hidden pointer-events-none select-none"
    :style="{ opacity: props.bgOpacity ?? 1, transition: 'opacity 350ms cubic-bezier(0.4, 0, 0.2, 1)' }"
  >
    <div class="absolute inset-0 bg-[#0b1222] z-0"></div>

    <div
      class="absolute inset-0 transition-colors duration-[1200ms]"
      :class="isLargeViewport ? 'opacity-[0.04]' : 'opacity-[0.06]'"
      :style="{ backgroundColor: dominantColors[0] }"
    ></div>

    <div v-if="showBackgroundVideo" class="absolute inset-0 overflow-hidden z-[1]">
      <video
        ref="videoRef"
        :src="backgroundVideoUrl"
        class="h-full w-full object-cover select-none"
        :style="{ filter: coverFilterStyle }"
        muted
        loop
        playsinline
        preload="auto"
        @loadedmetadata="handleVideoLoaded"
        @error="handleVideoError"
      ></video>
    </div>

    <div v-else-if="customBgUrl" class="absolute inset-0 overflow-hidden z-[1]">
      <img
        :src="customBgUrl"
        class="w-full h-full object-cover scale-110 select-none"
        :style="{ filter: coverFilterStyle }"
        draggable="false"
        decoding="async"
      />
    </div>

    <div v-else-if="thumbCoverUrl" class="absolute inset-0 overflow-hidden z-[1]">
      <img
        :key="`bg-cover:${currentSongPath}:${thumbCoverUrl}`"
        :src="thumbCoverUrl"
        class="w-full h-full object-cover scale-110 select-none"
        :style="{ filter: coverFilterStyle }"
        draggable="false"
        decoding="async"
        @error="coverImgFailed = true"
        referrerpolicy="no-referrer"
      />
    </div>

    <div class="absolute inset-0 z-[2]" :style="{ background: `radial-gradient(circle at 24% 16%, ${dominantColors[1] || dominantColors[0]}22 0%, transparent 52%)` }"></div>
    <div class="absolute inset-0 z-[3]" :style="{ background: `radial-gradient(circle at 78% 84%, ${dominantColors[2] || dominantColors[0]}18 0%, transparent 62%)` }"></div>
    <div class="absolute inset-0 z-[4]" :style="{ background: `radial-gradient(circle at 50% 48%, ${dominantColors[0]}10 0%, transparent 58%)` }"></div>

    <div class="absolute inset-0 bg-gradient-to-r from-black/6 via-transparent to-black/6 z-[18]"></div>
    <div class="absolute inset-0 bg-gradient-to-b from-black/3 via-transparent to-black/22 z-20"></div>
  </div>
</template>
