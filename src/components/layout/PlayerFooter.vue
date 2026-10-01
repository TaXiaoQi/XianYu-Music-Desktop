<script setup lang="ts">
import { ChevronUp } from 'lucide-vue-next';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useLibraryCollections } from '../../features/collections/useLibraryCollections';
import { useLyrics } from '../../composables/lyrics';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { useSettings } from '../../features/settings/useSettings';

import { usePluginHostStore } from '../../features/pluginHost/store';
import { useRenderingPower } from '../../composables/renderingPower';
import { useToast } from '../../composables/toast';
import { usePlaybackStore } from '../../features/playback/store';
import { computed, defineAsyncComponent, ref, onMounted, onUnmounted, watch, nextTick, provide } from 'vue';
import FooterControlItem from './FooterControlItem.vue';
import { useDesktopTheme } from '../../composables/useDesktopTheme';
import type { QualityKey, RemoteDownloadProgress } from '../../types';
import {
  FOOTER_PROGRESS_HIDDEN_KEY,
  readStoredProgressHidden
} from './playerFooterProgress';
import {
  ALL_QUALITY_OPTIONS,
  compactFileSize,
  getAudioExtLabel,
  localQualityLabel,
  qualityAbbr,
} from './footer/footerQuality';
import { useFooterProgressDrag } from './footer/useFooterProgressDrag';
import { useFooterVolumeDrag } from './footer/useFooterVolumeDrag';
import { useFooterMarquee } from './footer/useFooterMarquee';
import { useFooterIdleAutohide } from './footer/useFooterIdleAutohide';
import { useFooterQualityProbe } from './footer/useFooterQualityProbe';
import { useFooterShare } from './footer/useFooterShare';
import { useFooterMv } from './footer/useFooterMv';
import { useFooterDownload } from './footer/useFooterDownload';

const { sticker, surfaceStyle } = useDesktopTheme();

const AudioVisualizer = defineAsyncComponent(() => import('../player/AudioVisualizer.vue'));
const FooterContextMenu = defineAsyncComponent(() => import("../overlays/FooterContextMenu.vue"));
const LyricsReplacementModal = defineAsyncComponent(() => import('../overlays/LyricsReplacementModal.vue'));
const ModernModal = defineAsyncComponent(() => import('../common/ModernModal.vue'));
const DlnaCastDialog = defineAsyncComponent(() => import('../overlays/DlnaCastDialog.vue'));
const ShareSongDialog = defineAsyncComponent(() => import('../overlays/ShareSongDialog.vue'));

const {
  currentSong,
  currentPlayingQuality,
  sessionQualityOverride,
  setSessionQualityOverride,
  isPlaying, volume, currentTime, playMode, activeOutputMode, showPlaylist, showPlayerDetail, showComment,
  togglePlay, nextSong, prevSong, handleVolume, handleVolumeWheel, toggleMute,
  toggleMode, togglePlaylist, toggleComment,
  togglePlayerDetail, seekTo, formatDuration, playSong,
} = usePlaybackController();
const { isFavorite, toggleFavorite } = useLibraryCollections();

const handleOpenDetail = () => {
  togglePlayerDetail();
};

const { showDesktopLyrics, showLyricsPlayerSettingsPanel } = useLyrics();
const { settings, footerLayout } = useSettings();
const { isMainWindowLowPower } = useRenderingPower();

// --- 底部栏容器化布局 ---
import {
  computeCollapsedItems,
  normalizeFooterLayout,
} from '../../features/settings/footerItems';
import type { FooterItemKey } from '../../types';

const normalizedLayout = computed(() => normalizeFooterLayout(footerLayout.value));

const isFooterItemVisible = (key: FooterItemKey) => showPlayerDetail.value || key !== 'mv';
const leftItems = computed(() => normalizedLayout.value.left.filter(key => !normalizedLayout.value.hidden.includes(key) && isFooterItemVisible(key)));
const middleLeftItem = computed(() => normalizedLayout.value.middleLeft && !normalizedLayout.value.hidden.includes(normalizedLayout.value.middleLeft) && isFooterItemVisible(normalizedLayout.value.middleLeft)
  ? normalizedLayout.value.middleLeft
  : null);
const middleRightItem = computed(() => normalizedLayout.value.middleRight && !normalizedLayout.value.hidden.includes(normalizedLayout.value.middleRight) && isFooterItemVisible(normalizedLayout.value.middleRight)
  ? normalizedLayout.value.middleRight
  : null);
const rightItems = computed(() => normalizedLayout.value.right.filter(key => !normalizedLayout.value.hidden.includes(key) && isFooterItemVisible(key)));
const collapsedItems = computed(() => computeCollapsedItems(normalizedLayout.value).filter(isFooterItemVisible));

const { showToast } = useToast();

// --- 音质探测（下载菜单与音质菜单共用）---
const {
  footerAvailableQualityKeys,
  footerQualityUrls,
  footerQualitySizes,
  isFooterQualityInfoProbing,
  abortFooterQualityInfoProbe,
  resetQualityInfo,
  ensureFooterQualityInfo,
} = useFooterQualityProbe({
  getCurrentSong: () => currentSong.value,
  getCurrentPlayingQuality: () => currentPlayingQuality.value,
});

// --- 下载功能 ---
const {
  isOnlineSong,
  downloadedRecord,
  showRedownloadConfirm,
  showMvDownloadQualityModal,
  isMvVideoDownloading,
  isDownloading,
  showDownloadQualityMenu,
  downloadQualityButtonRef,
  downloadQualityMenuRef,
  DOWNLOAD_QUALITY_OPTIONS,
  selectedDownloadQuality,
  activeDownloadQualityKey,
  handleDownloadClick,
  mvDownloadQualityOptions,
  mvDownloadDefaultQuality,
  downloadMvWithQuality,
  handleConfirmRedownload,
  startDownload,
  downloadButtonTitle,
  redownloadContent,
} = useFooterDownload({
  currentSong,
  getDownloadSettings: () => settings.value.download,
  getCurrentPlayingQuality: () => currentPlayingQuality.value,
  footerAvailableQualityKeys,
  ensureFooterQualityInfo,
  resetQualityInfo,
  closeQualityMenu: () => { showQualityMenu.value = false; },
  getMvActive: () => mvActive.value,
  showToast,
});
// --- Context Menu State ---
const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const lyricsReplacementVisible = ref(false);

// --- Comment State (复用全局 UI store，弹窗挂在 MainShell 上) ---
const isPluginSong = computed(() => {
  const song = currentSong.value;
  return !!song
    && song.source_type === 'plugin'
    && !!(song.plugin_id || (song.rawData as Record<string, unknown> | undefined)?.pluginId);
});
const wrapToggleComment = () => {
  if (!isPluginSong.value) return;
  if (!showComment.value) {
    showFooterTools.value = false;
  }
  toggleComment();
};

// --- MV 背景视频 ---
const {
  videoBackground,
  mvActive,
  mvLoading,
  mvPhase,
  mvBufferedSec,
  mvVideoActive,
  mvSupport,
  toggleMv,
} = useFooterMv({
  currentSong,
  getPlayQueue: () => playbackStore.playQueue || [],
  getPlayMode: () => playMode.value,
  showToast,
  closeFooterTools: () => { showFooterTools.value = false; },
});

const playbackStore = usePlaybackStore();

// --- 分享与投屏弹窗 ---
const {
  showShareDialog,
  openShareDialog,
  showDlnaCastDialog,
  openDlnaCastDialog,
  handleShareCopy,
  handleShareCast,
} = useFooterShare({
  currentSong,
  showToast,
  closeFooterTools: () => { showFooterTools.value = false; },
});

const handleContextMenu = (e: MouseEvent) => {
  if (!currentSong.value) return;
  e.preventDefault();
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
};

const toggleLyrics = () => { showDesktopLyrics.value = !showDesktopLyrics.value; };
const toggleLyricsPlayerSettings = () => {
  showLyricsPlayerSettingsPanel.value = !showLyricsPlayerSettingsPanel.value;
  if (showLyricsPlayerSettingsPanel.value) {
    showFooterTools.value = false;
  }
};
const isVisualizerEnabled = ref(localStorage.getItem('footer_visualizer_enabled') !== 'false');
const isProgressHidden = ref(readStoredProgressHidden(localStorage));
const remoteDownloadProgress = ref<RemoteDownloadProgress | null>(null);
let unlistenRemoteDownload: UnlistenFn | null = null;


const QUALITY_OPTIONS = computed<Array<{ label: string; value: string; description: string }>>(() => {
  if (mvActive.value) {
    return videoBackground.availableQualities.value.map(quality => ({
      label: quality.label || quality.key,
      value: quality.key,
      description: '',
    }));
  }
  if (footerAvailableQualityKeys.value !== null) {
    return ALL_QUALITY_OPTIONS.filter(opt => footerAvailableQualityKeys.value!.includes(opt.value));
  }
  return [];
});

const footerQualityExtraText = (key: string) => {
  if (mvActive.value) {
    const quality = videoBackground.availableQualities.value.find(item => item.key === key);
    if (!quality) return '';
    const parts: string[] = [];
    if (quality.height) parts.push(`${quality.height}P`);
    if (quality.bitrate) parts.push(`${Math.round(quality.bitrate / 1000)}kbps`);
    if (typeof quality.size === 'number' && quality.size > 0) {
      const mb = quality.size / 1024 / 1024;
      parts.push(`${mb >= 1024 ? `${(mb / 1024).toFixed(1)}GB` : `${mb.toFixed(1)}MB`}`);
    }
    return parts.join(' · ');
  }
  const url = footerQualityUrls.value[key as QualityKey];
  const size = footerQualitySizes.value[key as QualityKey];
  const ext = getAudioExtLabel(key as QualityKey, url);
  if (typeof size === 'number' && size > 0) {
    return `${ext} · ${compactFileSize(size)}`;
  }
  // 对齐移动端：探测不到体积就不显示后缀，不展示「未知体积」
  if (isFooterQualityInfoProbing.value) return `${ext} · 探测中`;
  return ext;
};

watch(
  () => currentSong.value?.cue_source_path || currentSong.value?.path,
  () => {
    void ensureFooterQualityInfo();
  },
  { immediate: true },
);

const selectedQualityKey = computed<QualityKey>(
  () => sessionQualityOverride.value
    ?? (settings.value.audio.onlineDefaultQuality as QualityKey) ?? '320k',
);
const qualityButtonLabel = computed(() => {
  if (mvActive.value) return videoBackground.activeQuality.value || '画质';
  if (isQualitySelectableSong.value) {
    return qualityAbbr(currentPlayingQuality.value ?? selectedQualityKey.value);
  }
  return localQualityLabel(currentSong.value);
});

const isQualitySelectableSong = computed(() => {
  const path = currentSong.value?.path ?? '';
  return path.startsWith('lx://') || path.startsWith('plugin://');
});

const activeQualityKey = computed<string>(
  () => mvActive.value
    ? videoBackground.activeQuality.value
    : (currentPlayingQuality.value ?? selectedQualityKey.value),
);

const showQualityMenu = ref(false);
const qualityButtonRef = ref<HTMLElement | null>(null);
const qualityMenuRef = ref<HTMLElement | null>(null);

const toggleQualityMenu = (e: MouseEvent) => {
  if (!mvActive.value && !isQualitySelectableSong.value) return;
  e.stopPropagation();
  showDownloadQualityMenu.value = false;
  showQualityMenu.value = !showQualityMenu.value;
  if (showQualityMenu.value && !mvActive.value) {
    void ensureFooterQualityInfo();
  }
};

const selectQuality = async (qualityKey: string) => {
  if (mvActive.value) {
    showQualityMenu.value = false;
    try {
      await videoBackground.setQuality(qualityKey);
    } catch (e: any) {
      console.warn('[MV] 画质切换失败:', e?.message || e);
      showToast(e?.message || '画质切换失败', 'error');
    }
    return;
  }
  const prev = selectedQualityKey.value;
  setSessionQualityOverride(qualityKey as QualityKey);
  showQualityMenu.value = false;

  if (qualityKey !== prev && isQualitySelectableSong.value && currentSong.value) {
    await playSong(currentSong.value, {
      startTime: currentTime.value,
      preserveQueue: true,
      continueStatisticsSession: true,
    });
  }
};

const toggleVisualizer = () => {
  showFooterTools.value = false;
  isVisualizerEnabled.value = !isVisualizerEnabled.value;
  localStorage.setItem('footer_visualizer_enabled', isVisualizerEnabled.value.toString());
};

const toggleProgressVisibility = () => {
  isProgressHidden.value = !isProgressHidden.value;
  localStorage.setItem(FOOTER_PROGRESS_HIDDEN_KEY, isProgressHidden.value.toString());
};

// --- 进度条拖拽逻辑 ---
const {
  isDraggingProgress,
  progressBarRef,
  displayProgress,
  progressFillClass,
  progressTrackClass,
  progressThumbClass,
  progressVisualState,
  startProgressDrag,
  stopProgressDrag,
  updateProgressFromEvent,
  currentTimeStr,
  totalTimeStr,
} = useFooterProgressDrag({
  getCurrentSong: () => currentSong.value,
  getCurrentTime: () => currentTime.value,
  seekTo,
  formatDuration,
  isProgressHidden,
  isShowingDetail: showPlayerDetail,
});

const isCurrentRemoteDownloadActive = computed(() => {
  const progress = remoteDownloadProgress.value;
  return !!progress
    && !progress.done
    && !!currentSong.value
    && progress.uri === currentSong.value.path;
});
const remoteDownloadText = computed(() => {
  const progress = remoteDownloadProgress.value;
  if (!progress || progress.percent === null) return '正在加载远程歌曲';
  return `正在加载远程歌曲 ${Math.round(progress.percent)}%`;
});

// --- 歌名滚动（marquee）---
const {
  songTitleWrapperRef,
  songTitleTextRef,
  shouldMarquee,
  marqueeDuration,
  isMarqueePaused,
  songTitleText,
  checkMarquee,
  setupMarqueeObserver,
  disposeMarquee,
} = useFooterMarquee({
  currentSong,
  isShowingDetail: showPlayerDetail,
  footerLayout,
});

// --- 音量拖拽逻辑 / 音量滑块显示逻辑 ---
const {
  isDraggingVolume,
  volumeBarRef,
  showVolumeSlider,
  updateVolume,
  startDrag,
  endDrag,
  handleVolumeEnter,
  handleVolumeLeave,
} = useFooterVolumeDrag({
  setVolume: (volume) => handleVolume({ target: { value: volume.toString() } } as any),
  onPointerEnter: () => handleFooterMouseEnter(),
  onResumeIdle: () => startIdleTimer(),
});

const onGlobalPointerMove = (e: PointerEvent) => {
  if (isDraggingVolume.value) { e.preventDefault(); updateVolume(e.clientY); }
  if (isDraggingProgress.value) { e.preventDefault(); updateProgressFromEvent(e); }
  if (showPlayerDetail.value && mvVideoActive.value && !isPointerOverFooter.value) {
    if (isIdle.value) clearIdle();
    startIdleTimer();
  }
};

const onGlobalPointerEnd = (commitProgress = true) => {
  endDrag();
  stopProgressDrag(commitProgress);
};

const onGlobalPointerUp = () => onGlobalPointerEnd(true);
const onGlobalPointerCancel = () => onGlobalPointerEnd(false);

// --- EQ Panel State ---
const showEqPanel = ref(false);

// --- Bit-perfect / DSD 直通时禁用底栏音量与音质 UI ---
const isBitPerfectActive = computed(() =>
  activeOutputMode.value === 'wasapiExclusive' && settings.value.audio.outputBitPerfect === true,
);
const isDsdPassthroughActive = computed(() =>
  activeOutputMode.value === 'wasapiExclusive' && settings.value.audio.dsdNativePassthrough === true,
);
const isAudioControlLocked = computed(() => isBitPerfectActive.value || isDsdPassthroughActive.value);
const audioLockTooltip = computed(() => {
  if (isBitPerfectActive.value && isDsdPassthroughActive.value) return 'Bit-perfect / DSD 直出中';
  if (isBitPerfectActive.value) return 'Bit-perfect 输出中';
  return 'DSD 直出中';
});

// --- 开启插件机架时锁定音效(EQ)：EQ 排在插件机架之前，双开会双重处理冲突；
// 音量/音质在插件之后仍有效，故不入 isAudioControlLocked，只锁音效。 ---
const pluginHostStore = usePluginHostStore();
const isRackEffectActive = computed(() =>
  pluginHostStore.rackConfig.masterEnabled
  && pluginHostStore.rackConfig.slots.some((s) => s.enabled),
);
const isEffectLocked = computed(() => isAudioControlLocked.value || isRackEffectActive.value);
const effectLockTooltip = computed(() => {
  if (isAudioControlLocked.value) return audioLockTooltip.value;
  if (isRackEffectActive.value) return '插件机架处理中';
  return '';
});

// --- 底栏右侧工具按钮收纳（隐藏进度条/可视化/桌面歌词/均衡器/固定）---
const showFooterTools = ref(false);
const footerToolsRef = ref<HTMLElement | null>(null);
const toggleFooterTools = () => {
  showFooterTools.value = !showFooterTools.value;
};

watch(
  () => settings.value.audio.showEqualizerInFooter,
  (show) => {
    if (show === false) {
      showEqPanel.value = false;
    }
  }
);

const toggleEqPanel = (e: MouseEvent) => {
  e.stopPropagation();
  if (isEffectLocked.value) return;
  showEqPanel.value = !showEqPanel.value;
};

watch(isEffectLocked, (locked) => {
  if (locked) showEqPanel.value = false;
});

const handleWindowClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (showContextMenu.value && !target.closest('.ctx-sheet')) {
    showContextMenu.value = false;
  }
  if (showFooterTools.value && footerToolsRef.value && !footerToolsRef.value.contains(target)) {
    showFooterTools.value = false;
  }
  if (showQualityMenu.value && qualityMenuRef.value && qualityButtonRef.value) {
    if (!qualityMenuRef.value.contains(target) && !qualityButtonRef.value.contains(target)) {
      showQualityMenu.value = false;
    }
  }
  if (showDownloadQualityMenu.value && downloadQualityMenuRef.value && downloadQualityButtonRef.value) {
    if (!downloadQualityMenuRef.value.contains(target) && !downloadQualityButtonRef.value.contains(target)) {
      showDownloadQualityMenu.value = false;
    }
  }
};

// --- Idle State for Auto-Hide ---
const {
  isPinned,
  isIdle,
  isMvCollapsed,
  isMarqueeAnimationPaused,
  clearIdle,
  togglePin,
  startIdleTimer,
  isPointerOverFooter,
  handleFooterMouseEnter,
  handleFooterMouseMove,
  handleFooterMouseLeave,
  disposeIdle,
} = useFooterIdleAutohide({
  isShowingDetail: showPlayerDetail,
  isMvVideoActive: mvVideoActive,
  isLowPower: isMainWindowLowPower,
  isMarqueePaused,
  isExternallyBusy: () =>
    showContextMenu.value || isDraggingProgress.value || isDraggingVolume.value || showVolumeSlider.value,
});

// --- 向 FooterControlItem 共享上下文 ---
provide('footerContext', {
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
  selectedDownloadQuality,
  activeDownloadQualityKey,
  startDownload,
  downloadQualityButtonRef,
  downloadQualityMenuRef,
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
  qualityButtonRef,
  qualityMenuRef,
  volume,
  showVolumeSlider,
  isDraggingVolume,
  handleVolumeEnter,
  handleVolumeLeave,
  handleVolumeWheel,
  volumeBarRef,
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
  toggleComment: wrapToggleComment,
  mvSupport,
  mvActive,
  mvLoading,
  mvPhase,
  mvBufferedSec,
  toggleMv,
  isMvVideoDownloading,
  openShareDialog,
  openDlnaCastDialog,
  isVisualizerEnabled,
  toggleVisualizer,
  isProgressHidden,
  toggleProgressVisibility,
  showLyricsPlayerSettingsPanel,
  toggleLyricsPlayerSettings,
  isPinned,
  togglePin,
});

onMounted(async () => {
  window.addEventListener('pointermove', onGlobalPointerMove);
  window.addEventListener('pointerup', onGlobalPointerUp);
  window.addEventListener('pointercancel', onGlobalPointerCancel);
  window.addEventListener('click', handleWindowClick);
  window.addEventListener('resize', checkMarquee);
  await nextTick();
  setupMarqueeObserver();
  startIdleTimer();
  unlistenRemoteDownload = await listen<RemoteDownloadProgress>('remote-download-progress', event => {
    remoteDownloadProgress.value = event.payload;
  });
});
onUnmounted(() => {
  window.removeEventListener('pointermove', onGlobalPointerMove);
  window.removeEventListener('pointerup', onGlobalPointerUp);
  window.removeEventListener('pointercancel', onGlobalPointerCancel);
  window.removeEventListener('click', handleWindowClick);
  window.removeEventListener('resize', checkMarquee);
  disposeMarquee();
  disposeIdle();
  abortFooterQualityInfoProbe();
  unlistenRemoteDownload?.();
  unlistenRemoteDownload = null;
});
</script>

<template>
  <footer 
    class="player-footer h-20 flex items-center justify-between px-4 z-[60] relative select-none bg-transparent"
    :style="surfaceStyle('nav.bar')"
    @mouseenter="handleFooterMouseEnter"
    @mousemove="handleFooterMouseMove"
    @mouseleave="handleFooterMouseLeave"
  >
    <img
      v-if="sticker('player.corner')"
      :src="sticker('player.corner')"
      alt=""
      class="pointer-events-none absolute bottom-2 right-3 z-10 max-h-14 max-w-20 object-contain opacity-80"
    />

    <div
      v-if="showPlayerDetail && currentSong && isVisualizerEnabled && !mvVideoActive"
      class="pointer-events-none absolute left-5 right-5 top-[-76px] h-16 z-40 transition-opacity duration-500 [mask-image:linear-gradient(90deg,transparent,black_1.5%,black_98.5%,transparent)]"
      :class="isIdle ? 'opacity-25' : 'opacity-100'"
    >
      <AudioVisualizer
        :active="showPlayerDetail && isVisualizerEnabled && !mvVideoActive"
        :is-playing="isPlaying"
        :song-path="currentSong.path"
      />
    </div>

    <div
      ref="progressBarRef"
      class="absolute top-[-10px] left-0 w-full h-[22px] cursor-pointer group/progress z-50 [touch-action:none] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
      :class="[
        isMvCollapsed ? 'translate-y-[78px]' : 'translate-y-0',
        // 音量弹窗打开时让出命中区：弹窗只占 36px 宽，而这里的命中带是 22px 高的整窗
        // 横幅，点弹窗旁边（含透过半透明面板露出来的位置）会误触发跳转。此时鼠标仍在
        // 音量控件上，松开鼠标 300ms 后弹窗关闭，命中区随即可用。
        showVolumeSlider && !isDraggingProgress ? 'pointer-events-none' : '',
      ]"
      @pointerdown="startProgressDrag"
    >
      <div class="absolute inset-y-0 left-0 right-0 flex items-center">
        <div
          class="relative w-full rounded-full transition-[height] duration-200"
          :class="isDraggingProgress ? 'h-[5px]' : 'h-[2px] group-hover/progress:h-[5px]'"
        >
          <div class="absolute inset-0 rounded-full transition-colors duration-200" :class="progressTrackClass"></div>
          <div
            class="absolute inset-y-0 left-0 rounded-full transition-[background-color,opacity] duration-200 overflow-visible"
            :class="[progressFillClass, progressVisualState.trackClass]"
            :style="{ width: displayProgress + '%' }"
          >
            <div
              class="absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 translate-x-1/2 rounded-full transition-all duration-150 z-40 border shadow-[0_2.5px_6px_rgba(0,0,0,0.15)]"
              :class="[progressThumbClass, isDraggingProgress && !isProgressHidden ? 'opacity-100 scale-100' : (isMvCollapsed ? 'opacity-0 scale-75' : progressVisualState.thumbClass)]"
            ></div>

            <div 
              class="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-0 h-0 overflow-visible pointer-events-none z-50"
            >
              <transition name="fade-scale">
                <div
                  v-if="isDraggingProgress && !isProgressHidden"
                  class="absolute bottom-4 left-[-42px] w-[84px] px-2 py-0.5 rounded-md bg-zinc-900/95 text-white text-[10px] font-semibold font-mono tracking-wider whitespace-nowrap shadow-lg border border-white/10 backdrop-blur-sm pointer-events-none select-none flex items-center justify-center text-center"
                >
                  {{ currentTimeStr }}/{{ totalTimeStr }}
                  <div class="absolute top-full left-1/2 -translate-x-1/2 -mt-[1px] border-x-4 border-t-4 border-x-transparent border-t-zinc-900/95"></div>
                </div>
              </transition>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      class="flex h-full min-w-0 flex-1 items-center justify-between transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
      :class="isMvCollapsed ? 'pointer-events-none translate-y-[calc(100%+12px)] opacity-0' : 'translate-y-0 opacity-100'"
    >
    <div
      class="footer-left-section flex items-center w-1/3 min-w-[150px]"
      @contextmenu="handleContextMenu"
    >
      <div
        data-footer-cover
        @click.stop="handleOpenDetail"
        class="group relative w-12 h-12 rounded-lg flex-shrink-0 cursor-pointer active:scale-95 z-10"
      ></div>

      <div
        class="footer-left-content flex-1 relative h-10 transition-transform duration-500 flex items-center gap-1 ml-3 min-w-0"
        :class="showPlayerDetail ? '-translate-x-[60px]' : 'translate-x-0'"
      >
        <div class="footer-track-info overflow-hidden w-28 relative h-full shrink-0">
        <div
          class="absolute inset-0 flex flex-col justify-center transition-all duration-500"
          :class="showPlayerDetail ? 'opacity-0 translate-y-4 pointer-events-none' : 'opacity-100 translate-y-0 text-gray-800 dark:text-white'"
        >
          <div
            class="overflow-hidden w-28 cursor-pointer"
            ref="songTitleWrapperRef"
            @click.stop="handleOpenDetail"
          >
            <div
              class="inline-block whitespace-nowrap"
              :class="{ 'animate-marquee': shouldMarquee }"
              :style="shouldMarquee ? {
                '--marquee-duration': marqueeDuration + 's',
                animationPlayState: isMarqueeAnimationPaused ? 'paused' : 'running'
              } : {}"
              @mouseenter="isMarqueePaused = shouldMarquee"
              @mouseleave="isMarqueePaused = false"
            >
              <span class="text-sm font-bold tracking-wide cursor-default pr-2" ref="songTitleTextRef">{{ songTitleText }}</span>
              <span v-if="shouldMarquee" class="text-sm font-bold tracking-wide cursor-default pr-2">{{ songTitleText }}</span>
            </div>
          </div>
          <div class="text-[11px] font-medium mt-0.5 cursor-default truncate text-gray-500 dark:text-gray-400">
            {{ isCurrentRemoteDownloadActive ? remoteDownloadText : (currentSong ? currentSong.artist : 'My Music') }}
          </div>
        </div>

        <div
          class="absolute inset-0 flex flex-col justify-center transition-all duration-500"
          :class="showPlayerDetail
            ? (isIdle ? 'opacity-0 translate-y-4 pointer-events-none text-white/90' : 'opacity-100 translate-y-0 text-white/90')
            : 'opacity-0 -translate-y-4 pointer-events-none'"
        >
          <div class="text-[12px] font-semibold tabular-nums cursor-default tracking-wide">
            {{ currentTimeStr }} <span class="opacity-50 mx-1">/</span> {{ totalTimeStr }}
          </div>
        </div>
        </div>

        <div
          class="footer-left-controls flex items-center gap-1 transition-opacity duration-700"
          :class="{ 'opacity-0 pointer-events-none': isIdle }"
        >
          <FooterControlItem v-for="key in leftItems" :key="key" :item-key="key" />
        </div>
      </div>
    </div>

    <div
      class="footer-center-section flex items-center justify-center flex-1 gap-6 transition-opacity duration-700"
      :class="{ 'opacity-0 pointer-events-none': isIdle }"
    >
      <FooterControlItem v-if="middleLeftItem" :item-key="middleLeftItem" />

      <button @click="prevSong"
        class="transition-colors hover:scale-110 transform duration-200"
        :class="showPlayerDetail ? 'text-white/80 hover:text-white' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white'"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" /></svg>
      </button>

      <button @click="togglePlay"
        class="flex items-center justify-center transition-all active:scale-95 shrink-0 w-11 h-11 rounded-full border"
        :class="showPlayerDetail
          ? 'text-white bg-white/10 hover:bg-white/20 border-white/5'
          : 'text-gray-800 dark:text-white bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 border-black/5 dark:border-white/5'"
      >
        <svg v-if="isPlaying" xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 fill-current" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-7 w-7 fill-current" viewBox="0 0 24 24"><path d="M8.3 5v14l11-7z" /></svg>
      </button>

      <button @click="nextSong"
        class="transition-colors hover:scale-110 transform duration-200"
        :class="showPlayerDetail ? 'text-white/80 hover:text-white' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white'"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
      </button>

      <FooterControlItem v-if="middleRightItem" :item-key="middleRightItem" />
    </div>

    <div 
      class="footer-right-section flex items-center justify-end w-1/3 min-w-[150px] gap-2 pr-2 transition-opacity duration-700"
      :class="{ 'opacity-0 pointer-events-none': isIdle }"
    > 
      <FooterControlItem v-for="key in rightItems" :key="key" :item-key="key" />

      <div ref="footerToolsRef" class="relative flex items-center justify-center h-full z-[70]">
        <transition name="footer-tools">
          <div
            v-if="showFooterTools"
            class="absolute right-0 pb-1 flex flex-col items-center gap-2 z-[75]"
            :class="showPlayerDetail ? 'bottom-[calc(100%+54px)]' : 'bottom-[calc(100%+28px)]'"
          >
            <FooterControlItem v-for="key in collapsedItems" :key="'collapsed-' + key" :item-key="key" />
          </div>
        </transition>

        <button
          @click="toggleFooterTools"
          :class="['transition-colors w-8 h-8 flex items-center justify-center rounded-full', showFooterTools ? 'text-[#EC4141] bg-[#EC4141]/10' : (showPlayerDetail ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10')]"
          :title="showFooterTools ? '收起工具' : '更多工具'"
        >
          <ChevronUp
            class="h-4 w-4 transition-transform duration-300 ease-out"
            :class="showFooterTools ? 'rotate-180' : ''"
            :stroke-width="2.2"
          />
        </button>
      </div>
    </div>
    </div>
        <FooterContextMenu
          v-if="showContextMenu"
          :visible="showContextMenu"
          :x="contextMenuX"
          :y="contextMenuY"
          :song="currentSong"
          :video-background-requested="mvActive"
          :video-background-loading="mvLoading"
          @close="showContextMenu = false"
          @change-lyrics="lyricsReplacementVisible = true"
          @toggle-video-background="toggleMv"
        />

        <LyricsReplacementModal
          v-if="lyricsReplacementVisible"
          :visible="lyricsReplacementVisible"
          :song="currentSong"
          @close="lyricsReplacementVisible = false"
        />

        <ModernModal
          v-if="showRedownloadConfirm"
          v-model:visible="showRedownloadConfirm"
          title="歌曲已下载"
          :content="redownloadContent"
          cancel-text="取消"
          confirm-text="重新下载"
          type="info"
          @confirm="handleConfirmRedownload"
        />

        <DlnaCastDialog v-model:visible="showDlnaCastDialog" />

        <ShareSongDialog
          v-model:visible="showShareDialog"
          :song="currentSong"
          @copy="handleShareCopy"
          @cast="handleShareCast"
        />

        <Teleport to="body">
          <Transition name="modal-pop">
            <div
              v-if="showMvDownloadQualityModal"
              class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm"
              @click.self="showMvDownloadQualityModal = false"
            >
              <div class="modal-content bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-80 overflow-hidden">
                <div class="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
                  <h3 class="font-bold text-gray-800 dark:text-gray-200 text-sm">选择 MV 下载画质</h3>
                  <button
                    @click="showMvDownloadQualityModal = false"
                    class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >✕</button>
                </div>
                <div class="max-h-80 overflow-y-auto custom-scrollbar p-3">
                  <div class="grid grid-cols-3 gap-1.5">
                    <button
                      v-for="option in mvDownloadQualityOptions"
                      :key="option.key"
                      type="button"
                      class="px-2 py-2 text-xs font-semibold rounded-md transition-colors text-center whitespace-nowrap flex flex-col items-center gap-0.5"
                      :class="mvDownloadDefaultQuality === option.key
                        ? 'bg-[#EC4141] text-white shadow-sm'
                        : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'"
                      @click="downloadMvWithQuality(option.key)"
                    >
                      <span>{{ option.label }}</span>
                      <span
                        v-if="option.key === videoBackground.activeQuality.value"
                        class="text-[10px] font-normal opacity-75"
                        :class="mvDownloadDefaultQuality === option.key ? '' : 'text-gray-400 dark:text-gray-500'"
                      >当前播放</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Transition>
        </Teleport>

      </footer>

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

.footer-tools-enter-active,
.footer-tools-leave-active {
  transition: opacity 0.28s cubic-bezier(0.34, 1.56, 0.64, 1),
    transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.footer-tools-enter-from,
.footer-tools-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.9);
}

.footer-tools-enter-to,
.footer-tools-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
}

@keyframes footer-marquee {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

.animate-marquee {
  animation: footer-marquee var(--marquee-duration, 12s) linear infinite;
}

@media (max-width: 720px) {
  .player-footer {
    padding-left: 12px;
    padding-right: 10px;
  }

  .footer-left-section {
    width: auto;
    min-width: 52px;
    flex: 0 0 auto;
  }

  .footer-left-content {
    display: none;
  }

  .footer-center-section {
    gap: 14px;
    min-width: 0;
  }

  .footer-right-section {
    width: auto;
    min-width: 44px;
    flex: 0 0 auto;
    gap: 4px;
    padding-right: 0;
  }
}

@media (max-width: 560px) {
  .player-footer {
    padding-left: 10px;
    padding-right: 8px;
  }

  .footer-center-section {
    gap: 8px;
  }

  .footer-right-section {
    gap: 2px;
  }
}
</style>
