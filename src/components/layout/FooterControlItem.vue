<script setup lang="ts">
import { inject, type Ref } from 'vue';
import { CircleCheck, Download, Gauge, Loader2, SlidersHorizontal } from 'lucide-vue-next';
import EqualizerPanel from '../common/SoundEffectBtn/EqualizerPanel.vue';
import type { FooterItemKey, QualityKey, DownloadQuality, Song } from '../../types';
import type { DownloadRecord } from '../../services/downloadHistory';

/**
 * 底部栏可配置控件渲染组件。
 * 根据传入的 itemKey 渲染对应的控件（收藏/下载/播放模式/桌面歌词/音质/倍速/音量/均衡器/播放队列）。
 * 每个控件均可在任意容器（左/中左/中右/右/折叠收纳）中渲染，行为一致。
 *
 * 上下文通过 provide/inject 从 PlayerFooter 共享：
 * - 响应式状态（currentSong、volume、playbackSpeed 等）
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
  selectedDownloadQuality: Ref<DownloadQuality>;
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
  // 倍速
  playbackSpeed: Ref<number>;
  showSpeedSlider: Ref<boolean>;
  isDraggingSpeed: Ref<boolean>;
  handleSpeedEnter: () => void;
  handleSpeedLeave: () => void;
  handlePlaybackSpeedWheel: (e: WheelEvent) => void;
  speedLabel: Ref<string>;
  speedBarRef: Ref<HTMLElement | null>;
  startSpeedDrag: (e: PointerEvent) => void;
  speedPercent: Ref<number>;
  resetPlaybackSpeed: () => void;
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
  // 均衡器
  showEqPanel: Ref<boolean>;
  toggleEqPanel: (e: MouseEvent) => void;
  eqButtonRef: Ref<HTMLElement | null>;
  eqPanelRef: Ref<HTMLElement | null>;
  // 播放队列
  showPlaylist: Ref<boolean>;
  togglePlaylist: () => void;
}>('footerContext')!;

// 解构上下文供模板使用（模板引用不解构，通过 ctx.xxx 访问以避免 Vue 自动解包导致 .value 不可用）
const {
  currentSong,
  showPlayerDetail,
  isFavorite,
  toggleFavorite,
  isOnlineSong,
  isDownloading,
  downloadedRecord,
  handleDownloadClick,
  downloadButtonTitle,
  showDownloadQualityMenu,
  DOWNLOAD_QUALITY_OPTIONS,
  selectedDownloadQuality,
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
  playbackSpeed,
  showSpeedSlider,
  isDraggingSpeed,
  handleSpeedEnter,
  handleSpeedLeave,
  handlePlaybackSpeedWheel,
  speedLabel,
  startSpeedDrag,
  speedPercent,
  resetPlaybackSpeed,
  volume,
  showVolumeSlider,
  isDraggingVolume,
  handleVolumeEnter,
  handleVolumeLeave,
  handleVolumeWheel,
  startDrag,
  toggleMute,
  showEqPanel,
  toggleEqPanel,
  showPlaylist,
  togglePlaylist,
} = ctx;
</script>

<template>
  <!-- 收藏按钮 -->
  <button
    v-if="itemKey === 'favorite' && currentSong"
    @click="toggleFavorite(currentSong)"
    class="shrink-0 flex items-center justify-center w-8 h-8 rounded-full focus:outline-none transition-colors active:scale-95"
    :class="isFavorite(currentSong)
      ? 'text-[#EC4141]'
      : (showPlayerDetail ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10')"
    :title="isFavorite(currentSong) ? '取消收藏' : '添加到收藏'"
  >
    <svg v-if="isFavorite(currentSong)" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clip-rule="evenodd" />
    </svg>
    <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
    </svg>
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
      <Loader2 v-if="isOnlineSong && isDownloading" class="h-5 w-5 animate-spin" />
      <CircleCheck v-else-if="(!isOnlineSong) || (isOnlineSong && downloadedRecord)" class="h-5 w-5" />
      <Download v-else class="h-5 w-5" />
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
          :class="showPlayerDetail ? 'bg-[#1c1c1c]/90 border-white/10' : 'bg-white/95 dark:bg-zinc-900/90 border-gray-100 dark:border-white/10'"
        >
          <div class="px-3 py-1 text-[10px] font-semibold text-gray-400 dark:text-white/40 select-none">下载音质</div>
          <button
            v-for="opt in DOWNLOAD_QUALITY_OPTIONS"
            :key="opt.value"
            @click.stop="startDownload(opt.value)"
            class="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-medium rounded-lg transition-colors select-none"
            :class="selectedDownloadQuality === opt.value
              ? 'text-[#EC4141] bg-[#EC4141]/8'
              : (showPlayerDetail ? 'text-white/75 hover:text-white hover:bg-white/8' : 'text-gray-600 dark:text-white/70 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/8')"
          >
            <span class="flex-1 whitespace-nowrap text-left">{{ opt.label }}</span>
            <span class="text-[10px] text-gray-400 dark:text-white/40 whitespace-nowrap shrink-0">{{ opt.description }}</span>
            <span v-if="selectedDownloadQuality === opt.value" class="w-1.5 h-1.5 rounded-full bg-[#EC4141] shrink-0"></span>
          </button>
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
    <svg v-if="playMode === 0" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
    <svg v-else-if="playMode === 1" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /><text x="12" y="16" font-family="sans-serif" font-size="10" font-weight="bold" text-anchor="middle" fill="currentColor" stroke="none">1</text></svg>
    <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
  </button>

  <!-- 桌面歌词 -->
  <button
    v-else-if="itemKey === 'desktopLyrics'"
    @click="toggleLyrics"
    class="transition-colors hover:scale-110 transform duration-200 flex items-center justify-center shrink-0 w-8 h-8 rounded-full text-[14px] font-bold"
    :class="showDesktopLyrics ? 'text-[#EC4141] bg-[#EC4141]/10' : (showPlayerDetail ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10')"
    title="桌面歌词"
  >
    词
  </button>

  <!-- 音质选择按钮 -->
  <div v-else-if="itemKey === 'quality'" class="relative flex items-center justify-center h-full z-[70]">
    <button
      :ref="el => { if (el) ctx.qualityButtonRef.value = el as HTMLElement; }"
      @click="toggleQualityMenu"
      class="flex shrink-0 items-center justify-center whitespace-nowrap w-9 h-9 text-[12px] font-semibold rounded-full transition-colors select-none"
      :class="[
        !isQualitySelectableSong
          ? (showPlayerDetail
              ? 'text-white/80 cursor-default'
              : 'text-gray-700 dark:text-white/80 cursor-default')
          : showQualityMenu
            ? 'text-[#EC4141] bg-[#EC4141]/10'
            : (showPlayerDetail
                ? 'text-white/80 hover:text-white hover:bg-white/10'
                : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10')
      ]"
      :title="isQualitySelectableSong ? '音质选择' : '本地音质'"
    >
      <span class="whitespace-nowrap">{{ qualityButtonLabel }}</span>
    </button>

    <transition name="fade-scale">
      <div
        v-if="showQualityMenu"
        :ref="el => { if (el) ctx.qualityMenuRef.value = el as HTMLElement; }"
        class="absolute bottom-full left-1/2 -translate-x-1/2 pb-6 z-[80]"
      >
        <div
          class="min-w-[120px] backdrop-blur-xl shadow-2xl rounded-xl border py-1.5 px-1 transition-colors"
          :class="showPlayerDetail ? 'bg-[#1c1c1c]/90 border-white/10' : 'bg-white/95 dark:bg-zinc-900/90 border-gray-100 dark:border-white/10'"
        >
          <button
            v-for="opt in QUALITY_OPTIONS"
            :key="opt.value"
            @click="selectQuality(opt.value)"
            class="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-medium rounded-lg transition-colors select-none"
            :class="activeQualityKey === opt.value
              ? 'text-[#EC4141] bg-[#EC4141]/8'
              : (showPlayerDetail ? 'text-white/75 hover:text-white hover:bg-white/8' : 'text-gray-600 dark:text-white/70 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/8')"
          >
            <span class="flex-1 whitespace-nowrap text-left">{{ opt.label }}</span>
            <span class="text-[10px] text-gray-400 dark:text-white/40 whitespace-nowrap shrink-0">{{ opt.description }}</span>
            <span v-if="activeQualityKey === opt.value" class="w-1.5 h-1.5 rounded-full bg-[#EC4141] shrink-0"></span>
          </button>
        </div>
      </div>
    </transition>
  </div>

  <!-- 倍速控制 -->
  <div
    v-else-if="itemKey === 'speed'"
    class="relative flex items-center justify-center h-full z-[70]"
    @mouseenter="handleSpeedEnter"
    @mouseleave="handleSpeedLeave"
    @wheel.prevent.stop="handlePlaybackSpeedWheel"
  >
    <div
      v-if="showSpeedSlider || isDraggingSpeed"
      class="absolute bottom-full left-1/2 -translate-x-1/2 pb-3 z-[70]"
    >
      <div class="absolute top-full left-0 w-full h-4"></div>
      <div class="w-9 h-32 backdrop-blur-md shadow-2xl rounded-2xl border flex flex-col items-center justify-between py-3 transition-colors"
        :class="showPlayerDetail ? 'bg-[#1c1c1c]/80 border-white/10' : 'bg-white/90 dark:bg-zinc-900/85 border-gray-100 dark:border-white/10'"
      >
        <div class="text-[10px] font-bold select-none transition-colors -translate-y-[3px]"
          :class="playbackSpeed !== 1.0
            ? 'text-[#EC4141]'
            : (showPlayerDetail ? 'text-white/60' : 'text-gray-500 dark:text-white/60')"
        >{{ speedLabel }}</div>
        <div :ref="el => { if (el) ctx.speedBarRef.value = el as HTMLElement; }" class="relative flex-1 w-1.5 rounded-full cursor-pointer my-1 transition-colors [touch-action:none]"
             :class="showPlayerDetail ? 'bg-white/15' : 'bg-gray-200 dark:bg-white/15'"
             @pointerdown="startSpeedDrag">
           <div class="absolute bottom-0 w-full bg-[#EC4141] rounded-full" :style="{ height: speedPercent + '%' }"></div>
           <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-sm cursor-grab active:cursor-grabbing" :style="{ bottom: `calc(${speedPercent}% - 7px)` }"></div>
        </div>
      </div>
    </div>
    <button @click="resetPlaybackSpeed"
      class="transition-colors flex items-center justify-center shrink-0 w-8 h-8 rounded-full"
      :class="playbackSpeed !== 1.0
        ? 'text-[#EC4141]'
        : (showPlayerDetail ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10')"
      title="倍速（点击恢复1.0x）"
    >
      <Gauge class="h-5 w-5" />
    </button>
  </div>

  <!-- 音量控制 -->
  <div
    v-else-if="itemKey === 'volume'"
    class="relative flex items-center justify-center h-full z-[70]"
    @mouseenter="handleVolumeEnter"
    @mouseleave="handleVolumeLeave"
    @wheel.prevent.stop="handleVolumeWheel"
  >
    <div
      v-if="showVolumeSlider || isDraggingVolume"
      class="absolute bottom-full left-1/2 -translate-x-1/2 pb-3 z-[70]"
    >
      <div class="absolute top-full left-0 w-full h-4"></div>
      <div class="w-9 h-32 backdrop-blur-md shadow-2xl rounded-2xl border flex flex-col items-center justify-between py-3 transition-colors"
        :class="showPlayerDetail ? 'bg-[#1c1c1c]/80 border-white/10' : 'bg-white/90 dark:bg-zinc-900/85 border-gray-100 dark:border-white/10'"
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
    <button @click="toggleMute"
      class="transition-colors flex items-center justify-center shrink-0 w-8 h-8 rounded-full"
      :class="showPlayerDetail ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10'"
      title="音量"
    >
      <svg v-if="volume === 0" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
      <svg v-else-if="volume > 0 && volume < 30" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon></svg>
      <svg v-else-if="volume >= 30 && volume < 70" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
      <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>
    </button>
  </div>

  <!-- 均衡器按钮与弹出面板 -->
  <div v-else-if="itemKey === 'equalizer'" class="relative flex items-center justify-center h-full z-[70]">
    <button
      :ref="el => { if (el) ctx.eqButtonRef.value = el as HTMLElement; }"
      @click="toggleEqPanel"
      :class="['transition-colors w-8 h-8 flex items-center justify-center rounded-full', showEqPanel ? 'text-[#EC4141] bg-[#EC4141]/10' : (showPlayerDetail ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10')]"
      title="均衡器 (EQ)"
    >
      <SlidersHorizontal class="h-4 w-4" :stroke-width="2.2" />
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
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
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
