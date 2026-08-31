<script setup lang="ts">
import type { DesktopLyricsAction } from '../../features/desktopLyrics/shared';

const props = withDefaults(
  defineProps<{
    isPlaying: boolean;
    isLocked?: boolean;
    isHoveringLock?: boolean;
    isFavorite?: boolean;
  }>(),
  {
    isLocked: false,
    isHoveringLock: false,
    isFavorite: false,
  }
);

const emit = defineEmits<{
  (e: 'action', action: DesktopLyricsAction): void;
}>();

function emitAction(action: DesktopLyricsAction) {
  emit('action', action);
}
</script>

<template>
  <!-- 锁定态：只在光标接近顶部中央时浮现解锁按钮 -->
  <div
    v-if="props.isLocked"
    class="locked-unlock-row"
    @mousedown.stop
  >
    <button
      v-show="props.isHoveringLock"
      class="chrome-button"
      title="解锁桌面歌词"
      @click="emitAction({ type: 'update-settings', patch: { isLocked: false } })"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-[15px] w-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 9.9-1" />
      </svg>
    </button>
  </div>

  <!-- 未锁定：完整面板控件（顶行 logo + 锁/关，底行 设置 + 播放控制 + 收藏） -->
  <template v-else>
    <div class="chrome-top-row" @mousedown.stop>
      <span class="chrome-logo" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-[13px] w-[13px]" viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 18.5a3.5 3.5 0 1 1-2-3.16V5.72a1 1 0 0 1 .76-.97l9.5-2.3a1 1 0 0 1 1.24.97v11.4a3.5 3.5 0 1 1-2-3.16V6.28l-7.5 1.82v10.4Z" />
        </svg>
      </span>

      <span class="chrome-top-actions">
        <button class="chrome-button" title="锁定桌面歌词" @click="emitAction({ type: 'update-settings', patch: { isLocked: true } })">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-[15px] w-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </button>
        <button class="chrome-button" title="关闭桌面歌词" @click="emitAction({ type: 'close' })">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-[15px] w-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </span>
    </div>

    <div class="chrome-bottom-row" @mousedown.stop>
      <button class="chrome-button" title="桌面歌词设置" @click="emitAction({ type: 'open-settings' })">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
      </button>

      <span class="chrome-transport">
        <button class="transport-button" title="上一首" @click="emitAction({ type: 'prev-song' })">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-[14px] w-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 6v12" />
            <path d="M17 7 9.5 12 17 17V7Z" />
          </svg>
        </button>

        <button class="transport-button transport-button--primary" :title="props.isPlaying ? '暂停' : '播放'" @click="emitAction({ type: 'toggle-play' })">
          <svg v-if="props.isPlaying" xmlns="http://www.w3.org/2000/svg" class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M9 6v12M15 6v12" />
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-[17px] w-[17px]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5.5v13l10-6.5-10-6.5Z" />
          </svg>
        </button>

        <button class="transport-button" title="下一首" @click="emitAction({ type: 'next-song' })">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-[14px] w-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 6v12" />
            <path d="M7 7l7.5 5L7 17V7Z" />
          </svg>
        </button>
      </span>

      <button
        class="chrome-button"
        :class="{ 'chrome-button--favorite': props.isFavorite }"
        :title="props.isFavorite ? '取消收藏' : '添加到收藏'"
        @click="emitAction({ type: 'toggle-favorite' })"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-[16px] w-[16px]" viewBox="0 0 24 24" :fill="props.isFavorite ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
        </svg>
      </button>
    </div>
  </template>
</template>

<style scoped>
/* 顶行：logo 居左，锁/关居右（覆盖在面板背景之上） */
.chrome-top-row {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 0;
  pointer-events: none;
  color: rgba(255, 255, 255, 0.82);
}

.chrome-top-row > * {
  pointer-events: auto;
}

.chrome-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.92);
  background:
    linear-gradient(145deg, color-mix(in srgb, var(--desktop-accent-a) 46%, transparent), color-mix(in srgb, var(--desktop-accent-c) 30%, transparent)),
    rgba(255, 255, 255, 0.12);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
}

.chrome-top-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* 底行：设置居左，播放控制居中，收藏居右 */
.chrome-bottom-row {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 0 12px 8px;
  pointer-events: none;
  color: rgba(255, 255, 255, 0.82);
}

.chrome-bottom-row > * {
  pointer-events: auto;
}

.chrome-bottom-row > .chrome-button:last-child {
  justify-self: end;
}

.chrome-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.78);
  transition: color 160ms ease, background-color 160ms ease, transform 160ms ease;
}

.chrome-button:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.13);
}

.chrome-button--favorite {
  color: var(--favorite-color, #f56c6c);
}

.chrome-button--favorite:hover {
  color: var(--favorite-color, #f56c6c);
  background: color-mix(in srgb, var(--favorite-color, #f56c6c) 16%, transparent);
}

/* 中间播放控制：细描边圆（对齐 QQ 音乐桌面歌词），中间主键更大 */
.chrome-transport {
  display: inline-flex;
  align-items: center;
  gap: 14px;
}

.transport-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  border: 1.5px solid rgba(255, 255, 255, 0.55);
  color: rgba(255, 255, 255, 0.88);
  transition: color 160ms ease, border-color 160ms ease, background-color 160ms ease, transform 160ms ease;
}

.transport-button:hover {
  color: #ffffff;
  border-color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.1);
}

.transport-button--primary {
  width: 44px;
  height: 44px;
}

.transport-button--primary:hover {
  transform: scale(1.05);
}

/* 锁定态解锁按钮行 */
.locked-unlock-row {
  position: absolute;
  top: 8px;
  left: 50%;
  z-index: 20;
  transform: translateX(-50%);
  pointer-events: none;
}

.locked-unlock-row .chrome-button {
  pointer-events: auto;
  background: rgba(30, 30, 32, 0.72);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
}
</style>
