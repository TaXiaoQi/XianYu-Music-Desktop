<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ChevronDown } from 'lucide-vue-next';
import { useSettings } from '../../features/settings/useSettings';
import { toolboxApi } from '../../services/tauri/toolboxApi';
import { usePlayer } from '../../features/playback';
import { useToast } from '../../composables/toast';
import { appApi } from '../../services/tauri/appApi';
import { playbackApi } from '../../services/tauri/playbackApi';
import ConfirmModal from '../overlays/ConfirmModal.vue';
import SettingHint from './SettingHint.vue';
import { useI18n } from '../../features/i18n';
import type { AppLanguage } from '../../types';

const { settings } = useSettings();
const {
  pauseSong,
  libraryScanProgress,
} = usePlayer();
const { showToast } = useToast();
const { t } = useI18n();

const appLanguage = computed({
  get: () => settings.value.language,
  set: (value: AppLanguage) => {
    settings.value.language = value;
  },
});

const languageOptions = computed<{ value: AppLanguage; label: string }[]>(() => [
  { value: 'zh-CN', label: t('language.zhCN') },
  { value: 'zh-TW', label: t('language.zhTW') },
  { value: 'en-US', label: t('language.enUS') },
]);

const launchOnStartup = ref(false);

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
  // 同步在线播放缓存上限到后端并读取当前用量
  void playbackApi.setStreamCacheMaxSize(settings.value.audio.streamCacheSizeMB * 1024 * 1024)
    .then(refreshStreamCacheInfo);
});
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">

    <!-- Language -->
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        {{ t('language.section') }}
      </h2>
      <div class="overflow-hidden rounded-xl border border-gray-200/40 bg-white/20 dark:border-gray-800/40 dark:bg-black/10">
        <div class="flex items-center justify-between gap-5 p-4 transition-colors hover:bg-white/40 dark:hover:bg-white/10">
          <div class="min-w-0">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">
              {{ t('language.label') }}
            </div>
            <div class="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
              {{ t('language.description') }}
            </div>
          </div>
          <div class="relative w-40 shrink-0 sm:w-44">
            <select
              v-model="appLanguage"
              :aria-label="t('language.label')"
              class="language-select h-9 w-full cursor-pointer appearance-none rounded-lg border border-black/10 bg-white/55 pl-3 pr-9 text-sm font-medium text-gray-800 outline-none transition hover:bg-white/75 focus:border-[#EC4141]/50 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-100 dark:hover:bg-white/15"
            >
              <option
                v-for="option in languageOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
            <ChevronDown class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          </div>
        </div>
      </div>
    </section>

    <!-- Startup & Behavior -->
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
          <button @click="launchOnStartup = !launchOnStartup" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="launchOnStartup ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="launchOnStartup ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.checkUpdates') }}</div>
          </div>
          <button @click="settings.checkUpdateOnStartup = !settings.checkUpdateOnStartup" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0" :class="settings.checkUpdateOnStartup ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.checkUpdateOnStartup ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.gpuAcceleration') }}</div>
          </div>
          <button @click="handleGpuAccelerationChange" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0" :class="settings.gpuAcceleration ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.gpuAcceleration ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.closeToTray') }}</div>
          </div>
          <button @click="settings.closeToTray = !settings.closeToTray" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.closeToTray ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.closeToTray ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.showQualityBadges') }}</div>
          </div>
          <button @click="settings.showQualityBadges = !settings.showQualityBadges" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.showQualityBadges ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.showQualityBadges ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.showSongComments') }}</div>
          </div>
          <button @click="settings.showSongComments = !settings.showSongComments" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.showSongComments ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.showSongComments ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.scrollToTop') }}</div>
          </div>
          <button @click="settings.enableScrollToTopButton = !settings.enableScrollToTopButton" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.enableScrollToTopButton ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.enableScrollToTopButton ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.taskbarControls') }}</div>
          </div>
          <button @click="settings.showTaskbarPlayer = !settings.showTaskbarPlayer" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.showTaskbarPlayer ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.showTaskbarPlayer ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.writeArtistAvatar') }}</div>
          </div>
          <div class="flex items-center gap-3">
            <SettingHint severity="warning" :text="t('general.writeArtistAvatarHint')" />
            <button @click="settings.writeArtistAvatarToTags = !settings.writeArtistAvatarToTags" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0" :class="settings.writeArtistAvatarToTags ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
              <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.writeArtistAvatarToTags ? 'translate-x-6' : 'translate-x-1'" />
            </button>
          </div>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.songClickAction') }}</div>
          </div>
          <div class="flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-white/10 p-0.5">
            <button
              @click="settings.songClickAction = 'single'"
              class="px-3 py-1 text-xs font-medium rounded-md transition-all whitespace-nowrap"
              :class="settings.songClickAction === 'single' ? 'bg-white dark:bg-white/20 text-[#EC4141] shadow-sm' : 'text-gray-600 dark:text-gray-400'"
            >
              {{ t('general.singleClick') }}
            </button>
            <button
              @click="settings.songClickAction = 'double'"
              class="px-3 py-1 text-xs font-medium rounded-md transition-all whitespace-nowrap"
              :class="settings.songClickAction === 'double' || !settings.songClickAction ? 'bg-white dark:bg-white/20 text-[#EC4141] shadow-sm' : 'text-gray-600 dark:text-gray-400'"
            >
              {{ t('general.doubleClick') }}
            </button>
          </div>
        </div>
      </div>
    </section>
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        {{ t('general.storage') }}
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <!-- 播放缓存上限 -->
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

        <!-- 清理在线播放缓存 -->
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

<style scoped>
.settings-action-button {
  min-height: 38px;
  padding: 0 16px;
  border: 1px solid rgba(236, 65, 65, 0.14);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}

.settings-action-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 10px 20px rgba(236, 65, 65, 0.08);
}

.settings-action-button--soft {
  background: rgba(236, 65, 65, 0.06);
  color: #ec4141;
}

.settings-action-button--soft:hover:not(:disabled) {
  border-color: rgba(236, 65, 65, 0.34);
  background: rgba(236, 65, 65, 0.1);
}

.settings-action-button--solid {
  background: #ec4141;
  color: white;
  border-color: rgba(236, 65, 65, 0.5);
}

.settings-action-button--solid:hover:not(:disabled) {
  background: #d13b3b;
}

.settings-action-button--disabled {
  border-color: rgba(148, 163, 184, 0.12);
  background: rgba(255, 255, 255, 0.36);
  color: rgba(100, 116, 139, 0.8);
  cursor: not-allowed;
  box-shadow: none;
}

:global(.dark) .settings-action-button--disabled {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.45);
}

/* 播放缓存上限数字输入框（复用短音频输入框样式） */
.stream-cache-input-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: rgba(55, 65, 81, 0.7);
  font-size: 0.78rem;
  flex-shrink: 0;
}

:global(.dark) .stream-cache-input-wrap {
  color: rgba(255, 255, 255, 0.55);
}

.language-select {
  color-scheme: light;
}

:global(.dark) .language-select {
  color-scheme: dark;
}

/* 深色模式下明确设置展开面板的 option 背景与文字，
   避免 WebView2 上 color-scheme 对原生下拉面板不完全生效导致白底浅字看不清。 */
:global(.dark) .language-select option {
  background-color: #262626;
  color: rgba(255, 255, 255, 0.92);
}
</style>
