<script setup lang="ts">
import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { computed, onMounted, onUnmounted, reactive, watch } from 'vue';

import { applyWindowMaterial, useWindowMaterial, type WindowMaterialMode } from '../../composables/windowMaterial';
import { applyDarkClassWithTransition } from '../../composables/themeTransition';
import {
  type TrayMenuAction, type TrayMenuStatePayload,
  APP_TRAY_MENU_EVENT, TRAY_MENU_READY_EVENT, TRAY_MENU_STATE_EVENT,
} from '../../features/tray/actions';
import type { Song } from '../../types';

import TrayCommandList from './tray/TrayCommandList.vue';
import TrayTrackHeader from './tray/TrayTrackHeader.vue';
import TrayTransportDock from './tray/TrayTransportDock.vue';

const hostWindow = getCurrentWindow();
const { activeWindowMaterial } = useWindowMaterial();

const panel = reactive({
  track: null as Song | null,
  spinning: false,
  darkChrome: true,
  loopMode: 0,
  markedFavorite: false,
  shrunkToMini: false,
  material: 'none' as WindowMaterialMode,
  blurTint: 50,
});

const ingestSnapshot = (snapshot: TrayMenuStatePayload) => {
  panel.track = snapshot.currentSong;
  panel.spinning = snapshot.isPlaying;
  panel.darkChrome = snapshot.isDarkTheme;
  panel.loopMode = snapshot.playMode;
  panel.markedFavorite = snapshot.isFavorite;
  panel.shrunkToMini = snapshot.isMiniMode;
  panel.material = snapshot.windowMaterial;
  panel.blurTint = snapshot.windowBlurTint;
};

const chromeVars = computed(() => {
  const resolved = activeWindowMaterial.value;
  const daylight = !panel.darkChrome;
  let backdrop: string;
  if (resolved === 'mica') {
    backdrop = daylight ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.08)';
  } else if (resolved !== 'none') {
    backdrop = daylight ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.25)';
  } else {
    backdrop = daylight ? 'rgba(248, 249, 252, 0.98)' : 'rgba(39, 40, 52, 0.98)';
  }
  return { '--trayPanelBg': backdrop };
});

const hideWindow = () => { void hostWindow.hide(); };

const dispatch = async (action: TrayMenuAction, opts: { keepOpen?: boolean } = {}) => {
  await emitTo(
    'main',
    APP_TRAY_MENU_EVENT,
    action,
  );
  if (opts.keepOpen !== true) {
    await hostWindow.hide();
  }
};

const onKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  hideWindow();
};

const releaseHooks: Array<() => void> = [];

watch([() => panel.material, () => panel.blurTint, () => panel.darkChrome], async () => {
  applyDarkClassWithTransition(panel.darkChrome);

  try {
    await hostWindow.setTheme(panel.darkChrome ? 'dark' : 'light');
  } catch (error) {
    console.warn('Failed to set tray menu window theme:', error);
  }

  await applyWindowMaterial(
    panel.material,
    panel.darkChrome,
    panel.blurTint,
  );
});

onMounted(async () => {
  try {
    await hostWindow
      .setBackgroundColor([0, 0, 0, 0]);
  } catch (error) {
    console.warn(
      'Failed to force transparent background for tray menu window:',
      error,
    );
  }

  await hostWindow.setAlwaysOnTop(true);
  window.addEventListener('keydown', onKeydown);

  releaseHooks.push(await listen<TrayMenuStatePayload>(TRAY_MENU_STATE_EVENT, (event) => {
    ingestSnapshot(event.payload);
  }));

  releaseHooks.push(await hostWindow.onFocusChanged((focused) => {
    if (!focused) hideWindow();
  }));

  releaseHooks.push(await hostWindow.onCloseRequested((request) => {
    request.preventDefault();
    hideWindow();
  }));

  await emitTo('main', TRAY_MENU_READY_EVENT);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  releaseHooks.splice(0).forEach((off) => off());
});
</script>

<template>
  <div
    class="trayStage"
    :class="{
      'trayStage--daylight': !panel.darkChrome,
      'trayStage--composited': activeWindowMaterial !== 'none',
    }"
    :style="chromeVars"
    @pointerdown.self="hideWindow"
  >
    <div class="trayCard">
      <TrayTrackHeader :track="panel.track" />

      <TrayTransportDock
        :playing="panel.spinning"
        :favorite="panel.markedFavorite"
        :loop-mode="panel.loopMode"
        @favorite="dispatch('toggle-favorite', { keepOpen: true })"
        @previous="dispatch('prev-song', { keepOpen: true })"
        @toggle="dispatch('toggle-play', { keepOpen: true })"
        @advance="dispatch('next-song', { keepOpen: true })"
        @cycle-loop="dispatch('cycle-play-mode', { keepOpen: true })"
      />

      <div class="trayStretch" />

      <TrayCommandList
        :mini-mode="panel.shrunkToMini"
        @lyrics="dispatch('open-desktop-lyrics')"
        @toggle-mini="dispatch('show-mini-player')"
        @settings="dispatch('open-settings')"
        @quit="dispatch('quit')"
      />
    </div>
  </div>
</template>

<style scoped>
.trayStage {
  --trayPanelBg: rgba(39, 40, 52, 0.98); --trayEdge: rgba(255, 255, 255, 0.12);
  --trayInk: rgba(245, 247, 252, 0.98); --trayInkSoft: rgba(230, 233, 242, 0.85);
  --trayRule: rgba(255, 255, 255, 0.085); --trayHover: rgba(255, 255, 255, 0.085);

  position: fixed; inset: 0; padding: 0; overflow: hidden;
  background: transparent; color: var(--trayInk);
  font-family: Inter, "Segoe UI", system-ui,
    -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility; user-select: none;
}

.trayStage--daylight {
  --trayPanelBg: rgba(248, 249, 252, 0.98); --trayEdge: rgba(20, 24, 36, 0.12);
  --trayInk: rgba(22, 26, 36, 0.96); --trayInkSoft: rgba(40, 46, 60, 0.78);
  --trayRule: rgba(20, 24, 36, 0.1); --trayHover: rgba(20, 24, 36, 0.07);
}

.trayStage--composited .trayCard { backdrop-filter: none; -webkit-backdrop-filter: none; }

.trayCard {
  position: absolute; top: 0; left: 0; right: 0;
  width: 100%; height: 100%; box-sizing: border-box;
  overflow: hidden; padding-bottom: 8px; border: 0; border-radius: 10px;
  background: var(--trayPanelBg);
  box-shadow: inset 0 0 0 1px var(--trayEdge);
  backdrop-filter: blur(18px); display: flex; flex-direction: column;
}

.trayStretch { flex: 1 1 auto; min-height: 0; }
</style>
