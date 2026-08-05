<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useSettings } from '../../features/settings/useSettings';
import { usePlayer } from '../../features/playback';
import { useToast } from '../../composables/toast';
import { appApi } from '../../services/tauri/appApi';
import { playbackApi } from '../../services/tauri/playbackApi';
import ConfirmModal from '../overlays/ConfirmModal.vue';
import SettingHint from './SettingHint.vue';

const { settings } = useSettings();
const {
  pauseSong,
  libraryScanProgress,
} = usePlayer();
const { showToast } = useToast();

const launchOnStartup = ref(false);

async function handleGpuAccelerationChange() {
  const previous = settings.value.gpuAcceleration;
  const next = !previous;

  settings.value.gpuAcceleration = next;

  try {
    await invoke('set_gpu_acceleration', { enabled: next });
    showToast('GPU 加速设置已更新，重启软件后生效', 'success');
  } catch (error) {
    settings.value.gpuAcceleration = previous;
    showToast('GPU 加速设置保存失败', 'error');
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
    showToast('在线播放缓存已清理', 'success');
  } catch (error) {
    console.error('Failed to clear stream cache:', error);
    showToast('清理在线播放缓存失败', 'error');
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
    showToast('清除所有数据失败，请重试', 'error');
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
    
    <!-- Startup & Behavior -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        常规与启动
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden">
        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">开机自动运行</div>
          </div>
          <button @click="launchOnStartup = !launchOnStartup" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="launchOnStartup ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="launchOnStartup ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">GPU 加速</div>
          </div>
          <button @click="handleGpuAccelerationChange" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0" :class="settings.gpuAcceleration ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.gpuAcceleration ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">关闭时最小化至托盘</div>
          </div>
          <button @click="settings.closeToTray = !settings.closeToTray" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.closeToTray ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.closeToTray ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">显示音质标识</div>
          </div>
          <button @click="settings.showQualityBadges = !settings.showQualityBadges" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.showQualityBadges ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.showQualityBadges ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">显示歌曲注释</div>
          </div>
          <button @click="settings.showSongComments = !settings.showSongComments" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.showSongComments ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.showSongComments ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">打开一键回顶按钮</div>
          </div>
          <button @click="settings.enableScrollToTopButton = !settings.enableScrollToTopButton" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.enableScrollToTopButton ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.enableScrollToTopButton ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">启用任务栏快捷播控</div>
          </div>
          <button @click="settings.showTaskbarPlayer = !settings.showTaskbarPlayer" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.showTaskbarPlayer ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.showTaskbarPlayer ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">修改歌手头像时同步写回音频标签</div>
          </div>
          <div class="flex items-center gap-3">
            <SettingHint severity="warning" text="开启后，手动修改歌手头像时会同步修改本地音频文件（注意：多歌手合作歌曲、远程歌曲、CUE分轨、只读文件会被自动跳过）" />
            <button @click="settings.writeArtistAvatarToTags = !settings.writeArtistAvatarToTags" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0" :class="settings.writeArtistAvatarToTags ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
              <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.writeArtistAvatarToTags ? 'translate-x-6' : 'translate-x-1'" />
            </button>
          </div>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">歌曲播放触发方式</div>
          </div>
          <div class="flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-white/10 p-0.5">
            <button
              @click="settings.songClickAction = 'single'"
              class="px-3 py-1 text-xs font-medium rounded-md transition-all whitespace-nowrap"
              :class="settings.songClickAction === 'single' ? 'bg-white dark:bg-white/20 text-[#EC4141] shadow-sm' : 'text-gray-600 dark:text-gray-400'"
            >
              单击
            </button>
            <button
              @click="settings.songClickAction = 'double'"
              class="px-3 py-1 text-xs font-medium rounded-md transition-all whitespace-nowrap"
              :class="settings.songClickAction === 'double' || !settings.songClickAction ? 'bg-white dark:bg-white/20 text-[#EC4141] shadow-sm' : 'text-gray-600 dark:text-gray-400'"
            >
              双击
            </button>
          </div>
        </div>
      </div>
    </section>
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        存储空间
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden">
        <!-- 播放缓存上限 -->
        <div class="p-4 flex items-center justify-between gap-4 border-b border-white/30 dark:border-white/5 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div class="min-w-0">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">播放缓存上限</div>
          </div>
          <div class="flex shrink-0 items-center gap-3">
            <SettingHint text="在线歌曲流式下载后缓存到本地，再次播放无需重新下载。缓存满后自动清理最久未播放的曲目。" />
            <label class="stream-cache-input-wrap">
              <input
                :value="settings.audio.streamCacheSizeMB"
                class="stream-cache-input"
                type="number"
                min="1"
                max="10240"
                step="1"
                inputmode="numeric"
                @change="patchStreamCacheSize($event)"
              />
              <span>MB</span>
            </label>
          </div>
        </div>

        <!-- 清理在线播放缓存 -->
        <div class="p-4 flex items-center justify-between gap-4 border-b border-white/30 dark:border-white/5 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div class="min-w-0">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-2">
              清理在线播放缓存
              <span class="text-xs font-semibold px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                {{ formatStreamCacheBytes(streamCacheCurrent) }} / {{ formatStreamCacheBytes(streamCacheMax) }}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <SettingHint text="清理后正在播放的在线歌曲不受影响，但已缓存的其他曲目需重新下载。" />
            <button
              type="button"
              :disabled="isClearingStreamCache || streamCacheCurrent === 0"
              @click="handleClearStreamCache"
              class="settings-action-button shrink-0"
              :class="isClearingStreamCache || streamCacheCurrent === 0
                ? 'settings-action-button--disabled'
                : 'settings-action-button--soft'"
            >
              {{ isClearingStreamCache ? '清理中...' : '清理' }}
            </button>
          </div>
        </div>

        <div class="p-4 flex items-center justify-between gap-4 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div class="min-w-0">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">重置数据</div>
          </div>
          <button
            type="button"
            :disabled="isClearingAllData || isLibraryScanActive"
            @click="openClearAllDataConfirm"
            class="settings-action-button shrink-0"
            :class="isClearingAllData || isLibraryScanActive
              ? 'settings-action-button--disabled'
              : 'settings-action-button--soft'"
          >
            {{ isClearingAllData ? '重置中...' : isLibraryScanActive ? '扫描中不可用' : '重置' }}
          </button>
        </div>
      </div>
    </section>

    <ConfirmModal
      :visible="showClearAllDataConfirm"
      title="重置数据"
      content="此操作会清空媒体库、播放记录、收藏和设置，并恢复初始状态，但不会删除你的音乐文件。确定继续吗？"
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

.stream-cache-input {
  width: 84px;
  height: 34px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.8);
  color: #1f2937;
  font: inherit;
  font-size: 0.8rem;
  text-align: right;
  padding: 0 10px;
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.stream-cache-input:focus {
  border-color: rgba(236, 65, 65, 0.62);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.14);
}

.stream-cache-input::-webkit-outer-spin-button,
.stream-cache-input::-webkit-inner-spin-button {
  margin: 0;
  appearance: none;
}

.stream-cache-input[type="number"] {
  appearance: textfield;
}

:global(.dark) .stream-cache-input {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.9);
}

:global(.dark) .stream-cache-input:focus {
  border-color: rgba(236, 65, 65, 0.62);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.14);
}
</style>
