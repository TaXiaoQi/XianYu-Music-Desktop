<script setup lang="ts">
import { AudioLines, ChevronUp, Eye, EyeOff } from 'lucide-vue-next';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useLibraryCollections } from '../../features/collections/useLibraryCollections';
import { useLyrics } from '../../composables/lyrics';
import { useToast } from '../../composables/toast';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import AudioVisualizer from '../player/AudioVisualizer.vue';
import FooterContextMenu from "../overlays/FooterContextMenu.vue";
import { isDownloadableOnlineSong } from '../../services/downloadService';
import { checkDownloadExists, type DownloadRecord } from '../../services/downloadHistory';
import ModernModal from '../common/ModernModal.vue';
import { useSettings } from '../../features/settings/useSettings';
import { useDownloadStore } from '../../features/download/store';
import { downloadToLocal } from '../../composables/useDownloadToLocal';
import { computed, ref, onMounted, onUnmounted, watch, nextTick, provide } from 'vue';
import FooterControlItem from './FooterControlItem.vue';
import type { DownloadQuality, QualityKey, RemoteDownloadProgress } from '../../types';
import { QUALITY_META } from '../../types';
import {
  FOOTER_PROGRESS_HIDDEN_KEY,
  getProgressVisualState,
  readStoredProgressHidden
} from './playerFooterProgress';

const {
  currentSong,
  currentAvailableQualities,
  currentPlayingQuality,
  sessionQualityOverride,
  setSessionQualityOverride,
  isPlaying, volume, playbackSpeed, currentTime, playMode, showPlaylist, showPlayerDetail,
  togglePlay, nextSong, prevSong, handleVolume, handleVolumeWheel, toggleMute,
  handlePlaybackSpeed, handlePlaybackSpeedWheel, resetPlaybackSpeed,
  toggleMode, togglePlaylist,
  togglePlayerDetail, seekTo, formatDuration, playSong,
} = usePlaybackController();
const { isFavorite, toggleFavorite } = useLibraryCollections();

const handleOpenDetail = () => {
  togglePlayerDetail();
};

const { showDesktopLyrics, showLyricsPlayerSettingsPanel, parsedLyrics } = useLyrics();
const { settings, footerLayout } = useSettings();
const { showToast } = useToast();
const downloadStore = useDownloadStore();

// --- 底部栏容器化布局 ---
// footerLayout 来自 settings store，设置页直接修改即可在底栏实时反映（无需 Apply）。
// 各容器容量由 FOOTER_CONTAINER_LIMITS 约束；未分配的控件自动进入折叠收纳菜单。
import {
  computeCollapsedItems,
  normalizeFooterLayout,
} from '../../features/settings/footerItems';

/** 归一化后的当前布局（防御性处理，确保任何来源都合法） */
const normalizedLayout = computed(() => normalizeFooterLayout(footerLayout.value));
/** 左侧容器控件（最多 2 个） */
const leftItems = computed(() => normalizedLayout.value.left.filter(key => !normalizedLayout.value.hidden.includes(key)));
/** 中间左侧控件（最多 1 个，紧邻"上一首"） */
const middleLeftItem = computed(() => normalizedLayout.value.middleLeft && !normalizedLayout.value.hidden.includes(normalizedLayout.value.middleLeft)
  ? normalizedLayout.value.middleLeft
  : null);
/** 中间右侧控件（最多 1 个，紧邻"下一首"） */
const middleRightItem = computed(() => normalizedLayout.value.middleRight && !normalizedLayout.value.hidden.includes(normalizedLayout.value.middleRight)
  ? normalizedLayout.value.middleRight
  : null);
/** 右侧容器控件（最多 5 个） */
const rightItems = computed(() => normalizedLayout.value.right.filter(key => !normalizedLayout.value.hidden.includes(key)));
/** 折叠收纳菜单中的控件（未分配到任何容器） */
const collapsedItems = computed(() => computeCollapsedItems(normalizedLayout.value));

// --- 下载功能 ---
// 底栏下载：点击展开音质下拉（复用播放音质选择 UI），选择音质后直接触发下载。
// 下载设置（目录/文件名样式/歌词等）在设置-下载页配置，底栏不再弹对话框。
const isOnlineSong = computed(() => isDownloadableOnlineSong(currentSong.value));

// 已下载状态：当前歌曲若有下载记录且文件仍存在，按钮显示为「已下载」
const downloadedRecord = ref<DownloadRecord | null>(null);
const showRedownloadConfirm = ref(false);
// [下载联动] isDownloading 来自共享 store：右键菜单下载同一首歌时底栏也会显示「下载中」动画
const isDownloading = computed(() => {
  if (!downloadStore.isDownloading) return false;
  const song = currentSong.value;
  if (!song) return false;
  const songPath = song.cue_source_path || song.path;
  return downloadStore.downloadingSongPath === songPath;
});
// 防止快速切歌时旧的异步检测结果覆盖新歌状态
let downloadCheckId = 0;

/** 检测当前歌曲是否已下载（文件仍存在）。文件已被删除时记录会被自动清理。 */
const refreshDownloadedState = async () => {
  const requestId = ++downloadCheckId;
  const song = currentSong.value;
  const songPath = song?.cue_source_path || song?.path || '';

  if (!isOnlineSong.value || !songPath) {
    downloadedRecord.value = null;
    return;
  }

  const record = await checkDownloadExists(songPath);
  // 检测期间已切歌，丢弃这次结果
  if (requestId !== downloadCheckId) return;
  downloadedRecord.value = record;
};

watch(
  () => currentSong.value?.cue_source_path || currentSong.value?.path,
  () => { void refreshDownloadedState(); },
  { immediate: true },
);

// [下载联动] 任意下载完成（store.isDownloading 从 true→false）时刷新当前歌曲的已下载状态，
// 确保右键菜单下载当前歌曲后底栏立即显示「已下载」对勾
watch(
  () => downloadStore.isDownloading,
  (downloading, wasDownloading) => {
    if (wasDownloading && !downloading) {
      void refreshDownloadedState();
    }
  },
);

// 下载音质下拉菜单（与播放音质选择器 UI 一致，复用 currentAvailableQualities 预取结果）
const showDownloadQualityMenu = ref(false);
const downloadQualityButtonRef = ref<HTMLElement | null>(null);
const downloadQualityMenuRef = ref<HTMLElement | null>(null);

/** 当前歌曲可用的下载音质选项（与播放音质共用 currentAvailableQualities 预取结果） */
const DOWNLOAD_QUALITY_OPTIONS = computed(() => {
  const supported = currentAvailableQualities.value;
  if (!supported || supported.length === 0) return ALL_QUALITY_OPTIONS;
  return ALL_QUALITY_OPTIONS.filter(opt => supported.includes(opt.value));
});

/** 当前选择的下载音质（来自设置 store，默认 '320k'） */
const selectedDownloadQuality = computed<DownloadQuality>(
  () => (settings.value.download.quality as DownloadQuality) ?? '320k',
);

const handleDownloadClick = () => {
  if (!isOnlineSong.value || isDownloading.value) return;
  // 已下载过：先弹确认，让用户决定是否重新下载
  if (downloadedRecord.value) {
    showRedownloadConfirm.value = true;
    return;
  }
  // 关闭播放音质菜单，避免两个下拉同时打开
  showQualityMenu.value = false;
  showDownloadQualityMenu.value = !showDownloadQualityMenu.value;
};

/** 确认重新下载：确认后展开音质下拉选择档位 */
const handleConfirmRedownload = () => {
  showDownloadQualityMenu.value = true;
};

/** 选择下载音质并立即开始下载（复用共享下载逻辑，状态写入 download store 驱动底栏动画） */
const startDownload = async (qualityKey: DownloadQuality) => {
  showDownloadQualityMenu.value = false;
  if (!currentSong.value) return;
  await downloadToLocal(currentSong.value, qualityKey);
};

const downloadButtonTitle = computed(() => {
  if (!isOnlineSong.value) return '本地文件';
  if (isDownloading.value) return '下载中…';
  if (downloadedRecord.value) return `已下载：${downloadedRecord.value.fileName}（点击重新下载）`;
  return '下载歌曲';
});

const redownloadContent = computed(() => {
  const name = downloadedRecord.value?.fileName || '';
  return name
    ? `此歌曲已下载过了（${name}），是否要重新下载？`
    : '此歌曲已下载过了，是否要重新下载？';
});

// --- Context Menu State ---
const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);

const handleContextMenu = (e: MouseEvent) => {
  if (!currentSong.value) return;
  e.preventDefault();
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
};

const toggleLyrics = () => { showDesktopLyrics.value = !showDesktopLyrics.value; };
const toggleLyricsPlayerSettings = () => {
  // 无歌词时不打开面板，提示用户
  if (!showLyricsPlayerSettingsPanel.value && parsedLyrics.value.length === 0) {
    showToast('当前歌曲无歌词', 'info');
    return;
  }
  showLyricsPlayerSettingsPanel.value = !showLyricsPlayerSettingsPanel.value;
  // 打开歌词样式面板时收起底栏工具弹窗，避免弹窗遮挡歌词样式面板
  if (showLyricsPlayerSettingsPanel.value) {
    showFooterTools.value = false;
  }
};
const isVisualizerEnabled = ref(localStorage.getItem('footer_visualizer_enabled') !== 'false');
const isProgressHidden = ref(readStoredProgressHidden(localStorage));
const remoteDownloadProgress = ref<RemoteDownloadProgress | null>(null);
let unlistenRemoteDownload: UnlistenFn | null = null;

// 音质选择：使用统一 QualityKey（12 档：mgg / 128k / 192k / 320k / flac / flac24bit / hires / vinyl / dolby / atmos / atmos_plus / master）

/** 全部音质选项（按 rank 排序） */
const ALL_QUALITY_OPTIONS: Array<{ label: string; value: QualityKey; description: string }> =
  (Object.keys(QUALITY_META) as QualityKey[])
    .sort((a, b) => QUALITY_META[a].rank - QUALITY_META[b].rank)
    .map(k => ({
      label: QUALITY_META[k].label,
      value: k,
      description: QUALITY_META[k].description,
    }));

/** 当前歌曲可用的音质选项（根据插件/音源实际支持过滤，null 时回退到全部） */
const QUALITY_OPTIONS = computed(() => {
  const supported = currentAvailableQualities.value;
  if (!supported || supported.length === 0) return ALL_QUALITY_OPTIONS;
  return ALL_QUALITY_OPTIONS.filter(opt => supported.includes(opt.value));
});

/** 音质英文缩写映射（底栏按钮显示用，下拉菜单仍用完整中文标签） */
const QUALITY_ABBR: Record<QualityKey, string> = {
  mgg: 'LQ',
  '128k': '128',
  '192k': '192',
  '320k': 'HQ',
  flac: 'SQ',
  flac24bit: 'HR',
  hires: 'HRA',
  vinyl: 'VL',
  dolby: 'DA',
  atmos: 'AT',
  atmos_plus: 'AT+',
  master: 'MS',
};

/**
 * 当前选择的音质 Key。
 * 优先使用底部栏会话级临时覆盖（sessionQualityOverride），未设置时回退到设置页的在线播放音质。
 * 注意：底部栏切换音质只写入 sessionQualityOverride，不修改 settings，因此不会同步到设置页。
 */
const selectedQualityKey = computed<QualityKey>(
  () => sessionQualityOverride.value
    ?? (settings.value.audio.onlineDefaultQuality as QualityKey) ?? '320k',
);
/** 在线歌曲：显示在按钮上的音质英文缩写（LQ/128/192/HQ/SQ/HR/HRA/VL/DA/AT/AT+/MS）
 *  优先使用实际播放音质（经回退逻辑解析后真正命中的档位），
 *  避免出现底部栏选择的音质和播放的音质不符的情况。
 *  仅当实际播放音质未知（如尚未解析完成）时回退到用户设置的首选音质。
 */
const currentQualityLabel = computed(
  () => QUALITY_ABBR[currentPlayingQuality.value ?? selectedQualityKey.value] ?? 'HQ',
);

/** 本地歌曲：取 format/codec/container 字段，或从路径末尾提取扩展名，全大写显示 */
const localFormatLabel = computed(() => {
  const song = currentSong.value;
  if (!song) return '';
  const raw = song.format || song.codec || song.container;
  if (raw) return raw.toUpperCase();
  const ext = song.path.split('.').pop();
  return ext ? ext.toUpperCase() : '';
});

/** 本地歌曲：根据 format/codec/bitrate/bit_depth 映射到音质英文缩写（SQ/HQ/HR 等） */
const localQualityLabel = computed(() => {
  const song = currentSong.value;
  if (!song) return 'HQ';
  // 24位无损 → HR (Hi-Res)
  if (song.bit_depth && song.bit_depth >= 24) return QUALITY_ABBR.flac24bit;
  // 无损格式 → SQ
  const fmt = (song.format || song.codec || song.container || '').toLowerCase();
  const losslessFormats = ['flac', 'ape', 'wav', 'alac', 'aiff', 'dsd', 'dff', 'dsf'];
  if (losslessFormats.some(f => fmt.includes(f))) return QUALITY_ABBR.flac;
  // 有损格式按比特率映射
  const bitrateKbps = song.bitrate
    ? (song.bitrate > 1000 ? Math.round(song.bitrate / 1000) : song.bitrate)
    : 0;
  if (bitrateKbps >= 320) return QUALITY_ABBR['320k'];
  if (bitrateKbps >= 192) return QUALITY_ABBR['192k'];
  if (bitrateKbps >= 128) return QUALITY_ABBR['128k'];
  if (bitrateKbps > 0) return QUALITY_ABBR.mgg;
  // 无法判断时回退到格式名
  return localFormatLabel.value || 'HQ';
});

/** 按钮实际显示文字：在线歌曲显示音质标签，本地歌曲显示映射后的音质标签 */
const qualityButtonLabel = computed(() =>
  isQualitySelectableSong.value ? currentQualityLabel.value : localQualityLabel.value,
);

/** 是否是支持音质切换的在线歌曲（lx:// 或 plugin:// 协议） */
const isQualitySelectableSong = computed(() => {
  const path = currentSong.value?.path ?? '';
  return path.startsWith('lx://') || path.startsWith('plugin://');
});

/** 下拉菜单中应高亮的音质：在线歌曲优先使用实际播放音质，
 *  尚未解析完成或本地歌曲回退到用户设置的首选音质。
 *  这样即使因回退逻辑命中的档位与首选不同，下拉也能准确反映当前播放状态。 */
const activeQualityKey = computed<QualityKey>(
  () => currentPlayingQuality.value ?? selectedQualityKey.value,
);

const showQualityMenu = ref(false);
const qualityButtonRef = ref<HTMLElement | null>(null);
const qualityMenuRef = ref<HTMLElement | null>(null);

const toggleQualityMenu = (e: MouseEvent) => {
  if (!isQualitySelectableSong.value) return; // 本地歌曲或不支持的在线歌曲：禁用
  e.stopPropagation();
  // 关闭下载音质菜单，避免两个下拉同时打开
  showDownloadQualityMenu.value = false;
  showQualityMenu.value = !showQualityMenu.value;
};

const selectQuality = async (qualityKey: QualityKey) => {
  const prev = selectedQualityKey.value;
  // 仅写入会话级临时覆盖，不修改 settings，避免同步到设置页的「在线播放音质」。
  // 播放链路（playerPlayback）会优先读取 sessionQualityOverride。
  setSessionQualityOverride(qualityKey);
  showQualityMenu.value = false;

  // 若当前正在播放可切换音质的在线歌曲且音质发生了变化，立即重新播放以应用新音质
  if (qualityKey !== prev && isQualitySelectableSong.value && currentSong.value) {
    await playSong(currentSong.value, {
      startTime: currentTime.value,
      preserveQueue: true,
      continueStatisticsSession: true,
    });
  }
};

const toggleVisualizer = () => {
  isVisualizerEnabled.value = !isVisualizerEnabled.value;
  localStorage.setItem('footer_visualizer_enabled', isVisualizerEnabled.value.toString());
};

const toggleProgressVisibility = () => {
  isProgressHidden.value = !isProgressHidden.value;
  localStorage.setItem(FOOTER_PROGRESS_HIDDEN_KEY, isProgressHidden.value.toString());
};

// 不再使用单独的模糊样式 -> 全透明

// --- 进度条拖拽逻辑 ---
const isDraggingProgress = ref(false);
const progressBarRef = ref<HTMLElement | null>(null);
const dragTime = ref(0); 

const displayProgress = computed(() => {
  if (!currentSong.value || currentSong.value.duration <= 0) return 0;
  const time = isDraggingProgress.value ? dragTime.value : currentTime.value;
  return Math.max(0, Math.min(100, (time / currentSong.value.duration) * 100));
});

const progressFillClass = computed(() => (
  showPlayerDetail.value
    ? 'bg-zinc-300/30'
    : 'bg-zinc-300/30'
));

const progressTrackClass = computed(() => (
  showPlayerDetail.value
    ? 'bg-transparent'
    : 'bg-transparent'
));

const progressThumbClass = computed(() => (
  showPlayerDetail.value
    ? 'border-white/45 bg-white'
    : 'border-black/10 dark:border-white/20 bg-white'
));

const progressVisualState = computed(() => getProgressVisualState(isProgressHidden.value, isDraggingProgress.value));

const startProgressDrag = (e: PointerEvent) => { 
  if (!currentSong.value || currentSong.value.duration <= 0) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
  isDraggingProgress.value = true; 
  updateProgressFromEvent(e); 
};

const stopProgressDrag = async (commit = true) => { 
  if (isDraggingProgress.value) { 
    const targetTime = dragTime.value;
    isDraggingProgress.value = false; 
    if (commit) {
      await seekTo(targetTime);
    }
  } 
};

const updateProgressFromEvent = (e: PointerEvent) => {
  if (!progressBarRef.value || !currentSong.value || currentSong.value.duration <= 0) return;
  const rect = progressBarRef.value.getBoundingClientRect();
  const offsetX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  dragTime.value = (offsetX / rect.width) * currentSong.value.duration;
};

// 计算总时长与当前时间
const currentTimeStr = computed(() => formatDuration(isDraggingProgress.value ? dragTime.value : currentTime.value));
const totalTimeStr = computed(() => currentSong.value ? formatDuration(currentSong.value.duration) : '0:00');
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
const songTitleWrapperRef = ref<HTMLElement | null>(null);
const songTitleTextRef = ref<HTMLElement | null>(null);
const shouldMarquee = ref(false);
const marqueeDuration = ref(12);
const isMarqueePaused = ref(false);

const songTitleText = computed(() => {
  if (!currentSong.value) return '听我想听的音乐';
  return currentSong.value.title || currentSong.value.name.replace(/\.[^/.]+$/, "");
});

const checkMarquee = () => {
  nextTick(() => {
    const wrapper = songTitleWrapperRef.value;
    const span = songTitleTextRef.value;
    if (!wrapper || !span) {
      shouldMarquee.value = false;
      return;
    }
    const overflow = span.scrollWidth - wrapper.clientWidth;
    if (overflow > 0) {
      shouldMarquee.value = true;
      // 基础 6 秒 + 每 25px 多出 1 秒，范围 8-30 秒，长歌名滚动更慢便于阅读
      marqueeDuration.value = Math.max(8, Math.min(30, 6 + overflow / 25));
    } else {
      shouldMarquee.value = false;
      isMarqueePaused.value = false;
    }
  });
};

watch(songTitleText, () => checkMarquee());
watch(showPlayerDetail, () => checkMarquee());
// 封面加载完成后容器宽度可能变化，重新检测滚动
watch(currentSong, () => nextTick(() => checkMarquee()), { deep: false });

// --- 音量拖拽逻辑 ---
const isDraggingVolume = ref(false);
const volumeBarRef = ref<HTMLElement | null>(null);

const updateVolume = (clientY: number) => {
  if (!volumeBarRef.value) return;
  const rect = volumeBarRef.value.getBoundingClientRect();
  const height = rect.height;
  const distance = rect.bottom - clientY;
  const percent = Math.max(0, Math.min(1, distance / height));
  const newVol = Math.round(percent * 100);
  handleVolume({ target: { value: newVol.toString() } } as any);
};

const startDrag = (e: PointerEvent) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
  isDraggingVolume.value = true;
  updateVolume(e.clientY);
};

// --- 倍速拖拽逻辑（与音量一致） ---
const isDraggingSpeed = ref(false);
const speedBarRef = ref<HTMLElement | null>(null);
// 倍速范围 0.5x ~ 2.0x，映射到滑块 0~100%
const speedPercent = computed(() => Math.round((playbackSpeed.value - 0.5) / 1.5 * 100));

const updateSpeed = (clientY: number) => {
  if (!speedBarRef.value) return;
  const rect = speedBarRef.value.getBoundingClientRect();
  const height = rect.height;
  const distance = rect.bottom - clientY;
  const percent = Math.max(0, Math.min(1, distance / height));
  const newSpeed = Math.round((0.5 + percent * 1.5) * 100) / 100;
  handlePlaybackSpeed(newSpeed);
};

const startSpeedDrag = (e: PointerEvent) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
  isDraggingSpeed.value = true;
  updateSpeed(e.clientY);
};

const onGlobalPointerMove = (e: PointerEvent) => {
  if (isDraggingVolume.value) { e.preventDefault(); updateVolume(e.clientY); }
  if (isDraggingSpeed.value) { e.preventDefault(); updateSpeed(e.clientY); }
  if (isDraggingProgress.value) { e.preventDefault(); updateProgressFromEvent(e); }
};

const onGlobalPointerEnd = (commitProgress = true) => {
  isDraggingVolume.value = false;
  isDraggingSpeed.value = false;
  stopProgressDrag(commitProgress);
};

const onGlobalPointerUp = () => onGlobalPointerEnd(true);
const onGlobalPointerCancel = () => onGlobalPointerEnd(false);

// --- 音量滑块显示逻辑 ---
const showVolumeSlider = ref(false);
let volumeTimer: any = null;

const handleVolumeEnter = () => {
  if (volumeTimer) clearTimeout(volumeTimer);
  showVolumeSlider.value = true;
  handleFooterMouseEnter(); // Also stop idle timer
};

const handleVolumeLeave = () => {
  volumeTimer = setTimeout(() => {
    if (!isDraggingVolume.value) {
      showVolumeSlider.value = false;
      // If we left the volume slider, check if we should start footer idle timer
      startIdleTimer();
    }
  }, 300);
};

// --- 倍速滑块显示逻辑（与音量一致） ---
const showSpeedSlider = ref(false);
let speedTimer: any = null;

const handleSpeedEnter = () => {
  if (speedTimer) clearTimeout(speedTimer);
  showSpeedSlider.value = true;
  handleFooterMouseEnter();
};

const handleSpeedLeave = () => {
  speedTimer = setTimeout(() => {
    if (!isDraggingSpeed.value) {
      showSpeedSlider.value = false;
      startIdleTimer();
    }
  }, 300);
};

const speedLabel = computed(() => `${playbackSpeed.value.toFixed(2)}x`);

// --- EQ Panel State ---
const showEqPanel = ref(false);

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
  showEqPanel.value = !showEqPanel.value;
};

const handleWindowClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
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
// 主底栏与播放详情页底栏使用各自独立的 pinned 和 idle 状态，互不影响
const isPinnedFooter = ref(localStorage.getItem('footer_pinned') === 'true');
const isPinnedDetail = ref(localStorage.getItem('footer_pinned_detail') === 'true');
const isPinned = computed(() => showPlayerDetail.value ? isPinnedDetail.value : isPinnedFooter.value);

const isIdleFooter = ref(false);
const isIdleDetail = ref(false);
const isIdle = computed(() => showPlayerDetail.value ? isIdleDetail.value : isIdleFooter.value);
let idleTimer: any = null;

const clearIdle = () => {
  if (showPlayerDetail.value) {
    isIdleDetail.value = false;
  } else {
    isIdleFooter.value = false;
  }
};

const togglePin = () => {
  if (showPlayerDetail.value) {
    isPinnedDetail.value = !isPinnedDetail.value;
    localStorage.setItem('footer_pinned_detail', isPinnedDetail.value.toString());
    if (!isPinnedDetail.value) {
      startIdleTimer();
    } else {
      isIdleDetail.value = false;
      if (idleTimer) clearTimeout(idleTimer);
    }
  } else {
    isPinnedFooter.value = !isPinnedFooter.value;
    localStorage.setItem('footer_pinned', isPinnedFooter.value.toString());
    if (!isPinnedFooter.value) {
      startIdleTimer();
    } else {
      isIdleFooter.value = false;
      if (idleTimer) clearTimeout(idleTimer);
    }
  }
};

const startIdleTimer = () => {
  if (idleTimer) clearTimeout(idleTimer);
  // Do not hide if context menu, dragging, or volume slider is active
  if (showContextMenu.value || isDraggingProgress.value || isDraggingVolume.value || isDraggingSpeed.value || showVolumeSlider.value || showSpeedSlider.value || isPinned.value) return;

  idleTimer = setTimeout(() => {
    if (showPlayerDetail.value) {
      isIdleDetail.value = true;
    } else {
      isIdleFooter.value = true;
    }
  }, 2000);
};

const handleFooterMouseEnter = () => {
  clearIdle();
  if (idleTimer) clearTimeout(idleTimer);
};

const handleFooterMouseMove = () => {
  if (isIdle.value) clearIdle();
  if (idleTimer) clearTimeout(idleTimer);
};

const handleFooterMouseLeave = () => {
  startIdleTimer();
};

// 切换页面时重置目标页面的 idle 状态并重新计时，避免详情页隐藏状态泄漏到主页
watch(showPlayerDetail, () => {
  clearIdle();
  if (idleTimer) clearTimeout(idleTimer);
  startIdleTimer();
});

// --- 向 FooterControlItem 共享上下文 ---
// 所有控件状态、事件处理函数、模板引用通过 provide/inject 共享，
// 使 FooterControlItem 可在任意容器中渲染任意控件且行为一致。
provide('footerContext', {
  // 通用
  currentSong,
  showPlayerDetail,
  // 收藏
  isFavorite,
  toggleFavorite,
  // 下载
  isOnlineSong,
  isDownloading,
  downloadedRecord,
  handleDownloadClick,
  downloadButtonTitle,
  showDownloadQualityMenu,
  DOWNLOAD_QUALITY_OPTIONS,
  selectedDownloadQuality,
  startDownload,
  downloadQualityButtonRef,
  downloadQualityMenuRef,
  // 播放模式
  playMode,
  toggleMode,
  // 桌面歌词
  showDesktopLyrics,
  toggleLyrics,
  // 音质
  isQualitySelectableSong,
  qualityButtonLabel,
  showQualityMenu,
  toggleQualityMenu,
  QUALITY_OPTIONS,
  activeQualityKey,
  selectQuality,
  qualityButtonRef,
  qualityMenuRef,
  // 倍速
  playbackSpeed,
  showSpeedSlider,
  isDraggingSpeed,
  handleSpeedEnter,
  handleSpeedLeave,
  handlePlaybackSpeedWheel,
  speedLabel,
  speedBarRef,
  startSpeedDrag,
  speedPercent,
  resetPlaybackSpeed,
  // 音量
  volume,
  showVolumeSlider,
  isDraggingVolume,
  handleVolumeEnter,
  handleVolumeLeave,
  handleVolumeWheel,
  volumeBarRef,
  startDrag,
  toggleMute,
  // 均衡器
  showEqPanel,
  toggleEqPanel,
  // 播放队列
  showPlaylist,
  togglePlaylist,
});

onMounted(async () => {
  window.addEventListener('pointermove', onGlobalPointerMove);
  window.addEventListener('pointerup', onGlobalPointerUp);
  window.addEventListener('pointercancel', onGlobalPointerCancel);
  window.addEventListener('click', handleWindowClick);
  window.addEventListener('resize', checkMarquee);
  checkMarquee();
  startIdleTimer(); // Start initial idle timer
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
  if (idleTimer) clearTimeout(idleTimer);
  unlistenRemoteDownload?.();
  unlistenRemoteDownload = null;
});
</script>

<template>
  <footer 
    class="h-20 flex items-center justify-between px-4 z-[60] relative select-none bg-transparent"
    @mouseenter="handleFooterMouseEnter"
    @mousemove="handleFooterMouseMove"
    @mouseleave="handleFooterMouseLeave"
  >
    
    <div
      v-if="showPlayerDetail && currentSong && isVisualizerEnabled"
      class="pointer-events-none absolute left-5 right-5 top-[-76px] h-16 z-40 transition-opacity duration-500 [mask-image:linear-gradient(90deg,transparent,black_1.5%,black_98.5%,transparent)]"
      :class="isIdle ? 'opacity-25' : 'opacity-100'"
    >
      <AudioVisualizer
        :active="showPlayerDetail && isVisualizerEnabled"
        :is-playing="isPlaying"
        :song-path="currentSong.path"
      />
    </div>

    <div 
      ref="progressBarRef"
      class="absolute top-[-10px] left-0 w-full h-[22px] cursor-pointer group/progress z-50 [touch-action:none]"
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
            <!-- 白色滑块圆球 (Thumb) -->
            <div
              class="absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 translate-x-1/2 rounded-full transition-all duration-150 z-40 border shadow-[0_2.5px_6px_rgba(0,0,0,0.15)]"
              :class="[progressThumbClass, isDraggingProgress && !isProgressHidden ? 'opacity-100 scale-100' : progressVisualState.thumbClass]"
            ></div>

            <!-- 拖拽时间提示气泡的外层定位容器 (与白色滑块平级) -->
            <div 
              class="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-0 h-0 overflow-visible pointer-events-none z-50"
            >
              <!-- 内层负责 Vue transition 精致动画，物理定位通过 left-[-42px] 与 transform 解耦 -->
              <transition name="fade-scale">
                <div
                  v-if="isDraggingProgress && !isProgressHidden"
                  class="absolute bottom-4 left-[-42px] w-[84px] px-2 py-0.5 rounded-md bg-zinc-900/95 text-white text-[10px] font-semibold font-mono tracking-wider whitespace-nowrap shadow-lg border border-white/10 backdrop-blur-sm pointer-events-none select-none flex items-center justify-center text-center"
                >
                  {{ currentTimeStr }}/{{ totalTimeStr }}
                  <!-- 气泡下方的微型三角指针 -->
                  <div class="absolute top-full left-1/2 -translate-x-1/2 -mt-[1px] border-x-4 border-t-4 border-x-transparent border-t-zinc-900/95"></div>
                </div>
              </transition>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="flex items-center w-1/3 min-w-[150px]" @contextmenu="handleContextMenu">
      <div 
        ref="footerCoverRef"
        data-footer-cover
        @click="handleOpenDetail"
        class="group relative w-12 h-12 rounded-lg flex-shrink-0 cursor-pointer active:scale-95 z-10"
      >
      </div>

      <div
        class="ml-3 flex-1 relative h-10 transition-transform duration-500 flex items-center gap-1"
        :class="showPlayerDetail ? '-translate-x-[60px]' : 'translate-x-[0px]'"
      >
        <div class="overflow-hidden w-28 relative h-full shrink-0">
        <!-- State A: Default View (Title & Artist) -->
        <div
          class="absolute inset-0 flex flex-col justify-center transition-all duration-500"
          :class="showPlayerDetail ? 'opacity-0 translate-y-4 pointer-events-none' : 'opacity-100 translate-y-0 text-gray-800 dark:text-white'"
        >
          <div class="overflow-hidden min-w-0" ref="songTitleWrapperRef">
            <div
              class="inline-block whitespace-nowrap"
              :class="{ 'animate-marquee': shouldMarquee }"
              :style="shouldMarquee ? {
                '--marquee-duration': marqueeDuration + 's',
                animationPlayState: isMarqueePaused ? 'paused' : 'running'
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

        <!-- State B: Player Detail View (Progress) -->
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

        <!-- 左侧容器可配置控件（按 leftItems 顺序渲染，最多 2 个） -->
        <FooterControlItem v-for="key in leftItems" :key="key" :item-key="key" />
      </div>
    </div>

    <div
      class="flex items-center justify-center flex-1 gap-6 transition-opacity duration-700"
      :class="{ 'opacity-0 pointer-events-none': isIdle }"
    >
      <!-- 中间左侧可配置控件（紧邻"上一首"，最多 1 个） -->
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

      <!-- 中间右侧可配置控件（紧邻"下一首"，最多 1 个） -->
      <FooterControlItem v-if="middleRightItem" :item-key="middleRightItem" />
    </div>

    <div 
      class="flex items-center justify-end w-1/3 min-w-[150px] gap-2 pr-2 transition-opacity duration-700"
      :class="{ 'opacity-0 pointer-events-none': isIdle }"
    > 
      <!-- 右侧容器可配置控件（按 rightItems 顺序渲染，最多 5 个） -->
      <FooterControlItem v-for="key in rightItems" :key="key" :item-key="key" />

      <!-- 右侧工具收纳：点击 ^ 向上展开（隐藏进度条/可视化/歌词样式/固定） -->
      <div ref="footerToolsRef" class="relative flex items-center justify-center h-full z-[70]">
        <transition name="footer-tools">
          <div
            v-if="showFooterTools"
            class="absolute bottom-full right-0 pb-3 flex flex-col items-center gap-2 z-[75]"
          >
            <!-- 折叠的控件（未分配到任何容器的可配置控件） -->
            <FooterControlItem v-for="key in collapsedItems" :key="'collapsed-' + key" :item-key="key" />

            <!-- 分隔线：折叠项与固定特殊项之间 -->
            <div v-if="collapsedItems.length > 0" class="w-6 h-px bg-white/10 my-1"></div>

            <!-- 固定特殊项（仅播放详情页可见） -->
            <button
              v-if="showPlayerDetail"
              @click="toggleProgressVisibility"
              :class="['transition-colors w-8 h-8 flex items-center justify-center rounded-full', isProgressHidden ? 'text-[#EC4141] bg-[#EC4141]/10' : 'text-white/60 hover:text-white hover:bg-white/10']"
              :title="isProgressHidden ? '显示进度条' : '隐藏进度条'"
            >
              <EyeOff v-if="isProgressHidden" class="h-4 w-4" :stroke-width="2.2" />
              <Eye v-else class="h-4 w-4" :stroke-width="2.2" />
            </button>

            <button
              v-if="showPlayerDetail"
              @click="toggleVisualizer"
              :class="['transition-colors w-8 h-8 flex items-center justify-center rounded-full', isVisualizerEnabled ? 'text-[#EC4141] bg-[#EC4141]/10' : 'text-white/60 hover:text-white hover:bg-white/10']"
              :title="isVisualizerEnabled ? '关闭可视化' : '开启可视化'"
            >
              <AudioLines class="h-4 w-4" :stroke-width="2.2" />
            </button>

            <button
              v-if="showPlayerDetail"
              @mousedown.stop
              @click.stop="toggleLyricsPlayerSettings"
              :class="['text-[14px] font-bold transition-colors w-8 h-8 flex items-center justify-center rounded-full', showLyricsPlayerSettingsPanel ? 'text-[#EC4141] bg-[#EC4141]/10' : 'text-white/80 hover:text-white hover:bg-white/10']"
              title="歌词样式"
            >
              A
            </button>

            <button @click="togglePin"
              class="transition-colors w-8 h-8 flex items-center justify-center rounded-full"
              :class="showPlayerDetail ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10'"
              :title="isPinned ? '取消固定 (当前已常驻)' : '固定状态栏 (当前离开后消失)'"
            >
              <svg v-if="isPinned" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 2 20 20"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-.82"/><path d="M12 17v5"/><path d="M15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0-1.16.37"/></svg>
            </button>
          </div>
        </transition>

        <!-- 触发按钮：^，展开后翻转为开口向上 -->
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
        <FooterContextMenu 

          :visible="showContextMenu" 

          :x="contextMenuX" 

          :y="contextMenuY" 

          :song="currentSong"

          @close="showContextMenu = false"

        />

        <!-- 已下载确认：询问是否重新下载 -->
        <ModernModal
          v-model:visible="showRedownloadConfirm"
          title="歌曲已下载"
          :content="redownloadContent"
          cancel-text="取消"
          confirm-text="重新下载"
          type="info"
          @confirm="handleConfirmRedownload"
        />

      </footer>

    </template>

<style scoped>
/* 拖拽气泡进入与离开的动画过渡 */
.fade-scale-enter-active,
.fade-scale-leave-active {
  transition: opacity 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.fade-scale-enter-from,
.fade-scale-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.85);
}

/* 底栏工具收纳：向上展开/折叠，带模糊过渡 */
.footer-tools-enter-active,
.footer-tools-leave-active {
  transition: opacity 0.28s cubic-bezier(0.34, 1.56, 0.64, 1),
    transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1),
    filter 0.28s ease;
}

.footer-tools-enter-from,
.footer-tools-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.9);
  filter: blur(6px);
}

.footer-tools-enter-to,
.footer-tools-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
  filter: blur(0);
}

/* 歌名滚动（marquee）：文字超出容器时无缝滚动，时长由 --marquee-duration 动态控制 */
@keyframes footer-marquee {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

.animate-marquee {
  animation: footer-marquee var(--marquee-duration, 12s) linear infinite;
}
</style>
