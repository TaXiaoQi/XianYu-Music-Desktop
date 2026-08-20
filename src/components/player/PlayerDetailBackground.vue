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
  // 缩略图加载失败时回退到全尺寸封面（在线歌曲可能只有 currentCoverFull 有值）
  if (coverImgFailed.value && currentCoverFull.value) {
    return currentCoverFull.value;
  }
  return currentCover.value || currentCoverFull.value || '';
});

// 封面 URL 变化时重置加载失败状态，让 <img> 重新尝试加载
watch([currentCover, currentCoverFull], () => {
  coverImgFailed.value = false;
});

/** 单曲独立背景图路径（从数据库读取，每首歌可不同） */
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

/** 自定义背景图 URL：优先使用单曲背景，其次全局自定义背景 */
const customBgUrl = computed(() => {
  const path = songBgPath.value || lyricsSettings.customBackgroundImage;
  if (!path) return '';
  return path.startsWith('http') || path.startsWith('data:') || path.startsWith('asset:')
    ? path
    : convertFileSrc(path);
});

/** 背景模糊程度（0-100）：0% 时完全清晰，100% 时完全模糊 */
const backgroundBlurPx = computed(() => {
  const percent = lyricsSettings.backgroundBlur;
  // 0% → 0px（清晰），100% → 52px（完全模糊）
  return (percent / 100) * 52;
});

/** 封面背景的 filter 样式：模糊程度跟随用户设置 */
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

/**
 * 音频实际播放倍速（音效链 Rust 侧变速，50~200%）。
 * 视频必须以相同倍速播放，否则与音频进度持续漂移、被反复硬拉回。
 */
const audioPlaybackRate = computed(() => {
  const percent = soundEffectStore.playbackRate;
  const rate = typeof percent === 'number' && percent > 0 ? percent / 100 : 1;
  return Math.min(2.5, Math.max(0.25, rate));
});

/**
 * MV 自动音画对齐偏移（秒）：正值画面提前、负值画面延后。
 * 播放时间轴对齐（syncBackgroundVideo）只能保证"视频进度条 = 音频进度条"，
 * MV 片头/剪辑与音频内容的固有错位由该偏移补偿（mvAutoSync 互相关分析得出）。
 */
const syncBackgroundVideo = (force = false) => {
  const video = videoRef.value;
  if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
  // 环形取模：偏移后 target 可能为负或超过 duration，取最近一圈的位置
  const rawTarget = Math.max(0, currentTime.value) + mvSyncOffsetSec.value;
  const target = ((rawTarget % video.duration) + video.duration) % video.duration;
  // 视频循环播放：换圈瞬间 target 与 currentTime 分居 0 和 duration 两端，
  // 用环形距离避免把接缝误判成大偏差而回跳
  let drift = target - video.currentTime;
  if (Math.abs(drift) > video.duration / 2) {
    drift += drift > 0 ? -video.duration : video.duration;
  }
  if (force || Math.abs(drift) > 0.6) {
    // 大偏差（拖动进度条、缓冲停滞）：直接对齐并恢复基础倍速
    video.playbackRate = audioPlaybackRate.value;
    video.currentTime = target;
    return;
  }
  if (video.paused) {
    if (Math.abs(drift) > 0.05) video.currentTime = target;
    return;
  }
  // 小偏差（<0.12s）视为同步；中等偏差用 ±8% 内的微调倍速平滑追赶，避免可见跳帧
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
// 音频变速调整时同步视频倍速（纠偏微调会在下一帧进度同步中自动恢复）
watch(audioPlaybackRate, (rate) => {
  const video = videoRef.value;
  if (video) video.playbackRate = rate;
});
// 自动对齐分析完成（偏移变化）时立即重对齐（暂停中 currentTime 不跳动，需显式触发）
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

    <!-- 自定义背景图（用户上传）：覆盖默认封面背景 -->
    <div v-else-if="customBgUrl" class="absolute inset-0 overflow-hidden z-[1]">
      <img
        :src="customBgUrl"
        class="w-full h-full object-cover scale-110 select-none"
        :style="{ filter: coverFilterStyle }"
        draggable="false"
        decoding="async"
      />
    </div>

    <!-- 默认封面背景（无自定义背景图时显示） -->
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
