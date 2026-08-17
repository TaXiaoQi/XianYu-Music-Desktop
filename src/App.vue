<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
import { appApi } from './services/tauri/appApi';
import { defineAsyncComponent, nextTick, ref, watch, onBeforeUnmount, onMounted } from 'vue';
import { storeToRefs } from 'pinia';

import { registerImportedLyricsFonts } from './composables/lyrics';
import { useToast } from './composables/toast';
import { DESKTOP_LYRICS_WINDOW_LABEL } from './features/desktopLyrics/shared';
import { MINI_PLAYER_WINDOW_LABEL, VOLUME_POPOVER_WINDOW_LABEL } from './features/miniPlayer/shared';
import { TASKBAR_PLAYER_WINDOW_LABEL } from './features/taskbarPlayer/shared';
import { useSettings } from './features/settings/useSettings';
import { TRAY_MENU_WINDOW_LABEL } from './features/tray/actions';
import { loadPlugins, checkAllPluginUpdates, performPluginUpdate, getStoredPlugins } from './services/pluginEngine';
import { configureApplicationLogger } from './services/applicationLogger';
import { reportAppOpen } from './services/usageStats';
import { useUiStore } from './shared/stores/ui';
import { clearHeavyImageCaches } from './caches/imageCaches';
import { clearPaletteCache } from './composables/colorExtraction';
import { clearPreblurredBackgroundCache } from './composables/preblurredBackgroundCache';
import { useCoverCache } from './composables/useCoverCache';
import { setMainWindowRenderingSnapshot } from './composables/renderingPower';
import { useI18n } from './features/i18n';
import { useGlobalInterfaceLanguage } from './features/i18n/useGlobalInterfaceLanguage';
import { consumeInstallLanguage, syncLanguageToInstaller } from './features/i18n/installLanguage';
import { playerStorage } from './services/storage/playerStorage';

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
const isMainShellSleeping = ref(false);
const MainShell = defineAsyncComponent(() => import('./components/layout/MainShell.vue'));
const MiniPlayerWindow = defineAsyncComponent(() => import('./components/layout/MiniPlayerWindow.vue'));
const DesktopLyricsWindow = defineAsyncComponent(() => import('./components/player/DesktopLyricsWindow.vue'));
const TrayMenuWindow = defineAsyncComponent(() => import('./components/layout/TrayMenuWindow.vue'));
const TaskbarControlWindow = defineAsyncComponent(() => import('./components/layout/TaskbarControlWindow.vue'));
const VolumePopoverWindow = defineAsyncComponent(() => import('./components/layout/VolumePopoverWindow.vue'));

const { settings } = useSettings();
const { language, t } = useI18n();

// 为尚未迁移到类型安全词条的旧界面提供全局英文与繁体转换。
useGlobalInterfaceLanguage();

watch(language, value => {
  document.documentElement.lang = value;
  document.documentElement.dataset.language = value;
}, { immediate: true });
watch(
  () => ({ ...settings.value.logging }),
  logging => configureApplicationLogger(logging),
  { immediate: true },
);
watch(
  () => settings.value.customLyricsFonts,
  (fonts) => registerImportedLyricsFonts(fonts),
  { deep: true, immediate: true },
);

// 沉浸全屏时给 body 添加 class，CSS 全局禁用所有 data-tauri-drag-region 的指针事件，
// 防止全屏窗口被拖动（主页 TitleBar/SidebarBrand、歌词页顶栏等）。
const uiStore = useUiStore();
const { isImmersiveFullscreen, mainWindowUiSleepRequested } = storeToRefs(uiStore);
watch(isImmersiveFullscreen, (fs) => {
  document.body.classList.toggle('immersive-fullscreen', fs);
}, { immediate: true });

if (currentWindowLabel === 'main') {
  const { showToast } = useToast();
  const { clearCoverCaches } = useCoverCache();

  // 主程序语言变化时同步到注册表，使卸载器语言跟随主程序当前语言。
  watch(language, (value) => {
    void syncLanguageToInstaller(value);
  });

  let handleDevtoolsKeyDown: ((event: KeyboardEvent) => void) | null = null;
  let unlistenCloseRequested: (() => void) | null = null;
  let unlistenFocusChanged: (() => void) | null = null;
  let isUnmounted = false;

  const releaseHiddenMainWindowResources = () => {
    clearPreblurredBackgroundCache();
    clearCoverCaches();
    clearHeavyImageCaches();
    clearPaletteCache();
  };

  const enterTraySleep = async () => {
    mainWindowUiSleepRequested.value = true;
    await enterMainWindowSleep();
  };

  const enterMainWindowSleep = async () => {
    if (isMainShellSleeping.value) return;

    isMainShellSleeping.value = true;
    setMainWindowRenderingSnapshot({
      documentHidden: true,
      windowFocused: false,
      windowVisible: false,
      windowMinimized: false,
    });
    await nextTick();
    releaseHiddenMainWindowResources();
  };

  const leaveTraySleep = () => {
    mainWindowUiSleepRequested.value = false;
  };

  const leaveMainWindowSleep = () => {
    if (!isMainShellSleeping.value) return;
    isMainShellSleeping.value = false;
    setMainWindowRenderingSnapshot({
      documentHidden: document.hidden,
      windowFocused: true,
      windowVisible: true,
      windowMinimized: false,
    });
  };

  const handleDocumentVisibilityChange = () => {
    if (!document.hidden) {
      leaveTraySleep();
    }
  };

  watch(mainWindowUiSleepRequested, (sleepRequested) => {
    if (sleepRequested) {
      void enterMainWindowSleep();
    } else {
      leaveMainWindowSleep();
    }
  });

  onMounted(async () => {
    // 上报软件打开事件（fire-and-forget，失败静默），用于后台"软件打开次数/设备连接数"统计
    reportAppOpen();

    // 消费安装器写入的语言：新安装/重新安装时使界面语言与安装选择一致。
    try {
      const languageBeforeInstallRead = settings.value.language;
      const installLanguage = await consumeInstallLanguage();
      // 注册表读取是异步的。期间若用户已手动切换语言，不得用较早的安装器值覆盖。
      if (
        installLanguage
        && settings.value.language === languageBeforeInstallRead
        && settings.value.language !== installLanguage
      ) {
        settings.value.language = installLanguage;
        playerStorage.writeSettings(settings.value);
      } else if (installLanguage && settings.value.language !== languageBeforeInstallRead) {
        // consumeInstallLanguage 已更新消费标记；重新写回用户的最新选择以保持两端一致。
        void syncLanguageToInstaller(settings.value.language);
      }
    } catch (error) {
      console.error('Failed to consume install language:', error);
    }

    try {
      const version = await getVersion();
      showToast(t('toast.welcome', { version }), 'info');
    } catch (error) {
      console.error('Failed to get version for welcome toast:', error);
    }

    const closeRequestedUnlisten = await getCurrentWindow().onCloseRequested(async (event) => {
      // 开发模式下直接关闭，不走托盘隐藏；主动走 Tauri 正常退出链路，
      // 让 cargo tauri dev 能感知进程退出，避免终端和 Vite 长时间挂起
      if (import.meta.env.DEV) {
        event.preventDefault();
        await appApi.exitApp();
        return;
      }
      if (settings.value.closeToTray) {
        event.preventDefault();
        await enterTraySleep();
        await getCurrentWindow().hide();
      }
    });
    if (isUnmounted) {
      closeRequestedUnlisten();
    } else {
      unlistenCloseRequested = closeRequestedUnlisten;
    }

    const focusChangedUnlisten = await getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) {
        leaveTraySleep();
      }
    });
    if (isUnmounted) {
      focusChangedUnlisten();
    } else {
      unlistenFocusChanged = focusChangedUnlisten;
    }

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

    // F12 打开 DevTools（WebView2 已禁用浏览器快捷键，需通过自定义命令恢复）
    // 生产构建中 open_devtools 命令返回错误，invoke 被 catch 静默处理
    handleDevtoolsKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F12') {
        event.preventDefault();
        void appApi.openDevtools().catch(() => { /* 生产环境无 DevTools */ });
      }
    };
    window.addEventListener('keydown', handleDevtoolsKeyDown);
    window.addEventListener('focus', leaveTraySleep);
    document.addEventListener('visibilitychange', handleDocumentVisibilityChange);
  });

  onBeforeUnmount(() => {
    isUnmounted = true;

    if (handleDevtoolsKeyDown) {
      window.removeEventListener('keydown', handleDevtoolsKeyDown);
      handleDevtoolsKeyDown = null;
    }

    unlistenCloseRequested?.();
    unlistenCloseRequested = null;
    unlistenFocusChanged?.();
    unlistenFocusChanged = null;
    window.removeEventListener('focus', leaveTraySleep);
    document.removeEventListener('visibilitychange', handleDocumentVisibilityChange);
  });
}
</script>

<template>
  <!--
    语言变化时重建界面树，让尚未迁移到 t() 的旧模板重新生成原始中文节点。
    Pinia/播放器状态位于组件树外，不会因重建丢失；同时避免依赖整页刷新恢复文案。
  -->
  <DesktopLyricsWindow v-if="isDesktopLyricsWindow" :key="language" />
  <MiniPlayerWindow v-else-if="isMiniPlayerWindow" :key="language" />
  <TrayMenuWindow v-else-if="isTrayMenuWindow" :key="language" />
  <TaskbarControlWindow v-else-if="isTaskbarPlayerWindow" :key="language" />
  <VolumePopoverWindow v-else-if="isVolumePopoverWindow" :key="language" />
  <MainShell v-else :key="language" :sleep="isMainShellSleeping" />
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
