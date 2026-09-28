<script setup lang="ts">
import { Maximize2, Minimize2, Minus, Square, X } from 'lucide-vue-next';

defineProps<{
  /** 顶栏当前是否处于显现态 */
  revealed?: boolean;
  /** 详情页是否展开（控制命中与可见性） */
  shown?: boolean;
  /** 电影模式（背景视频）下顶栏中央显示曲名 */
  cinema?: boolean;
  /** 封面被隐藏时展示“显示封面”按钮 */
  maskCover?: boolean;
  /** 沉浸式全屏状态（切换按钮图标） */
  fullscreenOn?: boolean;
  /** 顶栏是否存在可展示的曲目 */
  hasTrack?: boolean;
  /** 曲目标题文案 */
  trackTitle?: string;
  /** 歌手文案 */
  trackArtist?: string;
}>();

const emit = defineEmits<{
  (e: 'collapse'): void;
  (e: 'toggle-cover'): void;
  (e: 'toggle-fullscreen'): void;
  (e: 'minimize'): void;
  (e: 'toggle-maximize'): void;
  (e: 'close-window'): void;
}>();
</script>

<template>
  <div
    class="bar-track"
    :class="[
      revealed ? 'bar-track--shown' : 'bar-track--veiled',
      shown ? 'bar-track--live' : 'bar-track--ghost',
    ]"
  >
    <div class="bar-drag" data-tauri-drag-region></div>

    <div class="bar-wing bar-wing--left">
      <button title="收起详情页" class="bar-btn" @click="emit('collapse')">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="bar-icon-lg">
          <path d="M19 9l-7 7-7-7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <button v-if="maskCover" title="显示封面" class="bar-btn bar-btn--nudge" @click="emit('toggle-cover')">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="bar-icon-sm">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      </button>
    </div>

    <div v-if="cinema && hasTrack" class="bar-heading">
      <span class="truncate text-[clamp(15px,2vh,21px)] font-semibold tracking-wide text-white drop-shadow-md">
        {{ trackTitle }}
      </span>
      <span v-if="trackArtist" class="truncate text-[clamp(11px,1.4vh,14px)] text-white/60">
        - {{ trackArtist }}
      </span>
    </div>
    <div v-else class="bar-heading-gap"></div>

    <div class="bar-wing bar-wing--right">
      <button
        :title="fullscreenOn ? '退出全屏' : '全屏'"
        :aria-label="fullscreenOn ? '退出全屏' : '全屏'"
        :aria-pressed="fullscreenOn"
        class="bar-btn"
        @click="emit('toggle-fullscreen')"
      >
        <Minimize2 v-if="fullscreenOn" :size="16" :stroke-width="2" />
        <Maximize2 v-else :size="16" :stroke-width="2" />
      </button>
      <button title="最小化" aria-label="最小化" class="bar-btn" @click="emit('minimize')">
        <Minus :size="16" :stroke-width="2" />
      </button>
      <button class="bar-btn" @click="emit('toggle-maximize')">
        <Square :size="16" :stroke-width="2" />
      </button>
      <button class="bar-btn bar-btn--danger" @click="emit('close-window')">
        <X :size="16" :stroke-width="2" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.bar-track {
  position: relative;
  display: flex;
  height: 3.5rem;
  align-items: center;
  justify-content: space-between;
  padding-inline: 1.5rem;
  transition: all 500ms ease-out;
}

.bar-track--shown {
  translate: 0 0;
  opacity: 1;
}

.bar-track--veiled {
  translate: 0 -0.75rem;
  opacity: 0;
}

.bar-track--live {
  pointer-events: auto;
}

.bar-track--ghost {
  visibility: hidden;
  pointer-events: none;
}

.bar-drag {
  position: absolute;
  inset: 0;
}

.bar-wing {
  position: relative;
  z-index: 10;
  display: flex;
  width: 25%;
  align-items: center;
  pointer-events: none;
}

.bar-wing--right {
  justify-content: flex-end;
  gap: 0.5rem;
}

.bar-btn {
  pointer-events: auto;
  border-radius: 0.5rem;
  padding: 0.5rem;
  color: rgb(255 255 255 / 0.5);
  transition:
    background-color 150ms cubic-bezier(0.4, 0, 0.2, 1),
    color 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.bar-btn:hover {
  background-color: rgb(255 255 255 / 0.1);
  color: var(--color-white);
}

.bar-btn--nudge {
  margin-left: 0.25rem;
}

.bar-btn--danger:hover {
  background-color: var(--color-red-500);
}

.bar-icon-lg {
  height: 1.5rem;
  width: 1.5rem;
}

.bar-icon-sm {
  height: 1.25rem;
  width: 1.25rem;
}

.bar-heading {
  position: relative;
  z-index: 10;
  display: flex;
  min-width: 0;
  flex: 1 1 0%;
  align-items: baseline;
  justify-content: center;
  gap: 0.625rem;
  padding-inline: 1.5rem;
  text-align: center;
  pointer-events: none;
}

.bar-heading-gap {
  flex: 1 1 0%;
  pointer-events: none;
}
</style>
