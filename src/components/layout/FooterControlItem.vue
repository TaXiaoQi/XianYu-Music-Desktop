<script setup lang="ts">
import { inject, nextTick, ref, watch, type Ref } from 'vue';
import EqualizerPanel from '../common/SoundEffectBtn/EqualizerPanel.vue';
import FooterControlIcon from './FooterControlIcon.vue';
import type { FooterItemKey, QualityKey, DownloadQuality, Song } from '../../types';
import type { DownloadRecord } from '../../services/downloadHistory';

/**
 * 底部栏可配置控件渲染组件。
 * 根据传入的 itemKey 渲染对应的控件（收藏/下载/播放模式/桌面歌词/音质/音量/均衡器/播放队列）。
 * 每个控件均可在任意容器（左/中左/中右/右/折叠收纳）中渲染，行为一致。
 *
 * 上下文通过 provide/inject 从 PlayerFooter 共享：
 * - 响应式状态（currentSong、volume 等）
 * - 事件处理函数（toggleFavorite、handleDownloadClick 等）
 * - 模板引用（qualityButtonRef、volumeBarRef 等，用于点击外部检测与拖拽）
 */
defineProps<{
  itemKey: FooterItemKey;
}>();

// --- 注入 PlayerFooter 共享上下文 ---
const ctx = inject<{
  // 通用
  currentSong: Ref<Song | null>;
  showPlayerDetail: Ref<boolean>;
  footerQualityExtraText: (qualityKey: QualityKey) => string;
  isFooterQualityInfoProbing: Ref<boolean>;
  // 收藏
  isFavorite: (song: Song) => boolean;
  toggleFavorite: (song: Song) => void;
  // 下载
  isOnlineSong: Ref<boolean>;
  isDownloading: Ref<boolean>;
  downloadedRecord: Ref<DownloadRecord | null>;
  handleDownloadClick: () => void;
  downloadButtonTitle: Ref<string>;
  showDownloadQualityMenu: Ref<boolean>;
  DOWNLOAD_QUALITY_OPTIONS: Ref<Array<{ label: string; value: DownloadQuality; description: string }>>;
  activeDownloadQualityKey: Ref<DownloadQuality>;
  startDownload: (qualityKey: DownloadQuality) => Promise<void>;
  downloadQualityButtonRef: Ref<HTMLElement | null>;
  downloadQualityMenuRef: Ref<HTMLElement | null>;
  // 播放模式
  playMode: Ref<number>;
  toggleMode: () => void;
  // 桌面歌词
  showDesktopLyrics: Ref<boolean>;
  toggleLyrics: () => void;
  // 音质
  isQualitySelectableSong: Ref<boolean>;
  qualityButtonLabel: Ref<string>;
  showQualityMenu: Ref<boolean>;
  toggleQualityMenu: (e: MouseEvent) => void;
  QUALITY_OPTIONS: Ref<Array<{ label: string; value: QualityKey; description: string }>>;
  activeQualityKey: Ref<QualityKey>;
  selectQuality: (qualityKey: QualityKey) => Promise<void>;
  qualityButtonRef: Ref<HTMLElement | null>;
  qualityMenuRef: Ref<HTMLElement | null>;
  // 音量
  volume: Ref<number>;
  showVolumeSlider: Ref<boolean>;
  isDraggingVolume: Ref<boolean>;
  handleVolumeEnter: () => void;
  handleVolumeLeave: () => void;
  handleVolumeWheel: (e: WheelEvent) => void;
  volumeBarRef: Ref<HTMLElement | null>;
  startDrag: (e: PointerEvent) => void;
  toggleMute: () => void;
  // Bit-perfect / DSD / 插件机架 音效锁定态（仅均衡器使用）
  isAudioControlLocked: Ref<boolean>;
  audioLockTooltip: Ref<string>;
  isEffectLocked: Ref<boolean>;
  effectLockTooltip: Ref<string>;
  // 均衡器
  showEqPanel: Ref<boolean>;
  toggleEqPanel: (e: MouseEvent) => void;
  // 播放队列
  showPlaylist: Ref<boolean>;
  togglePlaylist: () => void;
  // 评论区
  isPluginSong: Ref<boolean>;
  showComment: Ref<boolean>;
  toggleComment: () => void;
  // MV
  mvSupport: (song: Song | null | undefined) => boolean;
  mvActive: Ref<boolean>;
  mvLoading: Ref<boolean>;
  toggleMv: () => Promise<void>;
  // MV 视频下载中（下载按钮 loading 态）
  isMvVideoDownloading: Ref<boolean>;
}>('footerContext')!;

// 解构上下文供模板使用（模板引用不解构，通过 ctx.xxx 访问以避免 Vue 自动解包导致 .value 不可用）
const {
  currentSong,
  showPlayerDetail,
  footerQualityExtraText,
  isFooterQualityInfoProbing,
  isFavorite,
  toggleFavorite,
  isOnlineSong,
  isDownloading,
  downloadedRecord,
  handleDownloadClick,
  downloadButtonTitle,
  showDownloadQualityMenu,
  DOWNLOAD_QUALITY_OPTIONS,
  activeDownloadQualityKey,
  startDownload,
  playMode,
  toggleMode,
  showDesktopLyrics,
  toggleLyrics,
  isQualitySelectableSong,
  qualityButtonLabel,
  showQualityMenu,
  toggleQualityMenu,
  QUALITY_OPTIONS,
  activeQualityKey,
  selectQuality,
  volume,
  showVolumeSlider,
  isDraggingVolume,
  handleVolumeEnter,
  handleVolumeLeave,
  handleVolumeWheel,
  startDrag,
  toggleMute,
  isAudioControlLocked,
  audioLockTooltip,
  isEffectLocked,
  effectLockTooltip,
  showEqPanel,
  toggleEqPanel,
  showPlaylist,
  togglePlaylist,
  isPluginSong,
  showComment,
  toggleComment,
  mvSupport,
  mvActive,
  mvLoading,
  toggleMv,
  isMvVideoDownloading,
} = ctx;

const downloadQualityListRef = ref<HTMLElement | null>(null);
const qualityListRef = ref<HTMLElement | null>(null);
const downloadQualityScrollProgress = ref({ show: false, top: 0, height: 100 });
const qualityScrollProgress = ref({ show: false, top: 0, height: 100 });

const updateScrollProgress = (
  containerRef: Ref<HTMLElement | null>,
  progressRef: Ref<{ show: boolean; top: number; height: number }>,
) => {
  const container = containerRef.value;
  if (!container) {
    progressRef.value = { show: false, top: 0, height: 100 };
    return;
  }

  const maxScroll = container.scrollHeight - container.clientHeight;
  if (maxScroll <= 1) {
    progressRef.value = { show: false, top: 0, height: 100 };
    return;
  }

  const height = Math.max(18, (container.clientHeight / container.scrollHeight) * 100);
  const top = (container.scrollTop / maxScroll) * (100 - height);
  progressRef.value = { show: true, top, height };
};

const updateDownloadQualityScrollProgress = () => {
  updateScrollProgress(downloadQualityListRef, downloadQualityScrollProgress);
};

const updateQualityScrollProgress = () => {
  updateScrollProgress(qualityListRef, qualityScrollProgress);
};

const scrollQualityIntoView = async (
  containerRef: Ref<HTMLElement | null>,
  qualityKey: QualityKey,
  onScrolled?: () => void,
) => {
  await nextTick();
  requestAnimationFrame(() => {
    const container = containerRef.value;
    if (!container) return;

    const target = container.querySelector<HTMLElement>(`[data-quality-value="${qualityKey}"]`);
    if (!target) return;

    const targetTop = target.offsetTop - (container.clientHeight - target.clientHeight) / 2;
    container.scrollTop = Math.max(0, targetTop);
    onScrolled?.();
  });
};

watch(
  () => [
    showDownloadQualityMenu.value,
    DOWNLOAD_QUALITY_OPTIONS.value.length,
    activeDownloadQualityKey.value,
  ] as const,
  ([visible]) => {
    if (visible) {
      void scrollQualityIntoView(
        downloadQualityListRef,
        activeDownloadQualityKey.value,
        updateDownloadQualityScrollProgress,
      );
      void nextTick(updateDownloadQualityScrollProgress);
    }
  },
);

watch(
  () => [
    showQualityMenu.value,
    QUALITY_OPTIONS.value.length,
    activeQualityKey.value,
  ] as const,
  ([visible]) => {
    if (visible) {
      void scrollQualityIntoView(qualityListRef, activeQualityKey.value, updateQualityScrollProgress);
      void nextTick(updateQualityScrollProgress);
    }
  },
);
</script>

<template>
  <!-- 收藏按钮 -->
  <button
    v-if="itemKey === 'favorite' && currentSong"
    @mousedown.stop
    @click.stop="toggleFavorite(currentSong)"
    class="shrink-0 flex items-center justify-center w-8 h-8 rounded-full focus:outline-none transition-colors active:scale-95"
    :class="isFavorite(currentSong)
      ? 'text-[#EC4141]'
      : (showPlayerDetail ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10')"
    :title="isFavorite(currentSong) ? '取消收藏' : '添加到收藏'"
  >
    <FooterControlIcon item-key="favorite" :active="isFavorite(currentSong)" class="h-5 w-5" />
  </button>

  <!-- 下载按钮：本地歌曲显示绿色已完成图标，在线歌曲支持下载 -->
  <div v-else-if="itemKey === 'download'" class="relative flex items-center justify-center h-full z-[70] shrink-0">
    <button
      :ref="el => { if (el) ctx.downloadQualityButtonRef.value = el as HTMLElement; }"
      @mousedown.stop
      @click.stop="handleDownloadClick"
      class="flex items-center justify-center transition-colors shrink-0 w-8 h-8 rounded-full"
      :class="!isOnlineSong
        ? (showPlayerDetail
          ? 'text-emerald-300 cursor-default'
          : 'text-emerald-600 dark:text-emerald-400 cursor-default')
        : isDownloading
          ? (showPlayerDetail
            ? 'text-white/80 hover:bg-white/10 cursor-wait'
            : 'text-gray-700 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/10 cursor-wait')
          : downloadedRecord
            ? (showPlayerDetail
              ? 'text-emerald-300 hover:text-emerald-200 hover:bg-white/10 cursor-pointer'
              : 'text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer')
            : (showPlayerDetail
              ? 'text-white/80 hover:text-white hover:bg-white/10 cursor-pointer'
              : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer')"
      :title="downloadButtonTitle"
    >
      <FooterControlIcon
        item-key="download"
        :loading="mvActive
          ? isMvVideoDownloading
          : (isOnlineSong && isDownloading)"
        :completed="mvActive ? false : (!isOnlineSong || Boolean(downloadedRecord))"
        :class="(mvActive && isMvVideoDownloading) || (isOnlineSong && isDownloading) ? 'h-6 w-6' : 'h-5 w-5'"
      />
    </button>

    <!-- 下载音质下拉菜单 -->
    <transition name="fade-scale">
      <div
        v-if="showDownloadQualityMenu"
        :ref="el => { if (el) ctx.downloadQualityMenuRef.value = el as HTMLElement; }"
        class="absolute bottom-full left-1/2 -translate-x-1/2 pb-6 z-[80]"
      >
        <div
          class="min-w-[120px] backdrop-blur-xl shadow-2xl rounded-xl border py-1.5 px-1 transition-colors"
          :class="showPlayerDetail ? 'bg-[#262626]/90 border-white/10' : 'bg-white/95 dark:bg-zinc-900/90 border-gray-100 dark:border-white/10'"
        >
          <div class="px-3 py-1 text-[10px] font-semibold text-gray-400 dark:text-white/40 select-none">
            下载音质
            <span v-if="isFooterQualityInfoProbing" class="font-normal"> · 探测中</span>
          </div>
          <div class="relative">
            <div
              ref="downloadQualityListRef"
              class="max-h-[230px] overflow-y-auto custom-scrollbar"
              :class="downloadQualityScrollProgress.show ? 'pr-2' : ''"
              @scroll="updateDownloadQualityScrollProgress"
            >
              <button
                v-for="opt in DOWNLOAD_QUALITY_OPTIONS"
                :key="opt.value"
                :data-quality-value="opt.value"
                @click.stop="startDownload(opt.value)"
                class="w-full flex items-center gap-2 px-3 py-2 text-left rounded-lg transition-colors select-none"
                :class="activeDownloadQualityKey === opt.value
                  ? 'text-[#EC4141] bg-[#EC4141]/8'
                  : (showPlayerDetail ? 'text-white/75 hover:text-white hover:bg-white/8' : 'text-gray-600 dark:text-white/70 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/8')"
              >
                <span class="min-w-0 flex flex-col">
                  <span class="text-[12px] font-medium whitespace-nowrap">{{ opt.label }}</span>
                  <span class="text-[10px] text-gray-400 dark:text-white/40 whitespace-nowrap">{{ footerQualityExtraText(opt.value) }}</span>
                </span>
                <span v-if="activeDownloadQualityKey === opt.value" class="ml-auto w-1.5 h-1.5 rounded-full bg-[#EC4141] shrink-0"></span>
              </button>
            </div>
            <div
              v-if="downloadQualityScrollProgress.show"
              class="pointer-events-none absolute right-0 top-0 h-full w-1 rounded-full overflow-hidden"
              :class="showPlayerDetail ? 'bg-white/10' : 'bg-gray-200/75 dark:bg-white/10'"
              aria-hidden="true"
            >
              <div
                class="absolute left-0 w-full rounded-full bg-[#EC4141]/75"
                :style="{
                  top: `${downloadQualityScrollProgress.top}%`,
                  height: `${downloadQualityScrollProgress.height}%`,
                }"
              ></div>
            </div>
          </div>
          <div
            v-if="DOWNLOAD_QUALITY_OPTIONS.length === 0 && !isFooterQualityInfoProbing"
            class="px-3 py-2 text-[11px] text-gray-400 dark:text-white/40 whitespace-nowrap"
          >
            未探测到可下载音质
          </div>
        </div>
      </div>
    </transition>
  </div>

  <!-- 播放模式 -->
  <button
    v-else-if="itemKey === 'playMode'"
    @click="toggleMode"
    class="transition-colors hover:scale-110 transform duration-200 flex items-center justify-center shrink-0 w-8 h-8 rounded-full"
    :class="showPlayerDetail ? 'text-white/80 hover:text-white' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white'"
    :title="['列表循环', '单曲循环', '随机播放'][playMode]"
  >
    <FooterControlIcon item-key="playMode" :play-mode="playMode" class="h-5 w-5" />
  </button>

  <!-- 桌面歌词 -->
  <button
    v-else-if="itemKey === 'desktopLyrics'"
    @click="toggleLyrics"
    class="transition-colors hover:scale-110 transform duration-200 flex items-center justify-center shrink-0 w-8 h-8 rounded-full text-[14px] font-bold"
    :class="showDesktopLyrics ? 'text-[#EC4141] bg-[#EC4141]/10' : (showPlayerDetail ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10')"
    title="桌面歌词"
  >
    <FooterControlIcon item-key="desktopLyrics" />
  </button>

  <!-- 音质选择按钮 -->
  <div v-else-if="itemKey === 'quality'" class="relative flex items-center justify-center h-full z-[70]">
    <button
      :ref="el => { if (el) ctx.qualityButtonRef.value = el as HTMLElement; }"
      @click="!isAudioControlLocked && toggleQualityMenu($event)"
      class="flex shrink-0 items-center justify-center whitespace-nowrap w-9 h-9 text-[12px] font-semibold rounded-full transition-colors select-none"
      :class="[
        isAudioControlLocked
          ? 'opacity-40 cursor-not-allowed'
          : mvActive
            ? (showQualityMenu
                ? 'text-[#EC4141] bg-[#EC4141]/10'
                : (showPlayerDetail
                    ? 'text-white/80 hover:text-white hover:bg-white/10'
                    : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10'))
            : !isQualitySelectableSong
              ? (showPlayerDetail
                  ? 'text-white/80 cursor-default'
                  : 'text-gray-700 dark:text-white/80 cursor-default')
              : showQualityMenu
                ? 'text-[#EC4141] bg-[#EC4141]/10'
                : (showPlayerDetail
                    ? 'text-white/80 hover:text-white hover:bg-white/10'
                    : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10')
      ]"
      :title="isAudioControlLocked ? audioLockTooltip : (mvActive ? 'MV 画质选择' : (isQualitySelectableSong ? '音质选择' : '本地音质'))"
    >
      <FooterControlIcon item-key="quality" :quality-label="qualityButtonLabel" />
    </button>

    <transition name="fade-scale">
      <div
        v-if="!isAudioControlLocked && showQualityMenu"
        :ref="el => { if (el) ctx.qualityMenuRef.value = el as HTMLElement; }"
        class="absolute bottom-full left-1/2 -translate-x-1/2 pb-6 z-[80]"
      >
        <div
          class="min-w-[120px] backdrop-blur-xl shadow-2xl rounded-xl border py-1.5 px-1 transition-colors"
          :class="showPlayerDetail ? 'bg-[#262626]/90 border-white/10' : 'bg-white/95 dark:bg-zinc-900/90 border-gray-100 dark:border-white/10'"
        >
          <div class="px-3 py-1 text-[10px] font-semibold text-gray-400 dark:text-white/40 select-none">
            {{ mvActive ? 'MV 画质' : '播放音质' }}
            <span v-if="!mvActive && isFooterQualityInfoProbing" class="font-normal"> · 探测中</span>
          </div>
          <div class="relative">
            <div
              ref="qualityListRef"
              class="max-h-[230px] overflow-y-auto custom-scrollbar"
              :class="qualityScrollProgress.show ? 'pr-2' : ''"
              @scroll="updateQualityScrollProgress"
            >
              <button
                v-for="opt in QUALITY_OPTIONS"
                :key="opt.value"
                :data-quality-value="opt.value"
                @click="selectQuality(opt.value)"
                class="w-full flex items-center gap-2 px-3 py-2 text-left rounded-lg transition-colors select-none"
                :class="activeQualityKey === opt.value
                  ? 'text-[#EC4141] bg-[#EC4141]/8'
                  : (showPlayerDetail ? 'text-white/75 hover:text-white hover:bg-white/8' : 'text-gray-600 dark:text-white/70 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/8')"
              >
                <span class="min-w-0 flex flex-col">
                  <span class="text-[12px] font-medium whitespace-nowrap">{{ opt.label }}</span>
                  <span class="text-[10px] text-gray-400 dark:text-white/40 whitespace-nowrap">{{ footerQualityExtraText(opt.value) }}</span>
                </span>
                <span v-if="activeQualityKey === opt.value" class="ml-auto w-1.5 h-1.5 rounded-full bg-[#EC4141] shrink-0"></span>
              </button>
            </div>
            <div
              v-if="qualityScrollProgress.show"
              class="pointer-events-none absolute right-0 top-0 h-full w-1 rounded-full overflow-hidden"
              :class="showPlayerDetail ? 'bg-white/10' : 'bg-gray-200/75 dark:bg-white/10'"
              aria-hidden="true"
            >
              <div
                class="absolute left-0 w-full rounded-full bg-[#EC4141]/75"
                :style="{
                  top: `${qualityScrollProgress.top}%`,
                  height: `${qualityScrollProgress.height}%`,
                }"
              ></div>
            </div>
          </div>
          <div
            v-if="QUALITY_OPTIONS.length === 0 && !isFooterQualityInfoProbing && !mvActive"
            class="px-3 py-2 text-[11px] text-gray-400 dark:text-white/40 whitespace-nowrap"
          >
            未探测到可播放音质
          </div>
        </div>
      </div>
    </transition>
  </div>

  <!-- 音量控制 -->
  <div
    v-else-if="itemKey === 'volume'"
    class="relative flex items-center justify-center h-full z-[70]"
    @mouseenter="handleVolumeEnter"
    @mouseleave="handleVolumeLeave"
    @wheel.prevent.stop="!isAudioControlLocked && handleVolumeWheel($event)"
  >
    <div
      v-if="!isAudioControlLocked && (showVolumeSlider || isDraggingVolume)"
      class="absolute bottom-full left-1/2 -translate-x-1/2 pb-3 z-[70]"
    >
      <div class="absolute top-full left-0 w-full h-4"></div>
      <div class="w-9 h-32 backdrop-blur-md shadow-2xl rounded-2xl border flex flex-col items-center justify-between py-3 transition-colors"
        :class="showPlayerDetail ? 'bg-[#262626]/80 border-white/10' : 'bg-white/90 dark:bg-zinc-900/85 border-gray-100 dark:border-white/10'"
      >
        <div class="text-[10px] font-bold select-none transition-colors -translate-y-[3px]"
          :class="showPlayerDetail ? 'text-white/60' : 'text-gray-500 dark:text-white/60'"
        >{{ volume }}%</div>
        <div :ref="el => { if (el) ctx.volumeBarRef.value = el as HTMLElement; }" class="relative flex-1 w-1.5 rounded-full cursor-pointer my-1 transition-colors [touch-action:none]"
             :class="showPlayerDetail ? 'bg-white/15' : 'bg-gray-200 dark:bg-white/15'"
             @pointerdown="startDrag">
           <div class="absolute bottom-0 w-full bg-[#EC4141] rounded-full" :style="{ height: volume + '%' }"></div>
           <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-sm cursor-grab active:cursor-grabbing" :style="{ bottom: `calc(${volume}% - 7px)` }"></div>
        </div>
      </div>
    </div>
    <button @click="!isAudioControlLocked && toggleMute()"
      class="transition-colors flex items-center justify-center shrink-0 w-8 h-8 rounded-full"
      :class="[
        isAudioControlLocked
          ? 'opacity-40 cursor-not-allowed'
          : (showPlayerDetail ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10')
      ]"
      :title="isAudioControlLocked ? audioLockTooltip : '音量'"
    >
      <FooterControlIcon item-key="volume" :volume="volume" class="h-5 w-5" />
    </button>
  </div>

  <!-- 均衡器按钮与弹出面板 -->
  <div v-else-if="itemKey === 'equalizer'" class="relative flex items-center justify-center h-full z-[70]">
    <button
      @click="!isEffectLocked && toggleEqPanel($event)"
      :disabled="isEffectLocked"
      :class="[
        'transition-colors w-8 h-8 flex items-center justify-center rounded-full',
        isEffectLocked
          ? 'opacity-40 cursor-not-allowed'
          : showEqPanel
            ? 'text-[#EC4141] bg-[#EC4141]/10'
            : (showPlayerDetail
                ? 'text-white/80 hover:text-white hover:bg-white/10'
                : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10')
      ]"
      :title="isEffectLocked ? (effectLockTooltip || audioLockTooltip) : '均衡器 (EQ)'"
    >
      <FooterControlIcon item-key="equalizer" class="h-4 w-4" />
    </button>

    <!-- 本地均衡器面板：自带 Teleport 模态弹窗 + 遮罩 + Transition，无需外层定位包裹 -->
    <EqualizerPanel :visible="showEqPanel" @update:visible="showEqPanel = $event" />
  </div>

  <!-- 播放队列 -->
  <div v-else-if="itemKey === 'playlist'" class="relative flex items-center justify-center h-full z-[70]">
    <button @click="togglePlaylist"
      class="transition-colors hover:scale-110 transform duration-200 flex items-center justify-center shrink-0 w-8 h-8 rounded-full"
      :class="showPlaylist ? 'text-[#EC4141] bg-[#EC4141]/10' : (showPlayerDetail ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10')"
      title="播放队列"
    >
      <FooterControlIcon item-key="playlist" class="h-[22px] w-[22px]" />
    </button>
  </div>

  <!-- 评论区 -->
  <div v-else-if="itemKey === 'comment'" class="relative flex items-center justify-center h-full z-[70]">
    <button
      v-if="isPluginSong"
      @click="toggleComment"
      class="transition-colors w-8 h-8 flex items-center justify-center rounded-full"
      :class="showComment ? 'text-[#EC4141] bg-[#EC4141]/10' : (showPlayerDetail ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10')"
      title="评论区"
    >
      <FooterControlIcon item-key="comment" class="h-4 w-4" />
    </button>
    <button
      v-else
      class="w-8 h-8 flex items-center justify-center rounded-full opacity-40 cursor-not-allowed"
      :class="showPlayerDetail ? 'text-white/60' : 'text-gray-600 dark:text-white/60'"
      title="当前歌曲不支持评论（仅插件在线歌曲可用）"
    >
      <FooterControlIcon item-key="comment" class="h-4 w-4" />
    </button>
  </div>

  <!-- MV：播放当前歌曲的 MV 背景视频（仅播放详情页底栏显示，主页由布局过滤隐藏） -->
  <div v-else-if="itemKey === 'mv'" class="relative flex items-center justify-center h-full z-[70]">
    <button
      v-if="mvSupport(currentSong)"
      @click="toggleMv"
      class="transition-colors w-8 h-8 flex items-center justify-center rounded-full"
      :class="mvActive || mvLoading
        ? 'text-[#EC4141] bg-[#EC4141]/10'
        : (showPlayerDetail ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10')"
      :title="mvActive ? '关闭 MV' : (mvLoading ? 'MV 加载中…' : '开启 MV')"
    >
      <FooterControlIcon item-key="mv" :class="mvLoading ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'" />
    </button>
    <button
      v-else
      class="w-8 h-8 flex items-center justify-center rounded-full opacity-40 cursor-not-allowed"
      :class="showPlayerDetail ? 'text-white/60' : 'text-gray-600 dark:text-white/60'"
      title="当前歌曲不支持 MV（仅插件在线歌曲可用）"
    >
      <FooterControlIcon item-key="mv" class="h-4 w-4" />
    </button>
  </div>
</template>

<style scoped>
.fade-scale-enter-active,
.fade-scale-leave-active {
  transition: opacity 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.fade-scale-enter-from,
.fade-scale-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.85);
}
</style>
