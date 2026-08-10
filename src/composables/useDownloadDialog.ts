import { ref, watch, onUnmounted } from 'vue';
import type { DownloadQuality, Song } from '../types';
import { useSettings } from '../features/settings/useSettings';

const isDownloadDialogVisible = ref(false);
const currentDownloadSong = ref<Song | null>(null);
const currentDownloadInitialQuality = ref<DownloadQuality | null>(null);

// 下载内容勾选状态（localStorage 持久化，跨弹窗打开记忆上次选择）
const SK_AUDIO = 'dl_dialog_audio';
const SK_LYRICS = 'dl_dialog_lyrics';
const SK_COVER = 'dl_dialog_cover';
const SK_INIT = 'dl_dialog_initialized';

const readBool = (key: string, fallback: boolean): boolean => {
  const v = localStorage.getItem(key);
  return v === null ? fallback : v === 'true';
};

const downloadAudio = ref(readBool(SK_AUDIO, true));
const downloadLyrics = ref(readBool(SK_LYRICS, true));
const downloadCover = ref(readBool(SK_COVER, true));

let selectionInitialized = localStorage.getItem(SK_INIT) === 'true';
let watchRegistered = false;
let closeDialogTimer: ReturnType<typeof setTimeout> | null = null;

function initSelectionIfNeeded() {
  if (selectionInitialized) return;
  const { settings } = useSettings();
  downloadAudio.value = true;
  downloadLyrics.value = settings.value.download.downloadLyrics;
  downloadCover.value = settings.value.download.embedCover;
  selectionInitialized = true;
  localStorage.setItem(SK_INIT, 'true');
}

function registerPersistenceWatchers() {
  if (watchRegistered) return;
  watch(downloadAudio, (v) => localStorage.setItem(SK_AUDIO, String(v)));
  watch(downloadLyrics, (v) => localStorage.setItem(SK_LYRICS, String(v)));
  watch(downloadCover, (v) => localStorage.setItem(SK_COVER, String(v)));
  watchRegistered = true;
}

export function useDownloadDialog() {
  registerPersistenceWatchers();

  onUnmounted(() => {
    if (closeDialogTimer) {
      clearTimeout(closeDialogTimer);
      closeDialogTimer = null;
    }
  });

  const openDownloadDialog = (song: Song, initialQuality?: DownloadQuality) => {
    currentDownloadSong.value = song;
    currentDownloadInitialQuality.value = initialQuality ?? null;
    initSelectionIfNeeded();
    isDownloadDialogVisible.value = true;
  };

  const closeDownloadDialog = () => {
    isDownloadDialogVisible.value = false;
    // 延迟清理对象以保持关闭动画过渡的平滑性
    if (closeDialogTimer) {
      clearTimeout(closeDialogTimer);
    }
    closeDialogTimer = setTimeout(() => {
      currentDownloadSong.value = null;
      currentDownloadInitialQuality.value = null;
      closeDialogTimer = null;
    }, 300);
  };

  return {
    isDownloadDialogVisible,
    currentDownloadSong,
    currentDownloadInitialQuality,
    openDownloadDialog,
    closeDownloadDialog,
    downloadAudio,
    downloadLyrics,
    downloadCover,
  };
}
