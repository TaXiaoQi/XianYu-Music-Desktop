<script setup lang="ts">
import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { onMounted, onUnmounted, reactive, watch } from 'vue';

import { applyDarkClassWithTransition } from '../../composables/themeTransition';
import { windowApi } from '../../services/tauri/windowApi';
import {
  type TrayMenuAction, type TrayMenuStatePayload,
  APP_TRAY_MENU_EVENT, TRAY_MENU_READY_EVENT, TRAY_MENU_STATE_EVENT,
} from '../../features/tray/actions';
import type { Song } from '../../types';

import TrayCommandList from './tray/TrayCommandList.vue';
import TrayTrackHeader from './tray/TrayTrackHeader.vue';
import TrayTransportDock from './tray/TrayTransportDock.vue';

const hostWindow = getCurrentWindow();

const panel = reactive({
  track: null as Song | null,
  spinning: false,
  darkChrome: true,
  loopMode: 0,
  markedFavorite: false,
  shrunkToMini: false,
});

const ingestSnapshot = (snapshot: TrayMenuStatePayload) => {
  panel.track = snapshot.currentSong;
  panel.spinning = snapshot.isPlaying;
  panel.darkChrome = snapshot.isDarkTheme;
  panel.loopMode = snapshot.playMode;
  panel.markedFavorite = snapshot.isFavorite;
  panel.shrunkToMini = snapshot.isMiniMode;
};

const hideWindow = () => {
  // 收起即停关外捕获（幂等）；钩子触发的关闭由 Rust 侧自行卸载
  void windowApi.stopTrayMouseCapture().catch(() => { /* 窗口可能已销毁 */ });
  void hostWindow.hide();
};

// —— 关外守卫：不依赖焦点的兜底关闭 ——
// 托盘点击后进程常拿不到前台激活权，失焦事件不可靠；这里轮询前台
// 窗口归属：前台不属于本应用且离开了弹出瞬间的基准窗口（说明用户
// 点去了别处），就收起菜单。窗口内部点击、本应用其他窗口聚焦都不算。
let foregroundBaseline: number | null = null;

const pollForegroundGuard = async () => {
  try {
    if (!(await hostWindow.isVisible())) return;
    const info = await windowApi.describeForegroundWindow();
    if (info.owned_by_app) return;
    if (foregroundBaseline === null) {
      foregroundBaseline = info.hwnd;
      return;
    }
    if (info.hwnd === foregroundBaseline) return;
    hideWindow();
  } catch {
    // 窗口销毁等瞬态错误忽略
  }
};

const dispatch = async (action: TrayMenuAction, opts: { keepOpen?: boolean } = {}) => {
  await emitTo(
    'main',
    APP_TRAY_MENU_EVENT,
    action,
  );
  if (opts.keepOpen !== true) {
    hideWindow();
  }
};

const onKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  hideWindow();
};

const releaseHooks: Array<() => void> = [];

// 上游基准：托盘窗不碰任何原生窗口属性——材质/主题下发（背景色/
// setEffects/阴影）会在 show+setFocus 之后把刚建立的前台剥掉，失焦
// 关闭随之失效；明暗只走 CSS 类
watch(() => panel.darkChrome, () => {
  applyDarkClassWithTransition(panel.darkChrome);
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
    foregroundBaseline = null; // 每次弹出重新采样基准前台
    ingestSnapshot(event.payload);
  }));

  releaseHooks.push(await hostWindow.onFocusChanged((focused) => {
    if (!focused) hideWindow();
  }));

  releaseHooks.push(await hostWindow.onCloseRequested((request) => {
    request.preventDefault();
    hideWindow();
  }));

  // 关外守卫轮询：窗口隐藏时仅做 isVisible 短路，开销可忽略
  const guardTimer = window.setInterval(() => { void pollForegroundGuard(); }, 150);
  releaseHooks.push(() => window.clearInterval(guardTimer));

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
    :class="{ 'trayStage--daylight': !panel.darkChrome }"
    @pointerdown.self="hideWindow"
  >
    <div class="trayCard" @pointerdown.self="hideWindow">
      <TrayTrackHeader :track="panel.track" @pointerdown="hideWindow" />

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

      <div class="trayStretch" @pointerdown.self="hideWindow" />

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
