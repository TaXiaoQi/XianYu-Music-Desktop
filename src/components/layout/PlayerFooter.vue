<script setup lang="ts">
import { ChevronUp } from 'lucide-vue-next';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useLibraryCollections } from '../../features/collections/useLibraryCollections';
import { useLyrics } from '../../composables/lyrics';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { isDownloadableOnlineSong } from '../../services/domain/downloadService';
import {
  ensureSharedQualityProbe,
  ensureProbeRequestedUrls,
  onSharedProbeUpdate,
  sharedProbeAvailable,
  getSongKey,
} from '../../services/domain/qualitySharedProbe';
import { probeSizesForKeys } from '../../services/domain/qualitySizeMeta';
import { getOnlineAvailableQualities } from '../../features/playback/onlinePlaybackResolver';
import { checkDownloadExists, type DownloadRecord } from '../../services/domain/downloadHistory';
import { downloadApi } from '../../services/tauri/downloadApi';
import { formatFileSize } from '../../utils/format';
import { useSettings } from '../../features/settings/useSettings';

import { usePluginHostStore } from '../../features/pluginHost/store';
import { useDownloadStore } from '../../features/download/store';
import { downloadToLocal } from '../../composables/useDownloadToLocal';
import { useDownloadDialog } from '../../composables/useDownloadDialog';
import { useRenderingPower } from '../../composables/renderingPower';
import { useBilibiliVideoBackground, supportsMusicVideo } from '../../composables/useBilibiliVideoBackground';
import { useToast } from '../../composables/toast';
import { usePlaybackStore } from '../../features/playback/store';
import { useSettingsStore } from '../../features/settings/store';
import { createShareUrl, getCachedShareUrl, preloadShareUrl, reportShareAction } from '../../services/domain/shareService';
import { computed, defineAsyncComponent, ref, onMounted, onUnmounted, watch, nextTick, provide } from 'vue';
import FooterControlItem from './FooterControlItem.vue';
import type { DownloadQuality, QualityKey, RemoteDownloadProgress, Song } from '../../types';
import { QUALITY_META, MV_QUALITY_KEYS, MV_QUALITY_META } from '../../types';
import {
  FOOTER_PROGRESS_HIDDEN_KEY,
  getProgressVisualState,
  readStoredProgressHidden
} from './playerFooterProgress';

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
const downloadStore = useDownloadStore();

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

// --- 下载功能 ---
const isOnlineSong = computed(() => isDownloadableOnlineSong(currentSong.value));

const downloadedRecord = ref<DownloadRecord | null>(null);
const showRedownloadConfirm = ref(false);
const showMvDownloadQualityModal = ref(false);
const isDownloading = computed(() => {
  if (!downloadStore.isDownloading) return false;
  const song = currentSong.value;
  if (!song) return false;
  const songPath = song.cue_source_path || song.path;
  return downloadStore.downloadingSongPath === songPath;
});
let downloadCheckId = 0;

const footerAvailableQualityKeys = ref<QualityKey[] | null>(null);
const footerQualityUrls = ref<Partial<Record<QualityKey, string>>>({});
const footerQualitySizes = ref<Partial<Record<QualityKey, number>>>({});
const isFooterQualityInfoProbing = ref(false);
const footerQualityInfoSongPath = ref('');
let footerSharedProbeOff: (() => void) | null = null;
const footerQualitySizesProbed = new Set<QualityKey>();

const releaseFooterSharedProbe = () => {
  footerSharedProbeOff?.();
  footerSharedProbeOff = null;
};

const abortFooterQualityInfoProbe = () => {
  releaseFooterSharedProbe();
  isFooterQualityInfoProbing.value = false;
};

const refreshDownloadedState = async () => {
  const requestId = ++downloadCheckId;
  const song = currentSong.value;
  const songPath = song?.cue_source_path || song?.path || '';

  if (!isOnlineSong.value || !songPath) {
    downloadedRecord.value = null;
    return;
  }

  const record = await checkDownloadExists(songPath);
  if (requestId !== downloadCheckId) return;
  downloadedRecord.value = record;
};

watch(
  () => currentSong.value?.cue_source_path || currentSong.value?.path,
  () => {
    abortFooterQualityInfoProbe();
    footerQualityInfoSongPath.value = '';
    footerAvailableQualityKeys.value = null;
    footerQualityUrls.value = {};
    footerQualitySizes.value = {};
    footerQualitySizesProbed.clear();
    void refreshDownloadedState();
  },
  { immediate: true },
);

watch(
  () => downloadStore.isDownloading,
  (downloading, wasDownloading) => {
    if (wasDownloading && !downloading) {
      void refreshDownloadedState();
    }
  },
);

const showDownloadQualityMenu = ref(false);
const downloadQualityButtonRef = ref<HTMLElement | null>(null);
const downloadQualityMenuRef = ref<HTMLElement | null>(null);

const DOWNLOAD_QUALITY_OPTIONS = computed(() => {
  if (footerAvailableQualityKeys.value !== null) {
    return ALL_QUALITY_OPTIONS.filter(opt => footerAvailableQualityKeys.value!.includes(opt.value));
  }
  return [];
});

const resolveEffectiveDownloadQuality = (
  preferred: DownloadQuality,
  available: QualityKey[] | null,
): DownloadQuality => {
  if (!available || available.length === 0 || available.includes(preferred)) {
    return preferred;
  }

  const fallbackBehavior = settings.value.download.qualityFallbackBehavior ?? 'lower';
  const preferredRank = QUALITY_META[preferred]?.rank ?? QUALITY_META['320k'].rank;
  const sorted = [...available].sort((a, b) => QUALITY_META[a].rank - QUALITY_META[b].rank);

  if (fallbackBehavior === 'higher') {
    return sorted.find(q => QUALITY_META[q].rank > preferredRank)
      ?? sorted[sorted.length - 1];
  }
  return [...sorted].reverse().find(q => QUALITY_META[q].rank < preferredRank)
    ?? sorted[0];
};

const selectedDownloadQuality = computed<DownloadQuality>(
  () => resolveEffectiveDownloadQuality(
    (settings.value.download.quality as DownloadQuality) ?? '320k',
    footerAvailableQualityKeys.value,
  ),
);

const activeDownloadQualityKey = computed<DownloadQuality>(() => {
  const playingQuality = currentPlayingQuality.value;
  if (
    playingQuality
    && (
      footerAvailableQualityKeys.value === null
      || footerAvailableQualityKeys.value.includes(playingQuality)
    )
  ) {
    return playingQuality;
  }
  return selectedDownloadQuality.value;
});

const { openDownloadDialog } = useDownloadDialog();

const openDownloadByBehavior = () => {
  if (!currentSong.value) return;
  showQualityMenu.value = false;
  if ((settings.value.download.behavior ?? 'default') === 'ask') {
    showDownloadQualityMenu.value = false;
    openDownloadDialog(currentSong.value, activeDownloadQualityKey.value);
    return;
  }
  showDownloadQualityMenu.value = !showDownloadQualityMenu.value;
  if (showDownloadQualityMenu.value) {
    void ensureFooterQualityInfo();
  }
};

const handleDownloadClick = () => {
  if (mvActive.value) {
    if (isMvVideoDownloading.value) return;
    showDownloadQualityMenu.value = false;
    showQualityMenu.value = false;
    showMvDownloadQualityModal.value = true;
    return;
  }
  if (!isOnlineSong.value || isDownloading.value) return;
  if (!currentSong.value) return;
  if (downloadedRecord.value) {
    showRedownloadConfirm.value = true;
    return;
  }
  openDownloadByBehavior();
};

const mvDownloadQualityOptions = computed<Array<{ key: string; label: string }>>(() => {
  const available = videoBackground.availableQualities.value;
  if (available.length) {
    return available.map(quality => ({ key: quality.key, label: quality.label || quality.key }));
  }
  return MV_QUALITY_KEYS.map(key => ({ key, label: MV_QUALITY_META[key].label }));
});

const mvDownloadDefaultQuality = computed(() => {
  const configured = settings.value.download.mvDefaultQuality;
  const keys = mvDownloadQualityOptions.value.map(option => option.key);
  if (configured && keys.includes(configured)) return configured;
  return keys.includes(videoBackground.activeQuality.value)
    ? videoBackground.activeQuality.value
    : keys[keys.length - 1] ?? '720P';
});

const downloadMvWithQuality = async (qualityKey: string) => {
  showMvDownloadQualityModal.value = false;
  const song = currentSong.value;
  if (!song) return;
  const downloadDir = settings.value.download.downloadPath;
  if (!downloadDir) {
    showToast('请先在设置 - 下载中选择下载目录', 'error');
    return;
  }

  const sanitize = (text: string) => text.replace(/[\\/:*?"<>|]/g, ' ').trim();
  const title = sanitize(song.title || song.name || 'video');
  const artist = sanitize(song.artist || '');
  const fileName = `${title}${artist ? ` - ${artist}` : ''} (${qualityKey}).mp4`;

  isMvVideoDownloading.value = true;
  try {
    const source = await videoBackground.resolveDownloadSource(song, qualityKey);
    const destPath = await downloadApi.resolveDownloadPath(fileName, false);
    const idx = Math.max(destPath.lastIndexOf('\\'), destPath.lastIndexOf('/'));
    const destFileName = idx === -1 ? fileName : destPath.slice(idx + 1);
    const candidates = [source.url, ...(source.backupUrls || [])];
    let savedPath = '';
    let lastError: unknown = null;
    for (const candidate of candidates) {
      try {
        savedPath = await downloadApi.downloadOnlineSong(candidate, destFileName, null, source.headers || null);
        if (savedPath) break;
      } catch (downloadError) {
        lastError = downloadError;
      }
    }
    if (!savedPath) throw (lastError instanceof Error ? lastError : new Error('下载失败'));
    showToast(`MV 已下载：${fileName}`, 'success');
  } catch (e: any) {
    console.warn('[MV] 视频下载失败:', e?.message || e);
    showToast(e?.message || 'MV 下载失败', 'error');
  } finally {
    isMvVideoDownloading.value = false;
  }
};

const handleConfirmRedownload = () => {
  if (!currentSong.value) return;
  openDownloadByBehavior();
};

const startDownload = async (qualityKey: DownloadQuality) => {
  showDownloadQualityMenu.value = false;
  if (!currentSong.value) return;
  await downloadToLocal(currentSong.value, { quality: qualityKey });
};

const downloadButtonTitle = computed(() => {
  if (mvActive.value) return isMvVideoDownloading.value ? 'MV 视频下载中…' : '下载 MV 视频';
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
const videoBackground = useBilibiliVideoBackground();
const mvActive = videoBackground.requested;
const mvLoading = videoBackground.loading;
const mvVideoActive = videoBackground.active;
const mvSupport = supportsMusicVideo;
const { showToast } = useToast();
const isMvVideoDownloading = ref(false);

const playbackStore = usePlaybackStore();
const isShareLoading = ref(false);
const settingsStore = useSettingsStore();

const showDlnaCastDialog = ref(false);
const openDlnaCastDialog = () => {
  showDlnaCastDialog.value = true;
};

const showShareDialog = ref(false);
const openShareDialog = () => {
  showFooterTools.value = false;
  showShareDialog.value = true;
};
const handleShareCopy = () => {
  showShareDialog.value = false;
  const song = currentSong.value;
  if (song) void handleShareSong(song);
};
const handleShareCast = () => {
  showShareDialog.value = false;
  showDlnaCastDialog.value = true;
};

function shareBodyExtra() {
  return {
    expireMinutes: settingsStore.settings.shareLinkValidityMinutes,
    source: '',
  };
}

function resolveShareCover(): string {
  return playbackStore.currentCoverFull || '';
}

async function copyShareLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    showToast('分享链接已复制', 'success');
  } catch {
    showToast('复制失败，请手动选中链接复制', 'error');
  }
}

async function handleShareSong(song: Song) {
  if (!song) {
    showToast('当前没有可分享的歌曲', 'error');
    return;
  }
  showFooterTools.value = false;
  const cached = getCachedShareUrl(song);
  if (cached) {
    reportShareAction();
    await copyShareLink(cached);
    return;
  }
  if (isShareLoading.value) return;
  isShareLoading.value = true;
  try {
    const url = await createShareUrl(song, resolveShareCover(), shareBodyExtra());
    if (url) {
      reportShareAction();
      await copyShareLink(url);
    } else {
      showToast('生成分享链接失败', 'error');
    }
  } catch (e: any) {
    showToast(e?.message || '生成分享链接失败', 'error');
  } finally {
    isShareLoading.value = false;
  }
}

let sharePreloadTimer: ReturnType<typeof setTimeout> | null = null;
watch(currentSong, song => {
  if (sharePreloadTimer) clearTimeout(sharePreloadTimer);
  sharePreloadTimer = null;
  if (!song) return;
  sharePreloadTimer = setTimeout(() => preloadShareUrl(song, resolveShareCover(), shareBodyExtra()), 600);
});

const toggleMv = async () => {
  if (!currentSong.value) return;
  showFooterTools.value = false;
  try {
    await videoBackground.toggle(currentSong.value);
  } catch (e: any) {
    console.warn('[MV] 切换失败:', e?.message || e);
    showToast(e?.message || 'MV 打开失败', 'error');
  }
};

watch(
  () => currentSong.value?.path,
  (path) => {
    if (!path) {
      void videoBackground.stop();
      return;
    }
    if (!videoBackground.requested.value) return;
    const song = currentSong.value!;
    if (!supportsMusicVideo(song)) {
      void videoBackground.stop();
      return;
    }
    videoBackground.start(song).catch(() => {});
  },
);

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


const ALL_QUALITY_OPTIONS: Array<{ label: string; value: QualityKey; description: string }> =
  (Object.keys(QUALITY_META) as QualityKey[])
    .sort((a, b) => QUALITY_META[a].rank - QUALITY_META[b].rank)
    .map(k => ({
      label: QUALITY_META[k].label,
      value: k,
      description: QUALITY_META[k].description,
    }));

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

const compactFileSize = (bytes: number) =>
  formatFileSize(bytes).replace(/\s*MB$/, 'M').replace(/\s*GB$/, 'G').replace(/\s*KB$/, 'K');

const getAudioExtLabel = (key: QualityKey, url?: string) => {
  if (url) {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      const match = pathname.match(/\.([a-z0-9]+)$/);
      if (match?.[1]) return match[1].toUpperCase();
    } catch {
      const match = url.toLowerCase().match(/\.([a-z0-9]+)(?:[?#]|$)/);
      if (match?.[1]) return match[1].toUpperCase();
    }
  }
  return QUALITY_META[key]?.isLossless ? 'FLAC' : 'MP3';
};

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
  if (isFooterQualityInfoProbing.value) return `${ext} · 探测中`;
  return `${ext} · 未知体积`;
};

const probeFooterQualitySizes = async (
  song: Song,
  keys: QualityKey[],
  urlFor: (q: QualityKey) => string | undefined,
) => {
  const targets = keys.filter(k => !footerQualitySizesProbed.has(k));
  targets.forEach(k => footerQualitySizesProbed.add(k));
  await probeSizesForKeys(song, targets, urlFor, (q, bytes) => {
    footerQualitySizes.value = { ...footerQualitySizes.value, [q]: bytes };
  });
};

const ensureFooterQualityInfo = async () => {
  const song = currentSong.value;
  const songPath = song?.cue_source_path || song?.path || '';
  if (!song || !isDownloadableOnlineSong(song) || !songPath) return;
  const songKey = getSongKey(song);
  if (
    footerQualityInfoSongPath.value === songKey
    && (isFooterQualityInfoProbing.value || footerAvailableQualityKeys.value !== null)
  ) {
    return;
  }

  releaseFooterSharedProbe();
  footerQualityInfoSongPath.value = songKey;
  footerAvailableQualityKeys.value = null;
  footerQualityUrls.value = {};
  footerQualitySizes.value = {};
  footerQualitySizesProbed.clear();
  isFooterQualityInfoProbing.value = true;

  const isCurrent = () => (currentSong.value ? getSongKey(currentSong.value) === songKey : false);

  let declaredQualities: QualityKey[] | null = null;
  try {
    declaredQualities = await getOnlineAvailableQualities(songPath, song);
  } catch {
    declaredQualities = null;
  }
  if (!isCurrent()) return;

  const probe = await ensureSharedQualityProbe(song, declaredQualities);
  if (!probe || !isCurrent()) {
    if (isCurrent()) isFooterQualityInfoProbing.value = false;
    return;
  }

  const apply = () => {
    const shown = sharedProbeAvailable(probe);
    footerAvailableQualityKeys.value = shown;
    footerQualityUrls.value = { ...probe.resolvedUrls };
    void ensureProbeRequestedUrls(probe, song, shown);
    const urlFor = (q: QualityKey) => probe.requestedUrls?.[q] ?? probe.resolvedUrls[q];
    void probeFooterQualitySizes(song, shown, urlFor);
    if (probe.done) {
      isFooterQualityInfoProbing.value = false;
      releaseFooterSharedProbe();
    }
  };

  footerSharedProbeOff = onSharedProbeUpdate(probe, apply);
  if (isCurrent()) apply();
};

watch(
  () => currentSong.value?.cue_source_path || currentSong.value?.path,
  () => {
    void ensureFooterQualityInfo();
  },
  { immediate: true },
);

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

const selectedQualityKey = computed<QualityKey>(
  () => sessionQualityOverride.value
    ?? (settings.value.audio.onlineDefaultQuality as QualityKey) ?? '320k',
);
const currentQualityLabel = computed(
  () => QUALITY_ABBR[currentPlayingQuality.value ?? selectedQualityKey.value] ?? 'HQ',
);

const localFormatLabel = computed(() => {
  const song = currentSong.value;
  if (!song) return '';
  const raw = song.format || song.codec || song.container;
  if (raw) return raw.toUpperCase();
  const ext = song.path.split('.').pop();
  return ext ? ext.toUpperCase() : '';
});

const localQualityLabel = computed(() => {
  const song = currentSong.value;
  if (!song) return 'HQ';
  if (song.bit_depth && song.bit_depth >= 24) return QUALITY_ABBR.flac24bit;
  const fmt = (song.format || song.codec || song.container || '').toLowerCase();
  const losslessFormats = ['flac', 'ape', 'wav', 'alac', 'aiff', 'dsd', 'dff', 'dsf', 'wv', 'wavpack'];
  if (losslessFormats.some(f => fmt.includes(f))) return QUALITY_ABBR.flac;
  const bitrateKbps = song.bitrate
    ? (song.bitrate > 1000 ? Math.round(song.bitrate / 1000) : song.bitrate)
    : 0;
  if (bitrateKbps >= 320) return QUALITY_ABBR['320k'];
  if (bitrateKbps >= 192) return QUALITY_ABBR['192k'];
  if (bitrateKbps >= 128) return QUALITY_ABBR['128k'];
  if (bitrateKbps > 0) return QUALITY_ABBR.mgg;
  return localFormatLabel.value || 'HQ';
});

const qualityButtonLabel = computed(() => {
  if (mvActive.value) return videoBackground.activeQuality.value || '画质';
  return isQualitySelectableSong.value ? currentQualityLabel.value : localQualityLabel.value;
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
const isDraggingProgress = ref(false);
const progressBarRef = ref<HTMLElement | null>(null);
const dragTime = ref(0);

const displayProgress = computed(() => {
  if (!currentSong.value || currentSong.value.duration <= 0) return 0;
  const time = isDraggingProgress.value ? dragTime.value : currentTime.value;
  return Math.max(0, Math.min(100, (time / currentSong.value.duration) * 100));
});

const progressFillClass = computed(() => 'bg-zinc-300/30');

const progressTrackClass = computed(() => 'bg-transparent');

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

const currentTimeStr = computed(() => {
  return formatDuration(isDraggingProgress.value ? dragTime.value : currentTime.value);
});
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
let marqueeResizeObserver: ResizeObserver | null = null;
let marqueeCheckFrame: number | null = null;

const songTitleText = computed(() => {
  if (!currentSong.value) return '听我想听的音乐';
  return currentSong.value.title || currentSong.value.name.replace(/\.[^/.]+$/, "");
});

const checkMarquee = () => {
  nextTick(() => {
    if (marqueeCheckFrame !== null) {
      cancelAnimationFrame(marqueeCheckFrame);
    }

    marqueeCheckFrame = requestAnimationFrame(() => {
      marqueeCheckFrame = null;
      const wrapper = songTitleWrapperRef.value;
      const span = songTitleTextRef.value;
      if (!wrapper || !span) {
        shouldMarquee.value = false;
        return;
      }

      const wrapperWidth = wrapper.getBoundingClientRect().width;
      const textWidth = span.getBoundingClientRect().width;
      const overflow = textWidth - wrapperWidth;
      if (overflow > 0) {
        shouldMarquee.value = true;
        marqueeDuration.value = Math.max(8, Math.min(30, 6 + overflow / 25));
      } else {
        shouldMarquee.value = false;
        isMarqueePaused.value = false;
      }
    });
  });
};

const setupMarqueeObserver = () => {
  marqueeResizeObserver?.disconnect();
  if (typeof ResizeObserver === 'undefined') {
    checkMarquee();
    return;
  }

  marqueeResizeObserver = new ResizeObserver(() => checkMarquee());
  if (songTitleWrapperRef.value) {
    marqueeResizeObserver.observe(songTitleWrapperRef.value);
  }
  if (songTitleTextRef.value) {
    marqueeResizeObserver.observe(songTitleTextRef.value);
  }
  checkMarquee();
};

watch(songTitleText, () => checkMarquee());
watch(showPlayerDetail, () => checkMarquee());
watch(footerLayout, () => checkMarquee(), { deep: true });
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

const onGlobalPointerMove = (e: PointerEvent) => {
  if (isDraggingVolume.value) { e.preventDefault(); updateVolume(e.clientY); }
  if (isDraggingProgress.value) { e.preventDefault(); updateProgressFromEvent(e); }
  if (showPlayerDetail.value && mvVideoActive.value && !isPointerOverFooter.value) {
    if (isIdle.value) clearIdle();
    startIdleTimer();
  }
};

const onGlobalPointerEnd = (commitProgress = true) => {
  isDraggingVolume.value = false;
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
  handleFooterMouseEnter();
};

const handleVolumeLeave = () => {
  volumeTimer = setTimeout(() => {
    if (!isDraggingVolume.value) {
      showVolumeSlider.value = false;
      startIdleTimer();
    }
  }, 300);
};

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
const isPinnedFooter = ref(localStorage.getItem('footer_pinned') !== 'false');
const isPinnedDetail = ref(localStorage.getItem('footer_pinned_detail') === 'true');
const isPinned = computed(() => showPlayerDetail.value ? isPinnedDetail.value : isPinnedFooter.value);

const isIdleFooter = ref(false);
const isIdleDetail = ref(false);
const isIdle = computed(() => showPlayerDetail.value ? isIdleDetail.value : isIdleFooter.value);
const isMvCollapsed = computed(() =>
  Boolean(showPlayerDetail.value && mvVideoActive.value && isIdle.value),
);
const isMarqueeAnimationPaused = computed(() =>
  isMarqueePaused.value || isIdle.value || isMainWindowLowPower.value
);
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
  if (showContextMenu.value || isDraggingProgress.value || isDraggingVolume.value || showVolumeSlider.value || isPinned.value) return;

  idleTimer = setTimeout(() => {
    if (showPlayerDetail.value) {
      isIdleDetail.value = true;
    } else {
      isIdleFooter.value = true;
    }
  }, 2000);
};

const isPointerOverFooter = ref(false);

const handleFooterMouseEnter = () => {
  isPointerOverFooter.value = true;
  clearIdle();
  if (idleTimer) clearTimeout(idleTimer);
};

const handleFooterMouseMove = () => {
  if (isIdle.value) clearIdle();
  if (idleTimer) clearTimeout(idleTimer);
};

const handleFooterMouseLeave = () => {
  isPointerOverFooter.value = false;
  startIdleTimer();
};

watch(showPlayerDetail, () => {
  clearIdle();
  if (idleTimer) clearTimeout(idleTimer);
  startIdleTimer();
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
  marqueeResizeObserver?.disconnect();
  marqueeResizeObserver = null;
  if (marqueeCheckFrame !== null) {
    cancelAnimationFrame(marqueeCheckFrame);
    marqueeCheckFrame = null;
  }
  if (idleTimer) clearTimeout(idleTimer);
  abortFooterQualityInfoProbe();
  unlistenRemoteDownload?.();
  unlistenRemoteDownload = null;
});
</script>

<template>
  <footer 
    class="player-footer h-20 flex items-center justify-between px-4 z-[60] relative select-none bg-transparent"
    @mouseenter="handleFooterMouseEnter"
    @mousemove="handleFooterMouseMove"
    @mouseleave="handleFooterMouseLeave"
  >
    
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
      :class="isMvCollapsed ? 'translate-y-[78px]' : 'translate-y-0'"
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
