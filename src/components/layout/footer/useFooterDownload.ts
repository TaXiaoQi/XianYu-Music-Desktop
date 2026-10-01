import { computed, ref, watch, type Ref } from 'vue';

import { useBilibiliVideoBackground } from '../../../composables/useBilibiliVideoBackground';
import { useDownloadDialog } from '../../../composables/useDownloadDialog';
import { downloadToLocal } from '../../../composables/useDownloadToLocal';
import { useDownloadStore } from '../../../features/download/store';
import { isDownloadableOnlineSong } from '../../../services/domain/downloadService';
import { checkDownloadExists, type DownloadRecord } from '../../../services/domain/downloadHistory';
import { downloadApi } from '../../../services/tauri/downloadApi';
import { MV_QUALITY_KEYS, MV_QUALITY_META } from '../../../types';
import type { DownloadQuality, QualityKey, Song } from '../../../types';
import { ALL_QUALITY_OPTIONS, resolveEffectiveDownloadQuality } from './footerQuality';

/** 底栏只读取到这一层设置，避免把整个 settings 结构耦合进模块。 */
interface DownloadSettingsSlice {
  quality?: string | null;
  qualityFallbackBehavior?: 'lower' | 'higher' | null;
  behavior?: string | null;
  mvDefaultQuality?: string | null;
  downloadPath?: string | null;
}

interface FooterDownloadDeps {
  currentSong: Ref<Song | null>;
  getDownloadSettings: () => DownloadSettingsSlice;
  getCurrentPlayingQuality: () => QualityKey | null | undefined;
  footerAvailableQualityKeys: Ref<QualityKey[] | null>;
  ensureFooterQualityInfo: () => Promise<void>;
  resetQualityInfo: () => void;
  /** 下载菜单展开时收起音质菜单（音质菜单状态声明在本区块之后）。 */
  closeQualityMenu: () => void;
  /** MV 是否开启（MV 接线声明在本区块之后）。 */
  getMvActive: () => boolean;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

/**
 * 底栏下载：可用性判定、已下载记录、音质菜单、MV 视频下载与按钮文案。
 */
export const useFooterDownload = ({
  currentSong,
  getDownloadSettings,
  getCurrentPlayingQuality,
  footerAvailableQualityKeys,
  ensureFooterQualityInfo,
  resetQualityInfo,
  closeQualityMenu,
  getMvActive,
  showToast,
}: FooterDownloadDeps) => {
  // MV 背景是模块级单例，这里取到的是与 useFooterMv 相同的状态。
  const videoBackground = useBilibiliVideoBackground();
  const downloadStore = useDownloadStore();
  const { openDownloadDialog } = useDownloadDialog();

  const isOnlineSong = computed(() => isDownloadableOnlineSong(currentSong.value));

  const downloadedRecord = ref<DownloadRecord | null>(null);
  const showRedownloadConfirm = ref(false);
  const showMvDownloadQualityModal = ref(false);
  const isMvVideoDownloading = ref(false);
  const isDownloading = computed(() => {
    if (!downloadStore.isDownloading) return false;
    const song = currentSong.value;
    if (!song) return false;
    const songPath = song.cue_source_path || song.path;
    return downloadStore.downloadingSongPath === songPath;
  });
  let downloadCheckId = 0;

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
      resetQualityInfo();
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

  const selectedDownloadQuality = computed<DownloadQuality>(
    () => resolveEffectiveDownloadQuality(
      (getDownloadSettings().quality as DownloadQuality) ?? '320k',
      footerAvailableQualityKeys.value,
      getDownloadSettings().qualityFallbackBehavior ?? undefined,
    ),
  );

  const activeDownloadQualityKey = computed<DownloadQuality>(() => {
    const playingQuality = getCurrentPlayingQuality();
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

  const openDownloadByBehavior = () => {
    if (!currentSong.value) return;
    closeQualityMenu();
    if ((getDownloadSettings().behavior ?? 'default') === 'ask') {
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
    if (getMvActive()) {
      if (isMvVideoDownloading.value) return;
      showDownloadQualityMenu.value = false;
      closeQualityMenu();
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
    const configured = getDownloadSettings().mvDefaultQuality;
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
    const downloadDir = getDownloadSettings().downloadPath;
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
    if (getMvActive()) return isMvVideoDownloading.value ? 'MV 视频下载中…' : '下载 MV 视频';
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

  return {
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
    openDownloadByBehavior,
    handleDownloadClick,
    mvDownloadQualityOptions,
    mvDownloadDefaultQuality,
    downloadMvWithQuality,
    handleConfirmRedownload,
    startDownload,
    downloadButtonTitle,
    redownloadContent,
  };
};
