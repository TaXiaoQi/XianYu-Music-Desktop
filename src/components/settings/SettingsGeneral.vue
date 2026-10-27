<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Check, ChevronDown, FolderOpen } from 'lucide-vue-next';
import { open } from '@tauri-apps/plugin-dialog';
import { useSettings } from '../../features/settings/useSettings';
import { playerStorage } from '../../services/storage/playerStorage';
import { toolboxApi } from '../../services/tauri/toolboxApi';
import { usePlayer } from '../../features/playback';
import { useToast } from '../../composables/toast';
import { appApi } from '../../services/tauri/appApi';
import { playbackApi } from '../../services/tauri/playbackApi';
import { remoteLibraryApi } from '../../services/tauri/remoteLibraryApi';
import type { RemoteCacheUsage } from '../../types';
import ConfirmModal from '../overlays/ConfirmModal.vue';
import SettingHint from './SettingHint.vue';
import { useI18n } from '../../features/i18n';
import { usePerformanceMode } from '../../composables/usePerformanceMode';
import { AUDIO_FILE_ASSOCIATION_EXTENSIONS, audioFileAssociationLabel } from '../../features/settings/audioFileAssociations';
import type { AppLanguage, PerformanceMode } from '../../types';

const { settings, patchSettings } = useSettings();
const {
  pauseSong,
  libraryScanProgress,
} = usePlayer();
const { showToast } = useToast();
const { t } = useI18n();

const appLanguage = computed({
  get: () => settings.value.language,
  set: (value: AppLanguage) => {
    if (settings.value.language === value) return;
    patchSettings({ language: value });
    playerStorage.writeSettings(settings.value);
  },
});

const languageOptions = computed<{ value: AppLanguage; label: string }[]>(() => [
  { value: 'zh-CN', label: t('language.zhCN') },
  { value: 'zh-TW', label: t('language.zhTW') },
  { value: 'en-US', label: t('language.enUS') },
]);

const isLanguageDropdownOpen = ref(false);
const languageDropdownRef = ref<HTMLElement | null>(null);

const currentLanguageLabel = computed(() => {
  if (appLanguage.value === 'system') return t('language.system');
  const current = languageOptions.value.find((opt) => opt.value === appLanguage.value);
  return current?.label ?? t('language.zhCN');
});

const selectLanguageOption = (value: AppLanguage) => {
  appLanguage.value = value;
  isLanguageDropdownOpen.value = false;
};

const handleLanguageDropdownOutsideClick = (event: MouseEvent) => {
  if (
    isLanguageDropdownOpen.value
    && languageDropdownRef.value
    && !languageDropdownRef.value.contains(event.target as Node)
  ) {
    isLanguageDropdownOpen.value = false;
  }
};

onMounted(() => {
  window.addEventListener('mousedown', handleLanguageDropdownOutsideClick);
  window.addEventListener('mousedown', handlePerformanceModeDropdownOutsideClick);
});

onUnmounted(() => {
  window.removeEventListener('mousedown', handleLanguageDropdownOutsideClick);
  window.removeEventListener('mousedown', handlePerformanceModeDropdownOutsideClick);
});

const launchOnStartup = computed({
  get: () => settings.value.launchOnStartup,
  set: (value: boolean) => {
    if (settings.value.launchOnStartup === value) return;
    patchSettings({ launchOnStartup: value });
    playerStorage.writeSettings(settings.value);
    void appApi.setLaunchOnStartup(value).catch((error) => {
      console.error('Failed to update launch on startup:', error);
    });
  },
});

const showWelcomeToastOnStartup = computed({
  get: () => settings.value.showWelcomeToastOnStartup,
  set: (value: boolean) => {
    if (settings.value.showWelcomeToastOnStartup === value) return;
    patchSettings({ showWelcomeToastOnStartup: value });
    playerStorage.writeSettings(settings.value);
  },
});

// 进页面时以系统真实状态为准：用户可能在任务管理器「启动」页里手动关掉了自启。
const syncLaunchOnStartupFromSystem = async () => {
  try {
    const enabled = await appApi.getLaunchOnStartup();
    if (settings.value.launchOnStartup !== enabled) {
      patchSettings({ launchOnStartup: enabled });
    }
  } catch {
    // 非 Tauri 环境静默忽略
  }
};

// --- 音频文件关联（仅 Windows）：勾选哪些格式出现在系统「打开方式」列表 ---
const isWindowsPlatform = computed(() => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return ua.includes('Windows');
});

const showFileAssocPanel = ref(false);

const associatedExtensions = computed<string[]>(
  () => settings.value.audioFileAssociations ?? [],
);

const isExtensionAssociated = (ext: string) => associatedExtensions.value.includes(ext);

const toggleFileAssociation = (ext: string, next: boolean) => {
  const current = associatedExtensions.value;
  const updated = next
    ? [...new Set([...current, ext])]
    : current.filter((item) => item !== ext);
  patchSettings({ audioFileAssociations: updated });
  playerStorage.writeSettings(settings.value);
  void appApi
    .setAudioFileAssociations(next ? [ext] : [], next ? [] : [ext])
    .catch((error) => {
      console.error('Failed to update audio file association:', error);
      showToast(t('toast.gpuFailed'), 'error');
    });
};

const setAllFileAssociations = (enabled: boolean) => {
  const all: string[] = [...AUDIO_FILE_ASSOCIATION_EXTENSIONS];
  const current = associatedExtensions.value;
  const added = enabled ? all.filter((ext) => !current.includes(ext)) : [];
  const removed = enabled ? [] : current.filter((ext) => all.includes(ext));
  patchSettings({ audioFileAssociations: enabled ? all : [] });
  playerStorage.writeSettings(settings.value);
  void appApi.setAudioFileAssociations(added, removed).catch((error) => {
    console.error('Failed to update audio file associations:', error);
  });
};

const syncFileAssociationsFromSystem = async () => {
  if (!isWindowsPlatform.value) return;
  try {
    const enabled = await appApi.getAudioFileAssociations();
    patchSettings({ audioFileAssociations: enabled });
  } catch {
    // 非 Tauri 环境或读取失败时保留本地值
  }
};

async function handleGpuAccelerationChange() {
  const previous = settings.value.gpuAcceleration;
  const next = !previous;

  settings.value.gpuAcceleration = next;

  try {
    await toolboxApi.setGpuAcceleration(next);
    showToast(t('toast.gpuUpdated'), 'success');
  } catch (error) {
    settings.value.gpuAcceleration = previous;
    showToast(t('toast.gpuFailed'), 'error');
    console.error('Failed to update GPU acceleration setting:', error);
  }
}
const showClearAllDataConfirm = ref(false);
const isClearingAllData = ref(false);

// --- 性能模式：auto 自动检测 / full 满特效 / performance 性能优先 ---
const { effectiveMode } = usePerformanceMode();

const autoEffectiveLabel = computed(() => {
  return effectiveMode.value === 'high' ? t('general.pmFull') : t('general.pmPerformance');
});

const performanceModeOptions = computed<{ value: PerformanceMode; label: string }[]>(() => [
  { value: 'auto', label: `${t('general.pmAuto')} (${autoEffectiveLabel.value})` },
  { value: 'full', label: t('general.pmFull') },
  { value: 'performance', label: t('general.pmPerformance') },
]);

const performanceMode = computed<PerformanceMode>(() =>
  (settings.value as { performanceMode?: PerformanceMode })?.performanceMode ?? 'auto',
);

const isPerformanceModeDropdownOpen = ref(false);
const performanceModeDropdownRef = ref<HTMLElement | null>(null);

const currentPerformanceModeLabel = computed(() => {
  const current = performanceModeOptions.value.find((opt) => opt.value === performanceMode.value);
  return current?.label ?? t('general.pmAuto');
});

const selectPerformanceModeOption = (value: PerformanceMode) => {
  if (performanceMode.value !== value) {
    patchSettings({ performanceMode: value });
  }
  isPerformanceModeDropdownOpen.value = false;
};

const handlePerformanceModeDropdownOutsideClick = (event: MouseEvent) => {
  if (
    isPerformanceModeDropdownOpen.value
    && performanceModeDropdownRef.value
    && !performanceModeDropdownRef.value.contains(event.target as Node)
  ) {
    isPerformanceModeDropdownOpen.value = false;
  }
};

const isLibraryScanActive = computed(
  () => !!libraryScanProgress.value && !libraryScanProgress.value.done
);

// --- 在线播放流式缓存管理 ---
const streamCacheCurrent = ref(0);
const streamCacheMax = ref(0);
const isClearingStreamCache = ref(false);

const formatStreamCacheBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const refreshStreamCacheInfo = async () => {
  try {
    const info = await playbackApi.getStreamCacheInfo();
    streamCacheCurrent.value = info.current;
    streamCacheMax.value = info.max;
  } catch {
    // 非 Tauri 环境静默忽略
  }
};

const patchStreamCacheSize = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const mb = Math.max(1, Math.min(10240, Math.round(parseFloat(target.value) || 1)));
  target.value = String(mb);
  settings.value.audio.streamCacheSizeMB = mb;
  void playbackApi.setStreamCacheMaxSize(mb * 1024 * 1024).then(refreshStreamCacheInfo);
};

const chooseStreamCacheDir = async () => {
  const selected = await open({ directory: true, multiple: false, title: '选择缓存目录' });
  if (selected && typeof selected === 'string') {
    settings.value.audio.streamCacheDir = selected;
    void playbackApi.setStreamCacheDir(selected);
  }
};

const resetStreamCacheDir = () => {
  settings.value.audio.streamCacheDir = '';
  void playbackApi.setStreamCacheDir('');
};

const handleClearStreamCache = async () => {
  if (isClearingStreamCache.value) return;
  isClearingStreamCache.value = true;
  try {
    await playbackApi.clearStreamCache();
    await refreshStreamCacheInfo();
    showToast(t('toast.cacheCleared'), 'success');
  } catch (error) {
    console.error('Failed to clear stream cache:', error);
    showToast(t('toast.cacheClearFailed'), 'error');
  } finally {
    isClearingStreamCache.value = false;
  }
};

// --- 远程音乐库（WebDAV）缓存管理（自设置-音乐库页迁入，统一在存储管理区） ---
const remoteCacheMeter = ref<RemoteCacheUsage | null>(null);
const isClearingRemoteCache = ref(false);

const refreshRemoteCacheInfo = async () => {
  try {
    remoteCacheMeter.value = await remoteLibraryApi.getRemoteCacheUsage();
  } catch {
    // 非 Tauri 环境静默忽略
  }
};

const handleClearRemoteCache = async () => {
  if (isClearingRemoteCache.value) return;
  isClearingRemoteCache.value = true;
  try {
    remoteCacheMeter.value = await remoteLibraryApi.clearRemoteCache();
    showToast('远程缓存已清理', 'success');
  } catch (error) {
    console.error('Failed to clear remote cache:', error);
    showToast('清理远程缓存失败', 'error');
  } finally {
    isClearingRemoteCache.value = false;
  }
};

const openClearAllDataConfirm = () => {
  if (isClearingAllData.value || isLibraryScanActive.value) {
    return;
  }

  showClearAllDataConfirm.value = true;
};

const handleClearAllData = async () => {
  if (isClearingAllData.value) {
    return;
  }

  isClearingAllData.value = true;

  try {
    await pauseSong().catch(() => {});
    await appApi.clearAllAppData();
    localStorage.clear();
    sessionStorage.clear();
    window.location.reload();
  } catch (error) {
    console.error('Failed to clear all app data:', error);
    showToast(t('toast.resetFailed'), 'error');
    showClearAllDataConfirm.value = false;
    isClearingAllData.value = false;
  }
};

onMounted(() => {
  void syncLaunchOnStartupFromSystem();
  void syncFileAssociationsFromSystem();
  void playbackApi.setStreamCacheMaxSize(settings.value.audio.streamCacheSizeMB * 1024 * 1024)
    .then(refreshStreamCacheInfo);
  if (settings.value.audio.streamCacheDir) {
    void playbackApi.setStreamCacheDir(settings.value.audio.streamCacheDir);
  }
  void refreshRemoteCacheInfo();
});
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300"> 

    <section class="relative z-20 space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200"> 
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span> 
        {{ t('language.section') }} 
      </h2>
      <div class="rounded-xl border border-gray-200/40 bg-white/20 dark:border-gray-800/40 dark:bg-black/10">
        <div class="flex items-center justify-between gap-5 p-4 transition-colors hover:bg-white/40 dark:hover:bg-white/10 rounded-xl">
          <div class="min-w-0"> 
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200"> 
              {{ t('language.label') }} 
            </div>
            <div class="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400"> 
              {{ t('language.description') }} 
            </div>
          </div>
          <div ref="languageDropdownRef" class="relative w-40 shrink-0 sm:w-44">
            <button
              type="button"
              :aria-expanded="isLanguageDropdownOpen"
              :aria-label="t('language.label')" 
              @click="isLanguageDropdownOpen = !isLanguageDropdownOpen"
              class="flex h-9 w-full items-center min-w-[176px] justify-between rounded-lg border border-black/10 bg-white/55 px-3 text-xs font-medium text-gray-800 outline-none transition hover:bg-white/75 focus:border-[#EC4141]/50 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-100 dark:hover:bg-white/15"
            >
              <span class="truncate">{{ currentLanguageLabel }}</span>
              <ChevronDown
                class="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 dark:text-gray-500"
                :class="{ 'rotate-180': isLanguageDropdownOpen }"
              />
            </button>

            <Transition name="settings-dropdown">
              <div
                v-if="isLanguageDropdownOpen"
                class="absolute right-0 top-full z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-black/10 bg-white/90 p-1 text-xs shadow-xl backdrop-blur-2xl dark:border-white/10 dark:bg-[#262626]/95"
              >
                <button
                  type="button"
                  @click="selectLanguageOption('system')"
                  class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left font-medium transition-colors"
                  :class="appLanguage === 'system'
                    ? 'bg-[#EC4141]/10 text-[#EC4141] dark:bg-[#EC4141]/20 dark:text-[#ff8b8b]'
                    : 'text-gray-700 hover:bg-black/5 dark:text-gray-200 dark:hover:bg-white/10'"
                >
                  <span class="truncate">{{ t('language.system') }}</span>
                  <Check
                    v-if="appLanguage === 'system'"
                    class="h-3.5 w-3.5 shrink-0 text-[#EC4141] dark:text-[#ff8b8b]"
                  />
                </button>
                <div class="my-1 h-px bg-black/5 dark:bg-white/10"></div>
                <button
                  v-for="option in languageOptions"
                  :key="option.value"
                  type="button"
                  @click="selectLanguageOption(option.value)"
                  class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left font-medium transition-colors"
                  :class="appLanguage === option.value
                    ? 'bg-[#EC4141]/10 text-[#EC4141] dark:bg-[#EC4141]/20 dark:text-[#ff8b8b]'
                    : 'text-gray-700 hover:bg-black/5 dark:text-gray-200 dark:hover:bg-white/10'"
                >
                  <span class="truncate">{{ option.label }}</span>
                  <Check
                    v-if="appLanguage === option.value"
                    class="h-3.5 w-3.5 shrink-0 text-[#EC4141] dark:text-[#ff8b8b]"
                  />
                </button>
              </div>
            </Transition>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-3"> 
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2"> 
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span> 
        {{ t('general.section') }} 
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.launchOnStartup') }}</div> 
          </div>
          <button type="button" @click="launchOnStartup = !launchOnStartup" class="glass-switch" :class="{ 'is-checked': launchOnStartup }"></button>
        </div>

        <div v-if="launchOnStartup" class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.launchOnStartupMinimized') }}</div>
          </div>
          <button type="button" @click="settings.launchOnStartupMinimized = !settings.launchOnStartupMinimized" class="glass-switch" :class="{ 'is-checked': settings.launchOnStartupMinimized }"></button>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.checkUpdates') }}</div> 
          </div>
          <button type="button" @click="settings.checkUpdateOnStartup = !settings.checkUpdateOnStartup" class="glass-switch" :class="{ 'is-checked': settings.checkUpdateOnStartup }"></button>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.welcomeToast') }}</div>
          </div>
          <button type="button" @click="showWelcomeToastOnStartup = !showWelcomeToastOnStartup" class="glass-switch" :class="{ 'is-checked': showWelcomeToastOnStartup }"></button>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.gpuAcceleration') }}</div> 
          </div>
          <button type="button" @click="handleGpuAccelerationChange" class="glass-switch" :class="{ 'is-checked': settings.gpuAcceleration }"></button>
        </div>

        <div class="p-4 flex items-center justify-between gap-4 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div class="min-w-0 flex-1 pr-2">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.performanceMode') }}</div>
            <div class="mt-0.5 text-xs text-gray-400 dark:text-gray-500 break-words leading-relaxed">{{ t('general.performanceModeHint') }}</div>
          </div>
          <div ref="performanceModeDropdownRef" class="relative w-40 shrink-0 sm:w-48">
            <button
              type="button"
              :aria-expanded="isPerformanceModeDropdownOpen"
              :aria-label="t('general.performanceMode')"
              @click="isPerformanceModeDropdownOpen = !isPerformanceModeDropdownOpen"
              class="flex h-9 w-full items-center min-w-[176px] justify-between rounded-lg border border-black/10 bg-white/55 px-3 text-xs font-medium text-gray-800 outline-none transition hover:bg-white/75 focus:border-[#EC4141]/50 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-100 dark:hover:bg-white/15"
            >
              <span class="truncate">{{ currentPerformanceModeLabel }}</span>
              <ChevronDown
                class="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 dark:text-gray-500"
                :class="{ 'rotate-180': isPerformanceModeDropdownOpen }"
                :stroke-width="2.2"
              />
            </button>

            <Transition name="settings-dropdown">
              <div
                v-if="isPerformanceModeDropdownOpen"
                class="absolute right-0 top-full z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-black/10 bg-white/90 p-1 text-xs shadow-xl backdrop-blur-2xl dark:border-white/10 dark:bg-[#262626]/95"
              >
                <button
                  v-for="opt in performanceModeOptions"
                  :key="opt.value"
                  type="button"
                  @click="selectPerformanceModeOption(opt.value)"
                  class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left font-medium transition-colors"
                  :class="performanceMode === opt.value
                    ? 'bg-[#EC4141]/10 text-[#EC4141] dark:bg-[#EC4141]/20 dark:text-[#ff8b8b]'
                    : 'text-gray-700 hover:bg-black/5 dark:text-gray-200 dark:hover:bg-white/10'"
                >
                  <span class="truncate">{{ opt.label }}</span>
                  <Check
                    v-if="performanceMode === opt.value"
                    class="h-3.5 w-3.5 shrink-0 text-[#EC4141] dark:text-[#ff8b8b]"
                  />
                </button>
              </div>
            </Transition>
          </div>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.closeToTray') }}</div> 
          </div>
          <button type="button" @click="settings.closeToTray = !settings.closeToTray" class="glass-switch" :class="{ 'is-checked': settings.closeToTray }"></button>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.showQualityBadges') }}</div> 
          </div>
          <button type="button" @click="settings.showQualityBadges = !settings.showQualityBadges" class="glass-switch" :class="{ 'is-checked': settings.showQualityBadges }"></button>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.showSongComments') }}</div> 
          </div>
          <button type="button" @click="settings.showSongComments = !settings.showSongComments" class="glass-switch" :class="{ 'is-checked': settings.showSongComments }"></button>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.scrollToTop') }}</div> 
          </div>
          <button type="button" @click="settings.enableScrollToTopButton = !settings.enableScrollToTopButton" class="glass-switch" :class="{ 'is-checked': settings.enableScrollToTopButton }"></button>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.taskbarControls') }}</div> 
          </div>
          <button type="button" @click="settings.showTaskbarPlayer = !settings.showTaskbarPlayer" class="glass-switch" :class="{ 'is-checked': settings.showTaskbarPlayer }"></button>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.writeArtistAvatar') }}</div> 
          </div>
          <div class="flex items-center gap-3">
            <SettingHint severity="warning" :text="t('general.writeArtistAvatarHint')" /> 
            <button type="button" @click="settings.writeArtistAvatarToTags = !settings.writeArtistAvatarToTags" class="glass-switch" :class="{ 'is-checked': settings.writeArtistAvatarToTags }"></button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="isWindowsPlatform" class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        {{ t('general.fileAssoc') }}
      </h2>
      <p class="text-xs leading-5 text-gray-500 dark:text-white/45">{{ t('general.fileAssocHint') }}</p>
      <div class="overflow-hidden rounded-xl bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <button
          type="button"
          class="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-white/40 dark:hover:bg-white/10"
          :aria-expanded="showFileAssocPanel"
          @click="showFileAssocPanel = !showFileAssocPanel"
        >
          <span class="min-w-0 flex-1 text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.fileAssoc') }}</span>
          <span class="text-sm font-semibold text-[#EC4141] tabular-nums">
            {{ associatedExtensions.length }}/{{ AUDIO_FILE_ASSOCIATION_EXTENSIONS.length }}
          </span>
          <ChevronDown
            class="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200"
            :class="{ 'rotate-180': showFileAssocPanel }"
            aria-hidden="true"
          />
        </button>
        <transition name="settings-pop-panel">
          <div v-if="showFileAssocPanel">
            <div class="flex items-center justify-end gap-2 border-t border-gray-200/40 px-4 py-2.5 dark:border-gray-800/40">
              <button
                type="button"
                class="rounded-lg px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/10"
                @click="setAllFileAssociations(true)"
              >
                {{ t('general.fileAssocAll') }}
              </button>
              <button
                type="button"
                class="rounded-lg px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/10"
                @click="setAllFileAssociations(false)"
              >
                {{ t('general.fileAssocNone') }}
              </button>
            </div>
            <div class="max-h-[320px] overflow-y-auto border-t border-gray-200/40 dark:border-gray-800/40">
              <div
                v-for="ext in AUDIO_FILE_ASSOCIATION_EXTENSIONS"
                :key="ext"
                class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors"
              >
                <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ audioFileAssociationLabel(ext) }}</div>
                <button
                  type="button"
                  class="glass-switch"
                  :class="{ 'is-checked': isExtensionAssociated(ext) }"
                  @click="toggleFileAssociation(ext, !isExtensionAssociated(ext))"
                ></button>
              </div>
            </div>
          </div>
        </transition>
      </div>
      <SettingHint severity="warning" :text="t('general.fileAssocNote')" />
    </section>

    <section class="space-y-3"> 
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2"> 
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span> 
        {{ t('general.storage') }} 
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <div class="p-4 flex items-center justify-between gap-4 hover:bg-white/40 dark:hover:bg-white/10 transition-colors"> 
          <div class="min-w-0"> 
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.cacheLimit') }}</div> 
          </div>
          <div class="flex shrink-0 items-center gap-3">
            <SettingHint :text="t('general.cacheLimitHint')" /> 
            <label class="stream-cache-input-wrap">
              <input
                :value="settings.audio.streamCacheSizeMB"
                class="h-8 rounded-lg border border-black/10 bg-white/45 px-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
                type="number"
                min="1"
                max="10240"
                step="1"
                inputmode="numeric"
                @change="patchStreamCacheSize($event)"
              />
              <span class="text-gray-500 dark:text-gray-400">MB</span>
            </label>
          </div>
        </div>

        <div class="p-4 flex items-center justify-between gap-4 hover:bg-white/40 dark:hover:bg-white/10 transition-colors"> 
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">缓存目录</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 truncate" :title="settings.audio.streamCacheDir || '默认目录（%APPDATA%/com.xymusic.desktop/stream_cache）'">
              {{ settings.audio.streamCacheDir || '默认目录（%APPDATA%/com.xymusic.desktop/stream_cache）' }}
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button
              v-if="settings.audio.streamCacheDir"
              type="button"
              class="px-3 py-1.5 text-xs font-semibold rounded-md transition-colors bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/20"
              @click="resetStreamCacheDir"
            >恢复默认</button>
            <button
              type="button"
              class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors bg-[#EC4141] text-white hover:bg-[#d13b3b]"
              @click="chooseStreamCacheDir"
            >
              <FolderOpen class="h-3.5 w-3.5" />
              选择
            </button>
          </div>
        </div>

                <div class="p-4 flex items-center justify-between gap-4 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div class="min-w-0"> 
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-2">
              {{ t('general.clearCache') }} 
              <span class="text-xs font-semibold px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                {{ formatStreamCacheBytes(streamCacheCurrent) }} / {{ formatStreamCacheBytes(streamCacheMax) }}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <SettingHint :text="t('general.clearCacheHint')" /> 
            <button
              type="button"
              :disabled="isClearingStreamCache || streamCacheCurrent === 0"
              @click="handleClearStreamCache"
              class="settings-action-button shrink-0"
              :class="isClearingStreamCache || streamCacheCurrent === 0
                ? 'settings-action-button--disabled'
                : 'settings-action-button--solid'"
            >
              {{ isClearingStreamCache ? t('general.clearing') : t('general.clear') }} 
            </button>
          </div>
        </div>

        <div class="p-4 flex items-center justify-between gap-4 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div class="min-w-0">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-2">
              远程缓存
              <span class="text-xs font-semibold px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                {{ remoteCacheMeter ? `${formatStreamCacheBytes(remoteCacheMeter.bytes)} / ${formatStreamCacheBytes(remoteCacheMeter.limitBytes)}` : '0 B' }}
              </span>
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">远程音乐库（WebDAV）音频缓存</div>
          </div>
          <div class="flex items-center gap-3">
            <button
              type="button"
              :disabled="isClearingRemoteCache || !remoteCacheMeter || remoteCacheMeter.bytes === 0"
              @click="handleClearRemoteCache"
              class="settings-action-button shrink-0"
              :class="isClearingRemoteCache || !remoteCacheMeter || remoteCacheMeter.bytes === 0
                ? 'settings-action-button--disabled'
                : 'settings-action-button--solid'"
            >
              {{ isClearingRemoteCache ? t('general.clearing') : t('general.clear') }}
            </button>
          </div>
        </div>

        <div class="p-4 flex items-center justify-between gap-4 hover:bg-white/40 dark:hover:bg-white/10 transition-colors"> 
          <div class="min-w-0"> 
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.resetData') }}</div> 
          </div>
          <button
            type="button" 
            :disabled="isClearingAllData || isLibraryScanActive" 
            @click="openClearAllDataConfirm" 
            class="settings-action-button shrink-0" 
            :class="isClearingAllData || isLibraryScanActive 
              ? 'settings-action-button--disabled' 
              : 'settings-action-button--solid'"
          >
            {{ isClearingAllData ? t('general.resetting') : isLibraryScanActive ? t('general.scanUnavailable') : t('general.reset') }} 
          </button>
        </div>
      </div>
    </section>

    <ConfirmModal 
      :visible="showClearAllDataConfirm" 
      :title="t('general.resetData')" 
      :content="t('general.resetConfirm')" 
      @cancel="!isClearingAllData && (showClearAllDataConfirm = false)" 
      @confirm="handleClearAllData" 
    />
  </div>
</template>

<style scoped> /* 样式 */
.settings-action-button { /* 样式 */
  min-height: 38px; /* 样式 */
  padding: 0 16px; /* 样式 */
  border: 1px solid rgba(236, 65, 65, 0.14); /* 样式 */
  border-radius: 999px; /* 样式 */
  font-size: 12px; /* 样式 */
  font-weight: 600; /* 样式 */
  transition:
    border-color 160ms ease, /* 样式 */
    background-color 160ms ease, /* 样式 */
    color 160ms ease, /* 样式 */
    box-shadow 160ms ease, /* 样式 */
    transform 160ms ease; /* 样式 */
}

.settings-action-button:hover:not(:disabled) { /* 样式 */
  transform: translateY(-1px); /* 样式 */
  box-shadow: 0 10px 20px rgba(236, 65, 65, 0.08); /* 样式 */
}

.settings-action-button--soft { /* 样式 */
  background: rgba(236, 65, 65, 0.06); /* 样式 */
  color: #ec4141; /* 样式 */
}

.settings-action-button--soft:hover:not(:disabled) { /* 样式 */
  border-color: rgba(236, 65, 65, 0.34); /* 样式 */
  background: rgba(236, 65, 65, 0.1); /* 样式 */
}

.settings-action-button--solid {
  background: #ec4141;
  color: white;
  border-color: rgba(236, 65, 65, 0.5);
}

.settings-action-button--solid:hover:not(:disabled) {
  background: #d13b3b;
}

.settings-action-button--disabled { /* 样式 */
  border-color: rgba(148, 163, 184, 0.12); /* 样式 */
  background: rgba(255, 255, 255, 0.36); /* 样式 */
  color: rgba(100, 116, 139, 0.8); /* 样式 */
  cursor: not-allowed; /* 样式 */
  box-shadow: none; /* 样式 */
}

:global(.dark) .settings-action-button--disabled {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.45);
}

.stream-cache-input-wrap {
  display: inline-flex;
  align-items: center; /* 样式 */
  gap: 6px;
  color: rgba(55, 65, 81, 0.7);
  font-size: 0.78rem;
  flex-shrink: 0;
}

:global(.dark) .stream-cache-input-wrap {
  color: rgba(255, 255, 255, 0.55);
}

.settings-dropdown-enter-active,
.settings-dropdown-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
  transform-origin: top right;
}

.settings-dropdown-enter-from,
.settings-dropdown-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.96);
}

.settings-pop-panel-enter-active,
.settings-pop-panel-leave-active {
  transition:
    opacity 220ms ease,
    transform 240ms ease,
    max-height 240ms ease;
  transform-origin: top center;
  overflow: hidden;
}

.settings-pop-panel-enter-from,
.settings-pop-panel-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.97);
  max-height: 0;
}

.settings-pop-panel-enter-to,
.settings-pop-panel-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
  max-height: 400px;
}
</style>
