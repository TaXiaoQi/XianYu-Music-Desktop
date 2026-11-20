<script setup lang="ts">
// AMLL 皮肤左列控制簇：信息行 / 进度 / 音质 / 传输五键 / 音量。
// 全部动作复用与全局底栏同源的 composable，保证行为一致；仅布局与样式为皮肤专属。
import { computed, onBeforeUnmount, ref } from 'vue';

import { usePlaybackController } from '../../../features/playback/usePlaybackController';
import { usePlaybackStore } from '../../../features/playback/store';
import { useLibraryCollections } from '../../../features/collections/useLibraryCollections';
import { useSettings } from '../../../features/settings/useSettings';
import { qualityAbbr } from '../../layout/footer/footerQuality';
import { useFooterQualityProbe } from '../../layout/footer/useFooterQualityProbe';
import type { QualityKey } from '../../../types';

defineProps<{
  title?: string;
  artist?: string;
  album?: string;
}>();

const emit = defineEmits<{ (event: 'more', payload: MouseEvent): void }>();

const {
  currentSong,
  isPlaying,
  volume,
  currentTime,
  playMode,
  currentPlayingQuality,
  sessionQualityOverride,
  setSessionQualityOverride,
  togglePlay,
  nextSong,
  prevSong,
  toggleMute,
  seekTo,
  formatDuration,
} = usePlaybackController();
const playbackStore = usePlaybackStore();
const { isFavorite, toggleFavorite } = useLibraryCollections();
const { settings } = useSettings();

// 音质探测与底栏同源：可用音质键用于切换弹层
const { footerAvailableQualityKeys, abortFooterQualityInfoProbe } = useFooterQualityProbe({
  getCurrentSong: () => currentSong.value,
  getCurrentPlayingQuality: () => currentPlayingQuality.value,
  allowRealSizeProbe: () => settings.value.audio.showRealQualitySizes === true,
});
onBeforeUnmount(() => abortFooterQualityInfoProbe());

const duration = computed(() => currentSong.value?.duration ?? 0);
const progressRatio = computed(() =>
  duration.value > 0 ? Math.min(1, Math.max(0, currentTime.value / duration.value)) : 0,
);

// —— 进度拖拽 ——
const progressRef = ref<HTMLElement | null>(null);
let progressDragging = false;

const seekFromEvent = (event: PointerEvent) => {
  const el = progressRef.value;
  if (!el || duration.value <= 0) return;
  const rect = el.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  seekTo(ratio * duration.value);
};

const onProgressDown = (event: PointerEvent) => {
  progressDragging = true;
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  seekFromEvent(event);
};
const onProgressMove = (event: PointerEvent) => {
  if (progressDragging) seekFromEvent(event);
};
const onProgressUp = () => {
  progressDragging = false;
};

// —— 音量拖拽 ——
const volumeRef = ref<HTMLElement | null>(null);
let volumeDragging = false;

const volumeFromEvent = (event: PointerEvent) => {
  const el = volumeRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  // 直接写 store 音量（handleVolume 面向滚轮事件，不接受数值）
  playbackStore.volume = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
};

const onVolumeDown = (event: PointerEvent) => {
  volumeDragging = true;
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  volumeFromEvent(event);
};
const onVolumeMove = (event: PointerEvent) => {
  if (volumeDragging) volumeFromEvent(event);
};
const onVolumeUp = () => {
  volumeDragging = false;
};

// —— 收藏（isFavorite/toggleFavorite 为按曲目取参的函数） ——
const favOn = computed(() => isFavorite(currentSong.value));
const flipFavorite = () => {
  if (currentSong.value) toggleFavorite(currentSong.value);
};

// —— 播放模式映射：0 列表循环 / 1 单曲循环 / 2 随机 ——
const shuffleOn = computed(() => playMode.value === 2);
const repeatOneOn = computed(() => playMode.value === 1);
const flipShuffle = () => {
  playbackStore.playMode = shuffleOn.value ? 0 : 2;
};
const flipRepeatOne = () => {
  playbackStore.playMode = repeatOneOn.value ? 0 : 1;
};

// —— 音质标签与切换 ——
const activeQuality = computed<QualityKey | null>(
  () => sessionQualityOverride.value ?? currentPlayingQuality.value ?? null,
);
const qualityLabel = computed(() => (activeQuality.value ? qualityAbbr(activeQuality.value) : ''));
const qualityMenuOpen = ref(false);
const pickQuality = (key: QualityKey) => {
  setSessionQualityOverride(key);
  qualityMenuOpen.value = false;
};
</script>

<template>
  <div class="amll-controls">
    <div class="amll-info">
      <div class="amll-info-text">
        <div class="amll-title truncate">{{ title }}</div>
        <div class="amll-sub truncate">{{ artist }}</div>
        <div v-if="album" class="amll-sub amll-sub--dim truncate">{{ album }}</div>
      </div>
      <div class="amll-info-actions">
        <button
          class="amll-icon-btn"
          :class="favOn ? 'amll-icon-btn--on' : ''"
          title="收藏"
          aria-label="收藏"
          @click="flipFavorite"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" :fill="favOn ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="amll-ctrl-icon"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
        </button>
        <button class="amll-icon-btn" title="更多" aria-label="更多" @click="emit('more', $event)">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none" class="amll-ctrl-icon"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
        </button>
      </div>
    </div>

    <div class="amll-progress-row">
      <div
        ref="progressRef"
        class="amll-slider"
        role="slider"
        :aria-valuenow="Math.round(progressRatio * 100)"
        @pointerdown="onProgressDown"
        @pointermove="onProgressMove"
        @pointerup="onProgressUp"
        @pointercancel="onProgressUp"
      >
        <div class="amll-slider-fill" :style="{ width: `${progressRatio * 100}%` }"></div>
      </div>
    </div>
    <div class="amll-meta-row">
      <span class="amll-time">{{ formatDuration(currentTime) }}</span>
      <button
        v-if="qualityLabel"
        class="amll-quality-tag"
        :title="'音质：' + qualityLabel"
        @click="qualityMenuOpen = !qualityMenuOpen"
      >{{ qualityLabel }}</button>
      <span class="amll-time">{{ formatDuration(duration) }}</span>
      <div v-if="qualityMenuOpen" class="amll-quality-menu">
        <button
          v-for="key in footerAvailableQualityKeys"
          :key="key"
          class="amll-quality-item"
          :class="key === activeQuality ? 'amll-quality-item--on' : ''"
          @click="pickQuality(key)"
        >{{ key }}</button>
      </div>
    </div>

    <div class="amll-transport">
      <button class="amll-transport-btn" :class="shuffleOn ? 'amll-transport-btn--on' : ''" title="随机播放" aria-label="随机播放" @click="flipShuffle">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="amll-ctrl-icon"><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></svg>
      </button>
      <button class="amll-transport-btn" title="上一首" aria-label="上一首" @click="prevSong()">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none" class="amll-ctrl-icon"><polygon points="19 20 9 12 19 4 19 20" /><rect x="5" y="4" width="2" height="16" rx="1" /></svg>
      </button>
      <button class="amll-transport-btn amll-transport-btn--play" title="播放/暂停" aria-label="播放/暂停" @click="togglePlay()">
        <svg v-if="isPlaying" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none" class="amll-ctrl-icon amll-ctrl-icon--lg"><rect x="6" y="4" width="4" height="16" rx="1.2" /><rect x="14" y="4" width="4" height="16" rx="1.2" /></svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none" class="amll-ctrl-icon amll-ctrl-icon--lg"><polygon points="7 4 20 12 7 20 7 4" /></svg>
      </button>
      <button class="amll-transport-btn" title="下一首" aria-label="下一首" @click="nextSong()">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none" class="amll-ctrl-icon"><polygon points="5 4 15 12 5 20 5 4" /><rect x="17" y="4" width="2" height="16" rx="1" /></svg>
      </button>
      <button class="amll-transport-btn" :class="repeatOneOn ? 'amll-transport-btn--on' : ''" title="单曲循环" aria-label="单曲循环" @click="flipRepeatOne">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="amll-ctrl-icon"><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /><path v-if="repeatOneOn" d="M11 10h1v4" /></svg>
      </button>
    </div>

    <div class="amll-volume-row">
      <button class="amll-icon-btn" title="静音/恢复" aria-label="静音/恢复" @click="toggleMute()">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="amll-ctrl-icon"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path v-if="volume > 0.01" d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
      </button>
      <div
        ref="volumeRef"
        class="amll-slider amll-slider--thin"
        role="slider"
        :aria-valuenow="Math.round(volume * 100)"
        @pointerdown="onVolumeDown"
        @pointermove="onVolumeMove"
        @pointerup="onVolumeUp"
        @pointercancel="onVolumeUp"
      >
        <div class="amll-slider-fill" :style="{ width: `${volume * 100}%` }"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.amll-controls {
  position: absolute;
  top: calc(var(--amll-col-top, 34%) + var(--skin-cover-size, min(50vh, 38vw)) / 2 + 20px);
  left: var(--amll-col-left, calc(75px + 18%));
  width: var(--skin-cover-size, min(50vh, 38vw));
  transform: translateX(-50%);
  z-index: 72;
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: var(--skin-text, #fff);
  font-family: var(--skin-font);
  mix-blend-mode: var(--skin-blend, normal);
}

.amll-info {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.amll-info-text {
  min-width: 0;
}

.amll-title {
  font-size: var(--skin-title-size, max(2vh, 1em));
  font-weight: 600;
  letter-spacing: 0.01em;
}

.amll-sub {
  font-size: var(--skin-meta-size, max(1.2vh, 0.8em));
  color: var(--skin-text-dim, rgba(255, 255, 255, 0.62));
}

.amll-sub--dim {
  color: var(--skin-text-faint, rgba(255, 255, 255, 0.28));
}

.amll-info-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.amll-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.2em;
  height: 2.2em;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  transition: background 140ms ease, color 140ms ease;
}

.amll-icon-btn:hover {
  background: color-mix(in srgb, currentColor 12%, transparent);
}

.amll-icon-btn--on {
  color: var(--skin-accent, #ec4141);
}

.amll-ctrl-icon {
  width: 1.15em;
  height: 1.15em;
}

.amll-ctrl-icon--lg {
  width: 1.5em;
  height: 1.5em;
}

.amll-slider {
  position: relative;
  height: 20px;
  cursor: pointer;
  touch-action: none;
  clip-path: inset(7px 0 round 100px);
  transition: clip-path 180ms ease;
}

.amll-slider:hover {
  clip-path: inset(0 round 100px);
}

.amll-slider::before {
  content: '';
  position: absolute;
  inset: 7px 0;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 22%, transparent);
  transition: inset 180ms ease;
}

.amll-slider:hover::before {
  inset: 0;
}

.amll-slider--thin {
  height: 14px;
  flex: 1;
}

.amll-slider--thin::before {
  inset: 5px 0;
}

.amll-slider--thin:hover::before {
  inset: 2px 0;
}

.amll-slider-fill {
  position: absolute;
  top: 7px;
  bottom: 7px;
  left: 0;
  border-radius: 999px;
  background: currentColor;
  transition: top 180ms ease, bottom 180ms ease;
}

.amll-slider:hover .amll-slider-fill {
  top: 0;
  bottom: 0;
}

.amll-slider--thin .amll-slider-fill {
  top: 5px;
  bottom: 5px;
}

.amll-slider--thin:hover .amll-slider-fill {
  top: 2px;
  bottom: 2px;
}

.amll-meta-row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: var(--skin-meta-size, max(1.2vh, 0.8em));
}

.amll-time {
  color: var(--skin-text-dim, rgba(255, 255, 255, 0.62));
  font-variant-numeric: tabular-nums;
}

.amll-quality-tag {
  border: none;
  border-radius: 6px;
  padding: 1px 8px;
  background: color-mix(in srgb, currentColor 14%, transparent);
  color: inherit;
  font-size: 0.85em;
  letter-spacing: 0.06em;
}

.amll-quality-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 90;
  display: flex;
  flex-direction: column;
  min-width: 96px;
  padding: 4px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--skin-text, #fff) 10%, rgba(10, 10, 14, 0.86));
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.amll-quality-item {
  border: none;
  border-radius: 7px;
  padding: 5px 10px;
  background: transparent;
  color: var(--skin-text, #fff);
  text-align: left;
  font-size: 0.9em;
}

.amll-quality-item:hover {
  background: color-mix(in srgb, var(--skin-text, #fff) 12%, transparent);
}

.amll-quality-item--on {
  color: var(--skin-accent, #ec4141);
}

.amll-transport {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4%;
  margin-top: 2px;
}

.amll-transport-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18%;
  aspect-ratio: 1 / 1;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  transition: background 140ms ease, transform 120ms ease;
}

.amll-transport-btn:hover {
  background: color-mix(in srgb, currentColor 12%, transparent);
}

.amll-transport-btn:active {
  transform: scale(0.94);
}

.amll-transport-btn--play {
  background: color-mix(in srgb, currentColor 16%, transparent);
}

.amll-transport-btn--on {
  color: var(--skin-accent, #ec4141);
}

.amll-volume-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
