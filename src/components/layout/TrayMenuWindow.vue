<script setup lang="ts">
import {
  Heart,
  Maximize2,
  Minimize2,
  Music2,
  Pause,
  Play,
  Power,
  Repeat,
  Repeat1,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-vue-next';
import { convertFileSrc } from '@tauri-apps/api/core';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import { applyWindowMaterial, useWindowMaterial, type WindowMaterialMode } from '../../composables/windowMaterial';
import {
  APP_TRAY_MENU_EVENT,
  TRAY_MENU_READY_EVENT,
  TRAY_MENU_STATE_EVENT,
  type TrayMenuAction,
  type TrayMenuStatePayload,
} from '../../features/tray/actions';
import type { Song } from '../../types';

const appWindow = getCurrentWindow();
const { activeWindowMaterial } = useWindowMaterial();
const currentSong = ref<Song | null>(null);
const isPlaying = ref(false);
const isDarkTheme = ref(true);
const playMode = ref(0);
const isFavorite = ref(false);
const isMiniMode = ref(false);
const windowMaterial = ref<WindowMaterialMode>('none');
const windowBlurTint = ref(50);
let unlistenState: UnlistenFn | null = null;
let unlistenFocus: UnlistenFn | null = null;
let unlistenCloseRequested: UnlistenFn | null = null;

const trackTitle = computed(() => {
  const song = currentSong.value;
  if (!song) return 'XY-Music';
  return song.title || song.name.replace(/\.[^/.]+$/, '');
});

const trackArtist = computed(() => {
  const song = currentSong.value;
  if (!song) return '';
  return song.artist || '';
});

const coverUrl = computed(() => {
  const song = currentSong.value;
  if (!song?.cover_thumb_path) return '';
  const path = song.cover_thumb_path;
  if (path.startsWith('http') || path.startsWith('asset:') || path.startsWith('data:')) {
    return path;
  }
  return convertFileSrc(path);
});

const playModeConfig = computed(() => {
  switch (playMode.value) {
    case 1:
      return {
        label: '单曲循环',
        icon: Repeat1,
      };
    case 2:
      return {
        label: '随机播放',
        icon: Shuffle,
      };
    default:
      return {
        label: '列表循环',
        icon: Repeat,
      };
  }
});

const shellStyle = computed(() => {
  const resolved = activeWindowMaterial.value;
  let panelBg: string;
  if (resolved === 'mica') {
    panelBg = isDarkTheme.value ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.4)';
  } else if (resolved !== 'none') {
    panelBg = isDarkTheme.value ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.6)';
  } else {
    panelBg = isDarkTheme.value ? 'rgba(39, 40, 52, 0.98)' : 'rgba(248, 249, 252, 0.98)';
  }
  return { '--panel-bg': panelBg };
});

const sendAction = async (action: TrayMenuAction, options: { hide?: boolean } = {}) => {
  await emitTo('main', APP_TRAY_MENU_EVENT, action);
  if (options.hide !== false) {
    await appWindow.hide();
  }
};

const hideWindow = () => {
  void appWindow.hide();
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    hideWindow();
  }
};

watch([windowMaterial, windowBlurTint, isDarkTheme], async () => {
  if (isDarkTheme.value) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }

  try {
    await appWindow.setTheme(isDarkTheme.value ? 'dark' : 'light');
  } catch (error) {
    console.warn('Failed to set tray menu window theme:', error);
  }

  await applyWindowMaterial(
    windowMaterial.value,
    isDarkTheme.value,
    windowBlurTint.value,
  );
});

onMounted(async () => {
  try {
    await appWindow.setBackgroundColor([0, 0, 0, 0]);
  } catch (error) {
    console.warn('Failed to force transparent background for tray menu window:', error);
  }

  await appWindow.setAlwaysOnTop(true);
  window.addEventListener('keydown', handleKeydown);

  unlistenState = await listen<TrayMenuStatePayload>(TRAY_MENU_STATE_EVENT, (event) => {
    currentSong.value = event.payload.currentSong;
    isPlaying.value = event.payload.isPlaying;
    isDarkTheme.value = event.payload.isDarkTheme;
    playMode.value = event.payload.playMode;
    isFavorite.value = event.payload.isFavorite;
    isMiniMode.value = event.payload.isMiniMode;
    windowMaterial.value = event.payload.windowMaterial;
    windowBlurTint.value = event.payload.windowBlurTint;
  });

  unlistenFocus = await appWindow.onFocusChanged((event) => {
    if (!event.payload) {
      hideWindow();
    }
  });

  unlistenCloseRequested = await appWindow.onCloseRequested((event) => {
    event.preventDefault();
    hideWindow();
  });

  await emitTo('main', TRAY_MENU_READY_EVENT);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
  unlistenState?.();
  unlistenFocus?.();
  unlistenCloseRequested?.();
});
</script>

<template>
  <div
    class="tray-menu-shell"
    :class="[
      { 'tray-menu-shell--light': !isDarkTheme },
      { 'tray-menu-shell--material': activeWindowMaterial !== 'none' },
    ]"
    :style="shellStyle"
    @pointerdown.self="hideWindow"
  >
    <div class="tray-menu-panel">
      <section class="track-row">
        <div class="track-cover">
          <img v-if="coverUrl" :src="coverUrl" alt="" class="track-cover-img" />
          <Music2 v-else class="track-icon" :size="24" :stroke-width="2.1" />
        </div>
        <div class="track-info">
          <span class="track-title" :title="trackTitle">{{ trackTitle }}</span>
          <span v-if="trackArtist" class="track-artist" :title="trackArtist">{{ trackArtist }}</span>
        </div>
      </section>

      <section class="transport" aria-label="播放控制">
        <button
          class="transport-circle"
          :class="{ 'transport-circle--active': isFavorite }"
          title="收藏"
          @click="sendAction('toggle-favorite', { hide: false })"
        >
          <Heart :size="16" :stroke-width="2.2" :fill="isFavorite ? 'currentColor' : 'none'" />
        </button>
        <div class="transport-main">
          <button class="transport-circle" title="上一首" @click="sendAction('prev-song', { hide: false })">
            <SkipBack :size="18" :stroke-width="2.35" />
          </button>
          <button class="transport-circle transport-circle--play" title="播放/暂停" @click="sendAction('toggle-play', { hide: false })">
            <Pause v-if="isPlaying" :size="20" :stroke-width="2.5" />
            <Play v-else :size="20" :stroke-width="2.5" />
          </button>
          <button class="transport-circle" title="下一首" @click="sendAction('next-song', { hide: false })">
            <SkipForward :size="18" :stroke-width="2.35" />
          </button>
        </div>
        <button
          class="transport-circle"
          :class="{ 'transport-circle--active': playMode !== 0 }"
          :title="playModeConfig.label"
          @click="sendAction('cycle-play-mode', { hide: false })"
        >
          <component :is="playModeConfig.icon" :size="16" :stroke-width="2.2" />
        </button>
      </section>

      <div class="menu-divider" />

      <button class="menu-row" @click="sendAction('open-desktop-lyrics')">
        <span class="row-icon row-icon--text">词</span>
        <span class="row-label">桌面歌词</span>
      </button>

      <div class="menu-divider" />

      <button class="menu-row" @click="sendAction('show-mini-player')">
        <span class="row-icon">
          <component :is="isMiniMode ? Maximize2 : Minimize2" :size="18" :stroke-width="2.15" />
        </span>
        <span class="row-label">{{ isMiniMode ? '恢复主窗口' : 'mini窗口' }}</span>
      </button>

      <button class="menu-row" @click="sendAction('open-settings')">
        <span class="row-icon">
          <Settings :size="18" :stroke-width="2.15" />
        </span>
        <span class="row-label">设置</span>
      </button>

      <div class="menu-divider" />

      <button class="menu-row" @click="sendAction('quit')">
        <span class="row-icon">
          <Power :size="18" :stroke-width="2.15" />
        </span>
        <span class="row-label">退出</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.tray-menu-shell {
  --panel-bg: rgba(39, 40, 52, 0.98);
  --panel-border: rgba(255, 255, 255, 0.12);
  --text-main: rgba(245, 247, 252, 0.98);
  --text-muted: rgba(230, 233, 242, 0.85);
  --divider: rgba(255, 255, 255, 0.085);
  --hover-bg: rgba(255, 255, 255, 0.085);

  width: 210px;
  height: 268px;
  padding: 0;
  overflow: hidden;
  background: transparent;
  color: var(--text-main);
  font-family: Inter, "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  position: relative;
  user-select: none;
}

.tray-menu-shell--light {
  --panel-bg: rgba(248, 249, 252, 0.98);
  --panel-border: rgba(20, 24, 36, 0.12);
  --text-main: rgba(22, 26, 36, 0.96);
  --text-muted: rgba(40, 46, 60, 0.78);
  --divider: rgba(20, 24, 36, 0.1);
  --hover-bg: rgba(20, 24, 36, 0.07);
}

.tray-menu-shell--material .tray-menu-panel {
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.tray-menu-panel {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
  padding-bottom: 8px;
  border: 0;
  border-radius: 10px;
  background: var(--panel-bg);
  box-shadow: inset 0 0 0 1px var(--panel-border);
  backdrop-filter: blur(18px);
}

.track-row {
  display: flex;
  align-items: center;
  height: 64px;
  gap: 11px;
  padding: 6px 14px 0;
}

.track-info {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.track-cover {
  flex: 0 0 auto;
  width: 50px;
  height: 50px;
  border-radius: 8px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: var(--hover-bg);
}

.track-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.track-icon {
  color: var(--text-muted);
}

.track-title {
  min-width: 0;
  overflow: hidden;
  color: var(--text-main);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-artist {
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-divider {
  height: 1px;
  margin: 3px 13px;
  background: var(--divider);
}

.transport {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 40px;
  padding: 0 10px;
}

.transport-main {
  display: flex;
  align-items: center;
  gap: 6px;
}

.transport-circle {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 9999px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: default;
  transition: color 200ms ease, background-color 200ms ease, transform 200ms ease;
}

.menu-row {
  border: 0;
  background: transparent;
  color: var(--text-main);
  cursor: default;
}

.transport-circle--play {
  color: var(--text-main);
}

.transport-circle--active {
  color: #EC4141;
  background: rgba(236, 65, 65, 0.1);
}

.transport-circle:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-main);
  transform: scale(1.1);
}

.transport-circle--active:hover {
  color: #EC4141;
  background: rgba(236, 65, 65, 0.16);
}

.menu-row:hover {
  background: var(--hover-bg);
  color: var(--text-main);
}

.menu-row {
  display: flex;
  align-items: center;
  width: calc(100% - 12px);
  height: 32px;
  margin: 0 6px;
  gap: 9px;
  border-radius: 7px;
  padding: 0 7px;
  text-align: left;
}

.row-icon {
  display: grid;
  place-items: center;
  width: 19px;
  height: 19px;
  flex: 0 0 auto;
  color: currentColor;
}

.row-icon--text {
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
}

.row-label {
  min-width: 0;
  overflow: hidden;
  flex: 1;
  color: currentColor;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
