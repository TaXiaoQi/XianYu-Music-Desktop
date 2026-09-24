<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';
import { usePlayer } from '../../features/playback';
import { useSoundEffectStore } from '../../features/playback/soundEffectStore';
import { usePlaybackStore } from '../../features/playback/store';
import { playbackApi } from '../../services/tauri/playbackApi';
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
  audioTakenOver: mvAudioTakenOver,
  notifyPlayable: mvNotifyPlayable,
  notifyVideoError: mvNotifyVideoError,
  reportBuffered: mvReportBuffered,
} = useBilibiliVideoBackground();
const soundEffectStore = useSoundEffectStore();
const playbackStore = usePlaybackStore();
const videoRef = ref<HTMLVideoElement | null>(null);
const videoPlaybackFailed = ref(false);
const coverImgFailed = ref(false);

// --- MV 音频接管：把音频交给 MV 自带音轨（等功率交叉淡化，与移动端一致） ---
const mvTargetVolume = () =>
  Math.min(1, Math.max(0, Number(playbackStore.volume) / 100 || 0));

let crossfadeRaf = 0;
// 是否真正启动过接管淡化（video 元素就绪并取消静音）。
// 立即接管在 start 时置标记，video 元素可能尚未挂载——还原时只有真正
// 动过歌曲通道才需要恢复，避免把正常播放的歌曲音量拖到 0 再拉回。
let mvAudioEngaged = false;

function stopCrossfade() {
  if (crossfadeRaf) {
    cancelAnimationFrame(crossfadeRaf);
    crossfadeRaf = 0;
  }
}

// 等功率交叉淡化：歌曲通道增益按 cos 衰减、MV 音轨音量按 sin 上升（反向
// 同步，单时钟驱动两条曲线），全程总响度基本恒定，听感无「凹坑」。
// [toMv]=true 为接管（歌曲→MV），false 为释放（MV→歌曲）。
function equalPowerCrossfade(toMv: boolean, userVol: number, durMs: number): Promise<void> {
  return new Promise((resolve) => {
    stopCrossfade();
    const t0 = performance.now();
    const step = (now: number) => {
      const video = videoRef.value;
      if (!video) {
        crossfadeRaf = 0;
        resolve();
        return;
      }
      const t = Math.min(1, (now - t0) / durMs);
      const k = t * Math.PI / 2;
      video.volume = toMv
        ? Math.min(1, userVol * Math.sin(k))
        : Math.max(0, userVol * Math.cos(k));
      void playbackApi.setVolume(
        toMv ? userVol * Math.cos(k) : userVol * Math.sin(k),
      );
      if (t < 1) {
        crossfadeRaf = requestAnimationFrame(step);
      } else {
        crossfadeRaf = 0;
        resolve();
      }
    };
    crossfadeRaf = requestAnimationFrame(step);
  });
}

// 接管/还原串行队列：start 重开时同一帧内 false→true 连续翻转，
// 必须先等释放淡化走完（含末尾静音/复位）再执行接管，否则接管的
// 幂等检查会误判「已接管」而跳过，导致 MV 静音。
let crossfadeQueue: Promise<void> = Promise.resolve();
function enqueueCrossfade(op: () => Promise<void>): Promise<void> {
  crossfadeQueue = crossfadeQueue.then(op).catch(() => {});
  return crossfadeQueue;
}

// 接管：取消视频静音，歌曲通道与 MV 音轨等功率交叉（二者同源同曲，过渡无缝）。
async function engageMvAudioTakeover() {
  const video = videoRef.value;
  if (!video) return;
  if (video.muted === false) return; // 已接管，幂等
  mvAudioEngaged = true;
  const userVol = mvTargetVolume();
  video.muted = false;
  video.volume = 0;
  await equalPowerCrossfade(true, userVol, 420);
}

// 还原：MV 音轨快速淡出的同时歌曲通道淡入，随后静音视频。
async function releaseMvAudioTakeover() {
  const wasEngaged = mvAudioEngaged;
  mvAudioEngaged = false;
  const video = videoRef.value;
  if (video && video.muted === false) {
    if (wasEngaged) await equalPowerCrossfade(false, mvTargetVolume(), 180);
    video.muted = true;
    video.volume = 0;
    return;
  }
  // 无可操作的视频元素（如组件卸载中）但歌曲通道已被接管压低：直接恢复。
  if (wasEngaged) await playbackApi.setVolume(mvTargetVolume());
}

// 接管状态切换 → 触发交叉淡入淡出（串行排队，防重开时释放/接管互踩）。
watch(mvAudioTakenOver, (on) => {
  void enqueueCrossfade(on ? engageMvAudioTakeover : releaseMvAudioTakeover);
});

// 接管中用户调音量 → 同步 MV 音轨（歌曲通道已被静音）。
watch(
  () => playbackStore.volume,
  () => {
    const video = videoRef.value;
    if (mvAudioTakenOver.value && video && video.muted === false) {
      video.volume = mvTargetVolume();
    }
  },
);

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
  // 视频就绪时若已判定接管（起播即接管）：从这里启动等功率交叉淡化——
  // 接管标记置位时 video 元素可能尚未挂载，淡化只能等此刻补执行。
  if (mvAudioTakenOver.value && videoRef.value?.muted) {
    void enqueueCrossfade(engageMvAudioTakeover);
  }
};

const handleVideoError = () => {
  videoPlaybackFailed.value = true;
  mvNotifyVideoError();
  // 视频出错导致 MV 无声时，还原歌曲音频，避免静音失声。
  if (mvAudioTakenOver.value) mvAudioTakenOver.value = false;
};

// 流式缓冲进度：相对当前播放位置的可播秒数（供底栏 title 显示）。
const handleVideoProgress = () => {
  const video = videoRef.value;
  if (!video || !video.buffered.length) return;
  mvReportBuffered(video.buffered.end(video.buffered.length - 1) - video.currentTime);
};

const handleVideoCanPlay = () => mvNotifyPlayable();

onMounted(() => {
  window.addEventListener('resize', updateViewportArea);
  updateViewportArea();
});

onUnmounted(() => {
  window.removeEventListener('resize', updateViewportArea);
  if (mvAudioTakenOver.value) mvAudioTakenOver.value = false;
  void playbackApi.setVolume(mvTargetVolume());
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
        @progress="handleVideoProgress"
        @canplay="handleVideoCanPlay"
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
