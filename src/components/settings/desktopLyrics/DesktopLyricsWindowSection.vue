<script setup lang="ts">
import { emit } from '@tauri-apps/api/event';
import { ref } from 'vue';

import { useLyrics } from '../../../composables/lyrics';
import { DESKTOP_LYRICS_RESET_BOUNDS_EVENT } from '../../../features/desktopLyrics/shared';
import DesktopLyricsSwitchRow from './DesktopLyricsSwitchRow.vue';

const { desktopLyricsSettings } = useLyrics();

const windowToggles = [
  {
    key: 'alwaysOnTop',
    label: '窗口置顶',
    read: () => desktopLyricsSettings.isAlwaysOnTop,
    write: (on: boolean) => {
      desktopLyricsSettings.isAlwaysOnTop = on;
    },
  },
  {
    key: 'shadowBackground',
    label: '始终显示阴影背景',
    read: () => desktopLyricsSettings.alwaysShowShadowBackground,
    write: (on: boolean) => {
      desktopLyricsSettings.alwaysShowShadowBackground = on;
    },
  },
  {
    key: 'hideOnFullscreen',
    label: '全屏时自动隐藏',
    read: () => desktopLyricsSettings.autoHideWhenFullscreen,
    write: (on: boolean) => {
      desktopLyricsSettings.autoHideWhenFullscreen = on;
    },
  },
  {
    key: 'hideOnPaused',
    label: '暂停时自动隐藏',
    read: () => desktopLyricsSettings.autoHideWhenPaused,
    write: (on: boolean) => {
      desktopLyricsSettings.autoHideWhenPaused = on;
    },
  },
  {
    key: 'locked',
    label: '锁定位置并启用鼠标穿透',
    read: () => desktopLyricsSettings.isLocked,
    write: (on: boolean) => {
      desktopLyricsSettings.isLocked = on;
    },
  },
  {
    key: 'persistLock',
    label: '记住锁定状态',
    read: () => desktopLyricsSettings.persistLock,
    write: (on: boolean) => {
      desktopLyricsSettings.persistLock = on;
    },
  },
  {
    key: 'centered',
    label: '桌面歌词自动居中',
    read: () => desktopLyricsSettings.centerHorizontally,
    write: (on: boolean) => {
      desktopLyricsSettings.centerHorizontally = on;
    },
  },
];

const isResettingWindowBounds = ref(false);

async function resetWindowBounds() {
  if (isResettingWindowBounds.value) return;

  isResettingWindowBounds.value = true;
  try {
    await emit(DESKTOP_LYRICS_RESET_BOUNDS_EVENT);
  } finally {
    isResettingWindowBounds.value = false;
  }
}
</script>

<template>
  <section class="wr-section">
    <h2 class="wr-title"><span class="wr-tick"></span>显示与行为</h2>
    <div class="wr-card">
      <DesktopLyricsSwitchRow
        v-for="item in windowToggles"
        :key="item.key"
        :label="item.label"
        :checked="item.read()"
        @toggle="item.write"
      />

      <div class="wr-row"><div><div class="wr-row-label">重置窗口位置</div></div>
        <button type="button" class="wr-reset" :disabled="isResettingWindowBounds" @click="resetWindowBounds">
          {{ isResettingWindowBounds ? '重置中...' : '重置' }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.wr-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.wr-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  line-height: 1.25rem;
  font-weight: 700;
  color: #1f2937;
}
:global(.dark) .wr-title {
  color: #e5e7eb;
}
.wr-tick {
  height: 16px;
  width: 4px;
  border-radius: 9999px;
  background: #ec4141;
}
.wr-card {
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(229, 231, 235, 0.4);
}
:global(.dark) .wr-card {
  background: rgba(0, 0, 0, 0.1);
  border-color: rgba(31, 41, 55, 0.4);
}

.wr-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  text-align: left;
  transition: background-color 160ms ease;
}
.wr-row:hover {
  background: rgba(255, 255, 255, 0.4);
}
:global(.dark) .wr-row:hover {
  background: rgba(255, 255, 255, 0.1);
}
.wr-row-label {
  font-size: 0.875rem;
  line-height: 1.25rem;
  font-weight: 500;
  color: #1f2937;
}
:global(.dark) .wr-row-label {
  color: #e5e7eb;
}

.wr-reset {
  flex-shrink: 0;
  border: 1px solid rgba(236, 65, 65, 0.14);
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.06);
  padding: 8px 14px;
  color: #ec4141;
  font-size: 12px;
  transition: border-color 160ms ease, background-color 160ms ease, color 160ms ease;
}
.wr-reset:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}
</style>
