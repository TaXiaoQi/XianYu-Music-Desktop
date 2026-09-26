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
import { usePluginHostStore } from './features/pluginHost/store';
import { TRAY_MENU_WINDOW_LABEL } from './features/tray/actions';
import { loadPlugins, checkAllPluginUpdates, performPluginUpdate, getStoredPlugins } from './services/domain/pluginEngine';
import { configureApplicationLogger } from './services/applicationLogger';
import { reportAppOpen } from './services/domain/usageStats';
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
import { usePlaylistSync } from './composables/usePlaylistSync';
import { useAuthStore } from './features/auth/store';
import { useDlnaCastStore } from './features/playback/castStore';
import { useSleepTimer } from './features/sleepTimer/useSleepTimer';

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

const uiStore = useUiStore();
const { isImmersiveFullscreen, mainWindowUiSleepRequested } = storeToRefs(uiStore);
watch(isImmersiveFullscreen, (fs) => {
  document.body.classList.toggle('immersive-fullscreen', fs);
}, { immediate: true });

if (currentWindowLabel === 'main') {
  const { showToast } = useToast();
  const { clearCoverCaches } = useCoverCache();
  const playlistSync = usePlaylistSync();
  const authStore = useAuthStore();

  usePluginHostStore();

  watch(() => authStore.isLoggedIn, (loggedIn) => {
    if (loggedIn) {
      void playlistSync.syncOnLoginSuccess();
      playlistSync.checkAutoSync();
    }
  });

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

  // 睡眠定时：应用内活动监听 + 每秒心跳 + 后端到点事件；「隐藏到托盘」复用上面的托盘睡眠路径
  useSleepTimer({
    onHideToTray: () => {
      void enterTraySleep();
      void getCurrentWindow().hide();
    },
  });

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
    reportAppOpen();

    if (currentWindowLabel === 'main') {
      void useDlnaCastStore().init();
    }

    playlistSync.initAutoSync();

    try {
      const languageBeforeInstallRead = settings.value.language;
      const installLanguage = await consumeInstallLanguage();
      if (
        installLanguage
        && settings.value.language === languageBeforeInstallRead
        && settings.value.language !== installLanguage
      ) {
        settings.value.language = installLanguage;
        playerStorage.writeSettings(settings.value);
      } else if (installLanguage && settings.value.language !== languageBeforeInstallRead) {
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

    const pluginConfig = settings.value.plugins;
    void loadPlugins(pluginConfig.lazyLoad).then(async () => {
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

body.immersive-fullscreen [data-tauri-drag-region] {
  pointer-events: none !important;
}
body.immersive-fullscreen [data-tauri-drag-region] * {
  pointer-events: auto;
}

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
