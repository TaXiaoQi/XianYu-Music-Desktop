<script setup lang="ts">
import { Check, ChevronDown, CircleAlert, Minus, Plus } from 'lucide-vue-next';
import { useSettings } from '../../features/settings/useSettings';
import { usePlaybackStore } from '../../features/playback/store';
import { useToast } from '../../composables/toast';
import EqualizerPanel from '../common/SoundEffectBtn/EqualizerPanel.vue';
import type { OnlineDefaultQuality, OnlineFailureBehavior, OnlineQualityFallbackBehavior } from '../../types';
import { ALL_QUALITY_KEYS, QUALITY_META } from '../../types';
import { computed, onMounted, onScopeDispose, ref } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { playbackApi } from '../../services/tauri/playbackApi';
import type { AudioOutputStatus, AudioDevice } from '../../services/tauri/contracts';
import { playerStorage, playerStorageKeys } from '../../services/storage/playerStorage';
import {
  buildAudioOutputDeviceOptions,
  getSelectedOutputDeviceLabel,
} from './audioOutputDeviceLabels';
import SettingHint from './SettingHint.vue';
import {
  LYRICS_SYNC_OFFSET_MAX_MS,
  LYRICS_SYNC_OFFSET_MIN_MS,
  LYRICS_SYNC_OFFSET_STEP_MS,
  normalizeLyricsSyncOffsetMs,
} from '../../features/settings/lyricsSyncOffset';

const { settings, patchSettings } = useSettings();
const playbackStore = usePlaybackStore();
const { showToast } = useToast();

const volumeBalanceTip = '音量平衡会读取歌曲内置 ReplayGain 标签，在切歌时自动平衡音量。默认完全按标签播放，不改变歌曲内部动态。不存在标签时则无变化。';

const showQualityModal = ref(false);
const showFailureBehaviorModal = ref(false);
const showFallbackBehaviorModal = ref(false);

const FAILURE_BEHAVIOR_OPTIONS: { label: string; description: string; value: OnlineFailureBehavior }[] = [
  { label: '跳到下一首', description: '自动播放队列中的下一首歌曲', value: 'skip' },
  { label: '停止播放',   description: '停止播放，等待用户手动操作', value: 'stop' },
];

const QUALITY_FALLBACK_OPTIONS: { label: string; description: string; value: OnlineQualityFallbackBehavior }[] = [
  { label: '暂停',         description: '不尝试其他音质，暂停等待用户操作', value: 'pause' },
  { label: '播放更低音质', description: '自动降级到可用的更低音质',         value: 'lower' },
  { label: '播放更高音质', description: '自动升级到可用的更高音质',         value: 'higher' },
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

/** 弹窗中选择音质 */
const handleQualitySelect = (value: OnlineDefaultQuality) => {
  showQualityModal.value = false;
  patchOnlineQuality(value);
};

/** 弹窗中选择起播失败行为 */
const handleFailureBehaviorSelect = (value: OnlineFailureBehavior) => {
  showFailureBehaviorModal.value = false;
  patchSettings({ audio: { ...settings.value.audio, onlineFailureBehavior: value } });
};

/** 弹窗中选择音质回退行为 */
const handleFallbackBehaviorSelect = (value: OnlineQualityFallbackBehavior) => {
  showFallbackBehaviorModal.value = false;
  patchQualityFallback(value);
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

const showEqPanel = ref(false);

// --- 播放设置 ---
const autoPlay = ref(true);
const showLyricsSyncOffsetPanel = ref(false);
const audioOutputStatus = ref<AudioOutputStatus | null>(null);
const audioOutputDevices = ref<AudioDevice[]>([]);
const selectedOutputDeviceId = ref<string>('');
const showOutputDeviceModal = ref(false);
const isChangingOutputDevice = ref(false);
const wasapiExclusiveSideEffectTip = '开启后会独占播放设备：其他软件可能无声；设备断开或被占用时会自动回退默认播放。';
let unlistenAudioOutput: UnlistenFn | null = null;

const lyricsSyncOffsetMs = computed({
  get: () => normalizeLyricsSyncOffsetMs(settings.value.lyricsSyncOffset * 1000),
  set: (value: number | string) => {
    const numericValue = typeof value === 'string' ? parseFloat(value) : value;
    const next = normalizeLyricsSyncOffsetMs(numericValue);
    settings.value.lyricsSyncOffset = next / 1000;
  }
});

/** 输入浮点防御：四舍五入并回写显示值 */
const handleLyricsSyncOffsetChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const numericValue = parseFloat(target.value);
  const next = normalizeLyricsSyncOffsetMs(numericValue);
  target.value = String(next);
  lyricsSyncOffsetMs.value = next;
};

const lyricsSyncOffsetLabel = computed(() => {
  const offset = lyricsSyncOffsetMs.value;
  if (offset === 0) return '0 ms';
  return `${offset > 0 ? '+' : ''}${offset} ms`;
});

const isWasapiExclusiveEnabled = computed(
  () => settings.value.audio.outputMode === 'wasapiExclusive',
);

const outputDeviceOptions = computed(() => buildAudioOutputDeviceOptions(audioOutputDevices.value));

const selectedOutputDeviceLabel = computed(() => (
  getSelectedOutputDeviceLabel(
    outputDeviceOptions.value,
    selectedOutputDeviceId.value,
    audioOutputStatus.value,
  )
));

const loadAudioOutputDevices = async () => {
  const [devices, status] = await Promise.all([
    playbackApi.getOutputDevices(),
    playbackApi.getCurrentOutputDevice(),
  ]);
  audioOutputDevices.value = devices;
  audioOutputStatus.value = status;
  selectedOutputDeviceId.value = status.selected_device_id ?? '';
};

const handleOutputDeviceSelect = async (deviceId: string) => {
  if (isChangingOutputDevice.value) return;
  showOutputDeviceModal.value = false;
  if (deviceId === selectedOutputDeviceId.value) return;
  isChangingOutputDevice.value = true;
  try {
    const nextDeviceId = deviceId || null;
    await playbackApi.setOutputDevice(nextDeviceId);
    if (nextDeviceId) {
      playerStorage.setString(playerStorageKeys.outputDevice, nextDeviceId);
      playerStorage.setString(playerStorageKeys.outputDeviceMode, 'manual');
    } else {
      playerStorage.remove(playerStorageKeys.outputDevice);
      playerStorage.setString(playerStorageKeys.outputDeviceMode, 'default');
    }
    selectedOutputDeviceId.value = deviceId;
    audioOutputStatus.value = await playbackApi.getCurrentOutputDevice();
  } catch (error) {
    console.error('Failed to update audio output device:', error);
    showToast('切换播放设备失败', 'error');
    selectedOutputDeviceId.value = audioOutputStatus.value?.selected_device_id ?? '';
  } finally {
    isChangingOutputDevice.value = false;
  }
};

const toggleWasapiExclusive = async () => {
  const outputMode = isWasapiExclusiveEnabled.value ? 'shared' : 'wasapiExclusive';
  settings.value.audio.outputMode = outputMode;
  try {
    await playbackApi.setAudioOutputMode(outputMode);
    audioOutputStatus.value = await playbackApi.getCurrentOutputDevice();
  } catch (error) {
    console.error('Failed to update audio output mode:', error);
    showToast('切换音频输出模式失败', 'error');
  }
};

const resetLyricsSyncOffset = () => {
  lyricsSyncOffsetMs.value = 0;
};

const adjustLyricsSyncOffset = (delta: number) => {
  lyricsSyncOffsetMs.value = lyricsSyncOffsetMs.value + delta;
};

onMounted(async () => {
  await loadAudioOutputDevices().catch(error => {
    console.warn('Failed to load audio output devices:', error);
  });
  unlistenAudioOutput = await listen<AudioOutputStatus>('audio-output-device-changed', event => {
    audioOutputStatus.value = event.payload;
    selectedOutputDeviceId.value = event.payload.selected_device_id ?? '';
  });
});

onScopeDispose(() => {
  unlistenAudioOutput?.();
  unlistenAudioOutput = null;
});
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
            <div class="text-xs text-gray-500 dark:text-gray-400">播放/暂停时音量平滑过渡，避免爆音</div>
          </div>
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

        <!-- 音量平衡主开关行 -->
        <div
          class="desktop-setting-row border-b border-gray-200/20 dark:border-gray-800/20"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">音量平衡</div>
          </div>
          <div class="flex items-center gap-3">
            <span
              class="audio-tip"
              :aria-label="volumeBalanceTip"
              tabindex="0"
            >
              <CircleAlert class="h-4 w-4" aria-hidden="true" />
              <span class="audio-tip-popover" role="tooltip">{{ volumeBalanceTip }}</span>
            </span>
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
              <div class="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-2">
                整体增益偏移
                <span class="text-xs font-semibold px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  {{ settings.audio.volumeBalance.gainOffsetDb > 0 ? '+' : '' }}{{ settings.audio.volumeBalance.gainOffsetDb }} dB
                </span>
              </div>
              <div class="text-xs text-gray-500 dark:text-gray-400 max-w-xl">
                默认 0 dB，表示完全按 ReplayGain 标签播放。调高会整体更响，调低会保留更多余量。
              </div>
            </div>
            <div class="flex items-center gap-3">
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
              <div class="text-sm font-medium text-gray-800 dark:text-gray-200">
                防削波破音保护
              </div>
              <div class="text-xs text-gray-500 dark:text-gray-400 max-w-xl">
                当音量增益过大可能超出 0 dB 极限时自动降低音频信号。无峰值标签曲目会降级为不应用任何正增益。
              </div>
            </div>
            <div class="flex items-center gap-3">
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
          <button
            type="button"
            class="flex shrink-0 items-center gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            @click="showQualityModal = true"
          >
            <span>{{ QUALITY_META[settings.audio.onlineDefaultQuality].label }}</span>
            <span class="text-xs text-gray-400">{{ QUALITY_META[settings.audio.onlineDefaultQuality].description }}</span>
            <ChevronDown class="h-4 w-4 text-gray-400" aria-hidden="true" />
          </button>
        </div>

        <!-- 默认音质播放失败行为 -->
        <div class="desktop-setting-row border-b border-gray-200/20 dark:border-gray-800/20">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">默认音质播放失败行为</div>
          </div>
          <button
            type="button"
            class="flex shrink-0 items-center gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            @click="showFallbackBehaviorModal = true"
          >
            <span>{{ QUALITY_FALLBACK_OPTIONS.find(o => o.value === settings.audio.onlineQualityFallbackBehavior)?.label }}</span>
            <ChevronDown class="h-4 w-4 text-gray-400" aria-hidden="true" />
          </button>
        </div>

        <!-- 起播失败行为 -->
        <div class="desktop-setting-row rounded-b-xl">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">起播失败行为</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 max-w-xl">
              在线引擎完全无法生效时的处理方式。
            </div>
          </div>
          <button
            type="button"
            class="flex shrink-0 items-center gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            @click="showFailureBehaviorModal = true"
          >
            <span>{{ FAILURE_BEHAVIOR_OPTIONS.find(o => o.value === settings.audio.onlineFailureBehavior)?.label }}</span>
            <ChevronDown class="h-4 w-4 text-gray-400" aria-hidden="true" />
          </button>
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
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
              开启后，在主界面底部的播放控制栏将显示均衡器快捷按钮。
            </div>
          </div>
          <div class="flex items-center gap-3">
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
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
              通过调整不同频段的增益，改善音乐在不同音频设备上的表现。
            </div>
          </div>
          <div class="flex items-center gap-3">
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
          <button
            type="button"
            class="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            @click="showEqPanel = true"
          >
            打开音效面板
          </button>
          <EqualizerPanel :visible="showEqPanel" @update:visible="showEqPanel = $event" />
        </div>
      </div>
    </section>

    <!-- 音质选择弹窗：复用添加歌单弹窗容器模式，3 列平铺网格 -->
    <Teleport to="body">
      <Transition name="modal-pop">
        <div
          v-if="showQualityModal"
          class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm"
          @click.self="showQualityModal = false"
        >
          <div class="modal-content bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-80 overflow-hidden">
            <div class="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
              <h3 class="font-bold text-gray-800 dark:text-gray-200 text-sm">选择默认播放音质</h3>
              <button
                @click="showQualityModal = false"
                class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >✕</button>
            </div>
            <div class="max-h-80 overflow-y-auto custom-scrollbar p-3">
              <div class="grid grid-cols-3 gap-1.5">
                <button
                  v-for="key in ALL_QUALITY_KEYS"
                  :key="key"
                  type="button"
                  class="px-2 py-2 text-xs font-semibold rounded-md transition-colors text-center whitespace-nowrap flex flex-col items-center gap-0.5"
                  :class="settings.audio.onlineDefaultQuality === key
                    ? 'bg-[#EC4141] text-white shadow-sm'
                    : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'"
                  :title="QUALITY_META[key].description"
                  @click="handleQualitySelect(key)"
                >
                  <span>{{ QUALITY_META[key].label }}</span>
                  <span
                    class="text-[10px] font-normal opacity-75"
                    :class="settings.audio.onlineDefaultQuality === key ? '' : 'text-gray-400 dark:text-gray-500'"
                  >{{ QUALITY_META[key].description }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 默认音质播放失败行为选择弹窗：复用添加歌单弹窗容器模式 + 切换动效 -->
    <Teleport to="body">
      <Transition name="modal-pop">
        <div
          v-if="showFallbackBehaviorModal"
          class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm"
          @click.self="showFallbackBehaviorModal = false"
        >
          <div class="modal-content bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-80 overflow-hidden">
            <div class="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
              <h3 class="font-bold text-gray-800 dark:text-gray-200 text-sm">选择默认音质播放失败行为</h3>
              <button
                @click="showFallbackBehaviorModal = false"
                class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >✕</button>
            </div>
            <div class="max-h-80 overflow-y-auto custom-scrollbar p-2">
              <button
                v-for="option in QUALITY_FALLBACK_OPTIONS"
                :key="option.value"
                type="button"
                class="w-full flex items-center p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer transition-colors"
                :class="settings.audio.onlineQualityFallbackBehavior === option.value ? 'bg-gray-50 dark:bg-white/5' : ''"
                @click="handleFallbackBehaviorSelect(option.value)"
              >
                <div class="flex-1 min-w-0 text-left">
                  <div class="text-sm text-gray-800 dark:text-gray-200 truncate">{{ option.label }}</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ option.description }}</div>
                </div>
                <Check
                  v-if="settings.audio.onlineQualityFallbackBehavior === option.value"
                  class="h-4 w-4 text-[#EC4141] shrink-0 ml-2"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 起播失败行为选择弹窗：复用添加歌单弹窗容器模式 + 切换动效 -->
    <Teleport to="body">
      <Transition name="modal-pop">
        <div
          v-if="showFailureBehaviorModal"
          class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm"
          @click.self="showFailureBehaviorModal = false"
        >
          <div class="modal-content bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-80 overflow-hidden">
            <div class="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
              <h3 class="font-bold text-gray-800 dark:text-gray-200 text-sm">选择起播失败行为</h3>
              <button
                @click="showFailureBehaviorModal = false"
                class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >✕</button>
            </div>
            <div class="max-h-80 overflow-y-auto custom-scrollbar p-2">
              <button
                v-for="option in FAILURE_BEHAVIOR_OPTIONS"
                :key="option.value"
                type="button"
                class="w-full flex items-center p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer transition-colors"
                :class="settings.audio.onlineFailureBehavior === option.value ? 'bg-gray-50 dark:bg-white/5' : ''"
                @click="handleFailureBehaviorSelect(option.value)"
              >
                <div class="flex-1 min-w-0 text-left">
                  <div class="text-sm text-gray-800 dark:text-gray-200 truncate">{{ option.label }}</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ option.description }}</div>
                </div>
                <Check
                  v-if="settings.audio.onlineFailureBehavior === option.value"
                  class="h-4 w-4 text-[#EC4141] shrink-0 ml-2"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 播放设置 -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        播放设置
      </h2>
      <div class="settings-playback-group flex flex-col rounded-xl">
        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">自动播放</div>
          </div>
           <button @click="autoPlay = !autoPlay" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="autoPlay ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="autoPlay ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>
        <div class="p-4 flex items-center justify-between gap-4 border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">播放设备</div>
          </div>
          <button
            type="button"
            :disabled="isChangingOutputDevice"
            class="flex shrink-0 items-center gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors disabled:opacity-60 disabled:cursor-not-allowed max-w-[260px]"
            @click="showOutputDeviceModal = true"
          >
            <span class="truncate">{{ selectedOutputDeviceLabel }}</span>
            <ChevronDown class="h-4 w-4 text-gray-400 shrink-0" aria-hidden="true" />
          </button>
        </div>
        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">WASAPI 独占模式</div>
          </div>
          <div class="flex items-center gap-3">
            <SettingHint :text="wasapiExclusiveSideEffectTip" />
            <button @click="toggleWasapiExclusive" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="isWasapiExclusiveEnabled ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
              <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="isWasapiExclusiveEnabled ? 'translate-x-6' : 'translate-x-1'" />
            </button>
          </div>
        </div>
        <div class="border-t border-white/30 dark:border-white/5">
          <button
            type="button"
            @click="showLyricsSyncOffsetPanel = !showLyricsSyncOffsetPanel"
            class="w-full p-4 flex items-center justify-between gap-4 hover:bg-white/40 dark:hover:bg-white/10 transition-colors text-left"
          >
            <div class="min-w-0">
              <div class="text-sm font-medium text-gray-800 dark:text-gray-200">歌词同步补偿</div>
            </div>
            <div class="flex items-center gap-3 shrink-0">
              <SettingHint
                text="正值让歌词更晚显示，负值让歌词更早显示。用于修正不同输出设备的播放缓冲差异，默认值为 0 ms。"
                :focusable="false"
              />
              <div class="text-xs font-medium text-gray-600 dark:text-gray-300 tabular-nums">
                {{ lyricsSyncOffsetLabel }}
              </div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4 text-gray-400 transition-transform duration-200"
                :class="showLyricsSyncOffsetPanel ? 'rotate-180' : ''"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
              </svg>
            </div>
          </button>
          <transition name="settings-pop-panel">
            <div v-if="showLyricsSyncOffsetPanel" class="px-4 pb-4">
              <div class="settings-expand-panel">
                <div class="flex flex-col gap-4 md:flex-row md:items-center">
                  <div class="flex min-w-[240px] flex-1 items-center gap-2">
                    <button
                      type="button"
                      class="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-gray-200 bg-white/70 text-gray-600 transition hover:border-[#EC4141] hover:text-[#EC4141] disabled:cursor-not-allowed disabled:opacity-35 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"
                      :disabled="lyricsSyncOffsetMs <= LYRICS_SYNC_OFFSET_MIN_MS"
                      aria-label="歌词偏移减少 5 毫秒"
                      @click="adjustLyricsSyncOffset(-LYRICS_SYNC_OFFSET_STEP_MS)"
                    >
                      <Minus class="h-4 w-4" />
                    </button>
                    <input
                      v-model="lyricsSyncOffsetMs"
                      type="range"
                      :min="LYRICS_SYNC_OFFSET_MIN_MS"
                      :max="LYRICS_SYNC_OFFSET_MAX_MS"
                      :step="LYRICS_SYNC_OFFSET_STEP_MS"
                      class="settings-slider min-w-0 flex-1"
                    />
                    <button
                      type="button"
                      class="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-gray-200 bg-white/70 text-gray-600 transition hover:border-[#EC4141] hover:text-[#EC4141] disabled:cursor-not-allowed disabled:opacity-35 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"
                      :disabled="lyricsSyncOffsetMs >= LYRICS_SYNC_OFFSET_MAX_MS"
                      aria-label="歌词偏移增加 5 毫秒"
                      @click="adjustLyricsSyncOffset(LYRICS_SYNC_OFFSET_STEP_MS)"
                    >
                      <Plus class="h-4 w-4" />
                    </button>
                  </div>
                  <div class="flex items-center gap-3">
                    <input
                      :value="lyricsSyncOffsetMs"
                      type="number"
                      :min="LYRICS_SYNC_OFFSET_MIN_MS"
                      :max="LYRICS_SYNC_OFFSET_MAX_MS"
                      :step="LYRICS_SYNC_OFFSET_STEP_MS"
                      class="settings-number-input"
                      @change="handleLyricsSyncOffsetChange"
                    />
                    <button
                      type="button"
                      @click="resetLyricsSyncOffset"
                      class="settings-action-button settings-action-button--soft"
                    >
                      恢复默认
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </transition>
        </div>
      </div>
    </section>

    <!-- 播放设备选择弹窗：复用添加歌单弹窗容器模式 + 切换动效 -->
    <Teleport to="body">
      <Transition name="modal-pop">
        <div
          v-if="showOutputDeviceModal"
          class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm"
          @click.self="showOutputDeviceModal = false"
        >
          <div class="modal-content bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-80 overflow-hidden">
            <div class="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
              <h3 class="font-bold text-gray-800 dark:text-gray-200 text-sm">选择播放设备</h3>
              <button
                @click="showOutputDeviceModal = false"
                class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >✕</button>
            </div>
            <div class="max-h-80 overflow-y-auto custom-scrollbar p-2">
              <button
                v-for="device in outputDeviceOptions"
                :key="device.id || 'default'"
                type="button"
                class="w-full flex items-center p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer transition-colors"
                :class="selectedOutputDeviceId === device.id ? 'bg-gray-50 dark:bg-white/5' : ''"
                @click="handleOutputDeviceSelect(device.id)"
              >
                <div class="flex-1 min-w-0 text-left">
                  <div class="text-sm text-gray-800 dark:text-gray-200 truncate">{{ device.name }}</div>
                </div>
                <Check
                  v-if="selectedOutputDeviceId === device.id"
                  class="h-4 w-4 text-[#EC4141] shrink-0 ml-2"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
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

.audio-tip {
  position: relative;
  display: inline-flex;
  height: 20px;
  width: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: #f59e0b;
  outline: none;
}

.audio-tip-popover {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 30;
  width: min(300px, calc(100vw - 48px));
  max-width: calc(100vw - 48px);
  pointer-events: none;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.16);
  color: rgb(31 41 55);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.55;
  opacity: 0;
  padding: 10px 12px;
  transform: translateY(-4px);
  transition: opacity 160ms ease, transform 160ms ease;
  white-space: normal;
}

.audio-tip:hover .audio-tip-popover,
.audio-tip:focus-visible .audio-tip-popover {
  opacity: 1;
  transform: translateY(0);
}

:global(.dark) .audio-tip {
  color: #fcd34d;
}

:global(.dark) .audio-tip-popover {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(31, 31, 31, 0.96);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.28);
  color: rgba(255, 255, 255, 0.92);
}

.settings-expand-panel {
  margin-top: 2px;
  border-top: 1px solid rgba(255, 255, 255, 0.3);
  padding: 18px 16px 0;
}

.settings-playback-group {
  overflow: visible;
}

.settings-slider {
  height: 6px;
  cursor: pointer;
  accent-color: #ec4141;
}

.settings-number-input {
  width: 98px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  padding: 10px 12px;
  color: rgb(55 65 81);
  font-size: 13px;
  outline: none;
  transition: border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease;
}

.settings-number-input:focus {
  border-color: rgba(236, 65, 65, 0.3);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.08);
}

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
  max-height: 240px;
}

:global(.dark) .settings-expand-panel {
  border-top-color: rgba(255, 255, 255, 0.08);
}

:global(.dark) .settings-number-input {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.92);
}

:global(.dark) .settings-number-input:focus {
  border-color: rgba(236, 65, 65, 0.34);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.12);
}

:global(.dark) .settings-action-button--disabled {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.45);
}
</style>
