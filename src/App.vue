<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
import { watch, onMounted } from 'vue';
import { storeToRefs } from 'pinia';

import MainShell from './components/layout/MainShell.vue';
import MiniPlayerWindow from './components/layout/MiniPlayerWindow.vue';
import TrayMenuWindow from './components/layout/TrayMenuWindow.vue';
import DesktopLyricsWindow from './components/player/DesktopLyricsWindow.vue';
import TaskbarControlWindow from './components/layout/TaskbarControlWindow.vue';
import VolumePopoverWindow from './components/layout/VolumePopoverWindow.vue';
import { registerImportedLyricsFonts } from './composables/lyrics';
import { useToast } from './composables/toast';
import { DESKTOP_LYRICS_WINDOW_LABEL } from './features/desktopLyrics/shared';
import { MINI_PLAYER_WINDOW_LABEL, VOLUME_POPOVER_WINDOW_LABEL } from './features/miniPlayer/shared';
import { TASKBAR_PLAYER_WINDOW_LABEL } from './features/taskbarPlayer/shared';
import { useSettings } from './features/settings/useSettings';
import { TRAY_MENU_WINDOW_LABEL } from './features/tray/actions';
import { loadPlugins, checkAllPluginUpdates, performPluginUpdate } from './services/pluginEngine';
import { configureApplicationLogger } from './services/applicationLogger';
import { reportAppOpen } from './services/usageStats';
import { useUiStore } from './shared/stores/ui';

const currentWindowLabel = (() => {
  try {
    return getCurrentWindow().label;
  } catch {
    return 'main';
  }
})();

const isDesktopLyricsWindow = currentWindowLabel === DESKTOP_LYRICS_WINDOW_LABEL;
const isMiniPlayerWindow = currentWindowLabel === MINI_PLAYER_WINDOW_LABEL;
const isTrayMenuWindow = currentWindowLabel === TRAY_MENU_WINDOW_LABEL;
const isTaskbarPlayerWindow = currentWindowLabel === TASKBAR_PLAYER_WINDOW_LABEL;
const isVolumePopoverWindow = currentWindowLabel === VOLUME_POPOVER_WINDOW_LABEL;

const { settings } = useSettings();
watch(
  () => settings.value.logging,
  logging => configureApplicationLogger(logging),
  { deep: true, immediate: true },
);
watch(
  () => settings.value.customLyricsFonts,
  (fonts) => registerImportedLyricsFonts(fonts),
  { deep: true, immediate: true },
);

// 沉浸全屏时给 body 添加 class，CSS 全局禁用所有 data-tauri-drag-region 的指针事件，
// 防止全屏窗口被拖动（主页 TitleBar/SidebarBrand、歌词页顶栏等）。
const { isImmersiveFullscreen } = storeToRefs(useUiStore());
watch(isImmersiveFullscreen, (fs) => {
  document.body.classList.toggle('immersive-fullscreen', fs);
}, { immediate: true });

if (currentWindowLabel === 'main') {
  const { showToast } = useToast();

  onMounted(async () => {
    // 上报软件打开事件（fire-and-forget，失败静默），用于后台"软件打开次数/设备连接数"统计
    reportAppOpen();

    try {
      const version = await getVersion();
      showToast(`欢迎使用弦予音乐，当前版本 v${version}`, 'info');
    } catch (error) {
      console.error('Failed to get version for welcome toast:', error);
    }

    await getCurrentWindow().onCloseRequested(async (event) => {
      if (settings.value.closeToTray) {
        event.preventDefault();
        await getCurrentWindow().hide();
      }
    });

    // 启动时加载插件（尊重懒加载设置）
    const pluginConfig = settings.value.plugins;
    void loadPlugins(pluginConfig.lazyLoad).then(async () => {
      // 启动时自动检查并更新插件
      if (!pluginConfig.autoUpdateOnStartup) return;
      try {
        const results = await checkAllPluginUpdates();
        let updated = 0;
        for (const [id, result] of results) {
          if (result.hasUpdate && result.newScript) {
            const { getStoredPlugins } = await import('./services/pluginEngine');
            const plugin = getStoredPlugins().find(p => p.id === id);
            if (plugin) {
              const updateResult = await performPluginUpdate(plugin, result);
              if (updateResult.success) updated++;
            }
          }
        }
        if (updated > 0) {
          showToast(`已自动更新 ${updated} 个插件`, 'success');
        }
      } catch (error) {
        console.error('[AutoUpdate] 插件自动更新失败:', error);
      }
    });
  });
}
</script>

<template>
  <DesktopLyricsWindow v-if="isDesktopLyricsWindow" />
  <MiniPlayerWindow v-else-if="isMiniPlayerWindow" />
  <TrayMenuWindow v-else-if="isTrayMenuWindow" />
  <TaskbarControlWindow v-else-if="isTaskbarPlayerWindow" />
  <VolumePopoverWindow v-else-if="isVolumePopoverWindow" />
  <MainShell v-else />
</template>

<style>
html,
body,
#app {
  -webkit-user-select: none;
  user-select: none;
}

input,
textarea,
[contenteditable="true"] {
  -webkit-user-select: text;
  user-select: text;
}

/* 沉浸全屏时禁用所有拖动区域，防止窗口被拖动。
   仅禁用 drag-region 元素自身的指针事件以阻止 Tauri 原生拖动，
   子元素（按钮、输入框等）恢复 pointer-events: auto 保持可交互。 */
body.immersive-fullscreen [data-tauri-drag-region] {
  pointer-events: none !important;
}
body.immersive-fullscreen [data-tauri-drag-region] * {
  pointer-events: auto;
}

/* 沉浸全屏切换动画：主页容器与歌词页同步播放 scale 动画，
   盖住原生 maximize→SetWindowPos 的尺寸跳变。全局样式供 MainShell 与 PlayerDetail 共用。 */
.fs-entering {
  animation: fs-enter 320ms cubic-bezier(0.22, 1, 0.36, 1);
  transform-origin: center center;
}

.fs-exiting {
  animation: fs-exit 320ms cubic-bezier(0.22, 1, 0.36, 1);
  transform-origin: center center;
}

@keyframes fs-enter {
  0% {
    transform: scale(0.94);
    opacity: 0.82;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes fs-exit {
  0% {
    transform: scale(1);
    opacity: 1;
  }
  100% {
    transform: scale(0.94);
    opacity: 0.82;
  }
}
</style>
