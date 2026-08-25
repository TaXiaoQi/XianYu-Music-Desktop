<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Check, ChevronDown } from 'lucide-vue-next';
import { useSettings } from '../../features/settings/useSettings';
import { playerStorage } from '../../services/storage/playerStorage';
import { toolboxApi } from '../../services/tauri/toolboxApi';
import { usePlayer } from '../../features/playback';
import { useToast } from '../../composables/toast';
import { appApi } from '../../services/tauri/appApi';
import { playbackApi } from '../../services/tauri/playbackApi';
import ConfirmModal from '../overlays/ConfirmModal.vue';
import SettingHint from './SettingHint.vue';
import { useI18n } from '../../features/i18n';
import { usePerformanceMode } from '../../composables/usePerformanceMode';
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
    // 常规设置由播放器生命周期防抖保存；语言切换必须立即落盘，避免退出或旧版刷新逻辑造成回滚。
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
              class="flex h-9 w-full items-center justify-between rounded-lg border border-black/10 bg-white/55 px-3 text-xs font-medium text-gray-800 outline-none transition hover:bg-white/75 focus:border-[#EC4141]/50 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-100 dark:hover:bg-white/15"
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
          <button type="button" @click="launchOnStartup = !launchOnStartup" class="glass-switch" :class="{ 'is-checked': launchOnStartup }"></button>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ t('general.checkUpdates') }}</div>
          </div>
          <button type="button" @click="settings.checkUpdateOnStartup = !settings.checkUpdateOnStartup" class="glass-switch" :class="{ 'is-checked': settings.checkUpdateOnStartup }"></button>
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
              class="flex h-9 w-full items-center justify-between rounded-lg border border-black/10 bg-white/55 px-3 text-xs font-medium text-gray-800 outline-none transition hover:bg-white/75 focus:border-[#EC4141]/50 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-100 dark:hover:bg-white/15"
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
</style>
