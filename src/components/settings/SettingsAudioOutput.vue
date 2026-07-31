<script setup lang="ts">
import { useSettings } from '../../features/settings/useSettings';
import { usePlaybackStore } from '../../features/playback/store';
import { useToast } from '../../composables/toast';
import EqualizerPanel from '../player/EqualizerPanel.vue';
import type { OnlineDefaultQuality, OnlineFailureBehavior, OnlineQualityFallbackBehavior } from '../../types';
import { ALL_QUALITY_KEYS, QUALITY_META } from '../../types';
import SettingHint from './SettingHint.vue';

const { settings, patchSettings } = useSettings();
const playbackStore = usePlaybackStore();
const { showToast } = useToast();

const volumeBalanceTip = '音量平衡会读取歌曲内置 ReplayGain 标签，在切歌时自动平衡音量。默认完全按标签播放，不改变歌曲内部动态。不存在标签时则无变化。';

/** 按 3 列 4 行分组（从低到高横向排布），用于按钮选择网格 */
const QUALITY_GRID: OnlineDefaultQuality[][] = (() => {
  const grid: OnlineDefaultQuality[][] = [];
  for (let i = 0; i < ALL_QUALITY_KEYS.length; i += 3) {
    grid.push(ALL_QUALITY_KEYS.slice(i, i + 3));
  }
  return grid;
})();

const FAILURE_BEHAVIOR_OPTIONS: { label: string; value: OnlineFailureBehavior }[] = [
  { label: '跳到下一首', value: 'skip' },
  { label: '停止播放',   value: 'stop' },
  { label: '等待响应',   value: 'wait' },
];

const QUALITY_FALLBACK_OPTIONS: { label: string; value: OnlineQualityFallbackBehavior }[] = [
  { label: '暂停', value: 'pause' },
  { label: '播放更低音质', value: 'lower' },
  { label: '播放更高音质', value: 'higher' },
];

/** 检查当前是否正在播放在线歌曲 */
const isPlayingOnlineSong = () => {
  const song = playbackStore.currentSong;
  if (!song) return false;
  const path = song.cue_source_path || song.path;
  return path.startsWith('lx://') || path.startsWith('plugin://') || path.startsWith('http');
};

/** 切换在线音质：验证当前播放歌曲是否支持新音质，同时写入 settings store 和 localStorage */
const patchOnlineQuality = (value: OnlineDefaultQuality) => {
  patchSettings({ audio: { ...settings.value.audio, onlineDefaultQuality: value } });
  localStorage.setItem('online_quality', value);
  // [音质验证] 如果当前正在播放在线歌曲，提示新设置在下一首生效
  if (isPlayingOnlineSong()) {
    const available = playbackStore.currentAvailableQualities;
    if (available && !available.includes(value)) {
      showToast(`当前歌曲不支持 ${QUALITY_META[value].label}，新设置将在下一首生效`, 'info');
    } else {
      showToast('音质设置将在下一首歌曲生效', 'info');
    }
  }
};

/** 切换音质回退行为：验证当前播放歌曲的音质支持情况 */
const patchQualityFallback = (value: OnlineQualityFallbackBehavior) => {
  patchSettings({ audio: { ...settings.value.audio, onlineQualityFallbackBehavior: value } });
  if (isPlayingOnlineSong()) {
    showToast('回退行为将在下一首歌曲生效', 'info');
  }
};

// 规范更新：启用/禁用均衡器
const toggleEqualizer = () => {
  const currentEq = settings.value.audio.equalizer;
  patchSettings({
    audio: {
      ...settings.value.audio,
      equalizer: {
        ...currentEq,
        enabled: !currentEq.enabled,
      },
    },
  });
};

// 规范更新：在播放栏显示均衡器按钮
const toggleShowEqualizerInFooter = () => {
  patchSettings({
    audio: {
      ...settings.value.audio,
      showEqualizerInFooter: !settings.value.audio.showEqualizerInFooter,
    },
  });
};
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        音频处理
      </h2>
      <div class="flex flex-col rounded-xl bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <!-- 渐入渐出（淡入淡出）开关 -->
        <div class="desktop-setting-row rounded-t-xl border-b border-gray-200/20 dark:border-gray-800/20">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">渐入渐出</div>
          </div>
          <div class="flex items-center gap-3">
            <SettingHint text="播放/暂停时音量平滑过渡，避免爆音" />
            <button
              type="button"
              class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none"
              :class="settings.audio.fadeInOutEnabled ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
              @click="settings.audio.fadeInOutEnabled = !settings.audio.fadeInOutEnabled"
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
                :class="settings.audio.fadeInOutEnabled ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>
        </div>

        <!-- 音量平衡主开关行 -->
        <div
          class="desktop-setting-row border-b border-gray-200/20 dark:border-gray-800/20"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">音量平衡</div>
          </div>
          <div class="flex items-center gap-3">
            <SettingHint :text="volumeBalanceTip" />
            <button
              type="button"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
              :class="settings.audio.volumeBalance.enabled ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
              @click="settings.audio.volumeBalance.enabled = !settings.audio.volumeBalance.enabled"
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
                :class="settings.audio.volumeBalance.enabled ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>
        </div>

        <!-- 高级音量平衡配置子区域 -->
        <div
          v-if="settings.audio.volumeBalance.enabled"
          class="flex flex-col border-t border-gray-200/20 dark:border-gray-800/20 bg-gray-50/10 dark:bg-gray-900/10 transition-all duration-300 animate-in fade-in rounded-b-xl"
        >
          <!-- 整体增益偏移设置 -->
          <div class="desktop-setting-row border-b border-gray-200/20 dark:border-gray-800/20 pl-8">
            <div class="flex-1 space-y-1">
              <div class="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
                整体增益偏移
                <span class="text-xs font-semibold px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  {{ settings.audio.volumeBalance.gainOffsetDb > 0 ? '+' : '' }}{{ settings.audio.volumeBalance.gainOffsetDb }} dB
                </span>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <SettingHint text="默认 0 dB，表示完全按 ReplayGain 标签播放。调高会整体更响，调低会保留更多余量。" />
              <input
                type="range"
                min="-12"
                max="6"
                step="1"
                v-model.number="settings.audio.volumeBalance.gainOffsetDb"
                class="w-36 h-1 rounded-lg bg-gray-200 dark:bg-gray-700 appearance-none cursor-pointer accent-[#EC4141]"
              />
            </div>
          </div>

          <!-- 防削波保护开关 -->
          <div class="desktop-setting-row pl-8 rounded-b-xl">
            <div class="flex-1 space-y-1">
              <div class="text-sm font-medium text-gray-800 dark:text-gray-200">防削波破音保护</div>
            </div>
            <div class="flex items-center gap-3">
              <SettingHint text="当音量增益过大可能超出 0 dB 极限时自动降低音频信号。无峰值标签曲目会降级为不应用任何正增益。" />
              <button
                type="button"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
                :class="settings.audio.volumeBalance.preventClipping ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
                @click="settings.audio.volumeBalance.preventClipping = !settings.audio.volumeBalance.preventClipping"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
                  :class="settings.audio.volumeBalance.preventClipping ? 'translate-x-6' : 'translate-x-1'"
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 在线播放设置 -->
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        在线播放
      </h2>
      <div class="flex flex-col rounded-xl bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">

        <!-- 默认播放音质 -->
        <div class="desktop-setting-row rounded-t-xl border-b border-gray-200/20 dark:border-gray-800/20">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">默认播放音质</div>
          </div>
          <div class="grid grid-cols-3 gap-1.5 shrink-0" style="min-width: 280px;">
            <button
              v-for="qKey in QUALITY_GRID.flat()"
              :key="qKey"
              type="button"
              class="px-2 py-1.5 text-xs font-semibold rounded-md transition-colors text-center whitespace-nowrap"
              :class="settings.audio.onlineDefaultQuality === qKey
                ? 'bg-[#EC4141] text-white shadow-sm'
                : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'"
              :title="QUALITY_META[qKey].description"
              @click="patchOnlineQuality(qKey)"
            >{{ QUALITY_META[qKey].label }}</button>
          </div>
        </div>

        <!-- 默认音质播放失败行为 -->
        <div class="desktop-setting-row border-b border-gray-200/20 dark:border-gray-800/20">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">默认音质播放失败行为</div>
          </div>
          <div class="flex shrink-0 items-center rounded-lg bg-gray-100 dark:bg-white/5 p-0.5 gap-0.5">
            <button
              v-for="opt in QUALITY_FALLBACK_OPTIONS" :key="opt.value"
              class="px-3 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap"
              :class="settings.audio.onlineQualityFallbackBehavior === opt.value
                ? 'bg-white dark:bg-white/15 text-[#EC4141] shadow-sm'
                : 'text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/70'"
              @click="patchQualityFallback(opt.value)"
            >{{ opt.label }}</button>
          </div>
        </div>

        <!-- 起播失败行为 -->
        <div class="desktop-setting-row rounded-b-xl">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">起播失败行为</div>
          </div>
          <div class="flex shrink-0 items-center gap-3">
            <SettingHint text="在线歌曲因网络错误或音源失效无法开始播放时的处理方式。" />
            <div class="flex items-center rounded-lg bg-gray-100 p-0.5 gap-0.5 dark:bg-white/5">
              <button
                v-for="opt in FAILURE_BEHAVIOR_OPTIONS" :key="opt.value"
                class="px-3 py-1 text-xs font-semibold rounded-md transition-colors"
                :class="settings.audio.onlineFailureBehavior === opt.value
                  ? 'bg-white dark:bg-white/15 text-[#EC4141] shadow-sm'
                  : 'text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/70'"
                @click="patchSettings({ audio: { ...settings.audio, onlineFailureBehavior: opt.value } })"
              >{{ opt.label }}</button>
            </div>
          </div>
        </div>

      </div>
    </section>

    <!-- 均衡器配置区 -->
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        均衡器 (EQ)
      </h2>
      <div class="flex flex-col rounded-xl bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <!-- 固定均衡器到播放栏开关行 -->
        <div 
          class="desktop-setting-row rounded-t-xl border-b border-gray-200/20 dark:border-gray-800/20"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">在播放栏显示均衡器按钮</div>
          </div>
          <div class="flex items-center gap-3">
            <SettingHint text="开启后，在主界面底部的播放控制栏将显示均衡器快捷按钮。" />
            <button
              type="button"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
              :class="settings.audio.showEqualizerInFooter ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
              @click="toggleShowEqualizerInFooter"
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
                :class="settings.audio.showEqualizerInFooter ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>
        </div>

        <!-- 启用均衡器主开关行 -->
        <div 
          class="desktop-setting-row"
          :class="settings.audio.equalizer.enabled ? 'border-b border-gray-200/20 dark:border-gray-800/20' : 'rounded-b-xl'"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">启用均衡器</div>
          </div>
          <div class="flex items-center gap-3">
            <SettingHint text="通过调整不同频段的增益，改善音乐在不同音频设备上的表现。" />
            <button
              type="button"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
              :class="settings.audio.equalizer.enabled ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
              @click="toggleEqualizer"
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
                :class="settings.audio.equalizer.enabled ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>
        </div>

        <!-- 均衡器调节板高级配置子区域 -->
        <div
          v-if="settings.audio.equalizer.enabled"
          class="flex flex-col border-t border-gray-200/20 dark:border-gray-800/20 bg-gray-50/10 dark:bg-gray-900/10 transition-all duration-300 animate-in fade-in rounded-b-xl p-6"
        >
          <EqualizerPanel :embedded="true" />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.desktop-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.16);
  text-align: left;
  transition: background-color 160ms ease;
}

.desktop-setting-row:last-child {
  border-bottom: 0;
}

.desktop-setting-row:hover {
  background: rgba(255, 255, 255, 0.4);
}

:global(.dark) .desktop-setting-row {
  border-bottom-color: rgba(255, 255, 255, 0.05);
}

:global(.dark) .desktop-setting-row:hover {
  background: rgba(255, 255, 255, 0.08);
}

</style>
