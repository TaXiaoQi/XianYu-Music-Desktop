<script setup lang="ts">
import { ref } from 'vue';
import { CircleAlert } from 'lucide-vue-next';
import { useSettings } from '../../features/settings/useSettings';
import EqualizerPanel from '../player/EqualizerPanel.vue';
import ModernModal from '../common/ModernModal.vue';
import type { OnlineDefaultQuality, OnlineFailureBehavior, OnlineQualityFallbackBehavior } from '../../types';
import { ALL_QUALITY_KEYS, QUALITY_META } from '../../types';

const { settings, patchSettings } = useSettings();

const volumeBalanceTip = '音量平衡会读取歌曲内置 ReplayGain 标签，在切歌时自动平衡音量。默认完全按标签播放，不改变歌曲内部动态。不存在标签时则无变化。';

const ONLINE_QUALITY_OPTIONS: { label: string; value: OnlineDefaultQuality; description: string }[] =
  ALL_QUALITY_KEYS.map(k => ({
    label: QUALITY_META[k].label,
    value: k,
    description: QUALITY_META[k].description,
  }));

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
  { label: '重试一次',   value: 'retry' },
];

const QUALITY_FALLBACK_OPTIONS: { label: string; value: OnlineQualityFallbackBehavior }[] = [
  { label: '暂停', value: 'pause' },
  { label: '播放更低音质', value: 'lower' },
  { label: '播放更高音质', value: 'higher' },
];

/** 切换在线音质：同时写入 settings store 和 localStorage（playerPlayback 读 localStorage） */
const patchOnlineQuality = (value: OnlineDefaultQuality) => {
  patchSettings({ audio: { ...settings.value.audio, onlineDefaultQuality: value } });
  localStorage.setItem('online_quality', value);
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

// IDM 兼容模式：每次「开启」时弹出原理说明
const showIdmCompatDialog = ref(false);

const toggleIdmCompatMode = () => {
  const nextEnabled = !settings.value.audio.idmCompatMode;
  patchSettings({
    audio: {
      ...settings.value.audio,
      idmCompatMode: nextEnabled,
    },
  });

  if (nextEnabled) {
    showIdmCompatDialog.value = true;
  }
};

const idmCompatDialogContent = [
  '开启后，播放在线歌曲时不再让播放器直接请求音频链接，',
  '而是先在后台的 Worker 线程把整首歌完整取回本地，再从本地内存播放。',
  '',
  '为什么这样能避开 IDM：',
  'IDM 这类下载工具会监视页面发出的媒体请求，一旦发现音频链接就会接管下载，',
  '导致播放器自己拿不到完整数据，出现无声、卡住或被反复劫持的问题。',
  'Worker 线程发出的请求属于普通数据请求，通常不会被接管。',
  '',
  '代价：由于需要先取回整首歌，点击播放到出声会有短暂等待（通常 1~3 秒），',
  '且不支持边下边播。若取回失败会自动回退为原来的直链播放方式。',
  '',
  '如果你没有安装 IDM 等下载工具，建议保持关闭以获得更快的起播速度。',
].join('\n');
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        音频处理
      </h2>
      <div class="flex flex-col rounded-xl bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <!-- 音量平衡主开关行 -->
        <div 
          class="desktop-setting-row"
          :class="settings.audio.volumeBalance.enabled ? 'rounded-t-xl' : 'rounded-xl'"
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
              @click="patchSettings({ audio: { ...settings.value.audio, onlineQualityFallbackBehavior: opt.value } })"
            >{{ opt.label }}</button>
          </div>
        </div>

        <!-- 起播失败行为 -->
        <div class="desktop-setting-row border-b border-gray-200/20 dark:border-gray-800/20">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">起播失败行为</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 max-w-xl">
              在线歌曲因网络错误或音源失效无法开始播放时的处理方式。
            </div>
          </div>
          <div class="flex shrink-0 items-center rounded-lg bg-gray-100 dark:bg-white/5 p-0.5 gap-0.5">
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

        <!-- 兼容播放模式 -->
        <div class="desktop-setting-row rounded-b-xl">
          <div class="min-w-0 flex-1 space-y-1 pr-3">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">兼容播放模式</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 max-w-xl">
              在线歌曲默认由内置音频内核播放（支持频谱、均衡器）。若某些歌曲播放异常（无声、卡住、
              被下载工具弹窗），可开启此项改用浏览器播放：先把整首歌取回本地再播，起播略慢且没有频谱与均衡器。
            </div>
          </div>
          <div class="flex items-center gap-3">
            <button
              type="button"
              class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none"
              :class="settings.audio.idmCompatMode ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
              @click="toggleIdmCompatMode"
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
                :class="settings.audio.idmCompatMode ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
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
          <EqualizerPanel :embedded="true" />
        </div>
      </div>
    </section>

    <!-- IDM 兼容模式：开启时的原理说明 -->
    <ModernModal
      v-model:visible="showIdmCompatDialog"
      title="已开启 IDM 兼容模式"
      :content="idmCompatDialogContent"
      confirm-text="我知道了"
      cancel-text="关闭"
      type="info"
    />
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
</style>
