<script setup lang="ts">
// 歌曲信息窗口：详情/歌词双栏，支持元数据编辑、歌词编辑与外置 MusicTag 修正
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Tag, SquarePen } from 'lucide-vue-next';
import type { SongDetail, Song } from '../../types';
import type { SongInfoDialogAction } from '../../composables/useSongInfoDialog';
import { useCoverCache } from '../../composables/useCoverCache';
import { usePlayer } from '../../features/playback';
import { useSongDetailCache } from '../../composables/useSongDetailCache';
import { useThemeSettings } from '../../composables/useThemeSettings';
import { useToast } from '../../composables/toast';
import { useLibraryStore } from '../../features/library/store';
import type { LyricsStorageSource } from '../../services/tauri/contracts';
import { appApi } from '../../services/tauri/appApi';
import { downloadApi } from '../../services/tauri/downloadApi';
import { lyricsApi } from '../../services/tauri/lyricsApi';
import { formatFileSize } from '../../utils/format';

const props = defineProps<{
  song: Song | null;
  visible: boolean;
  initialAction?: SongInfoDialogAction;
}>();

const emit = defineEmits<{ (e: 'close'): void }>();

const { clearCoverCaches, loadCover } = useCoverCache();
const { loadSongDetail: fetchSongDetail } = useSongDetailCache();
const { openInFinder: revealInFileManager } = usePlayer(); const { isDarkTheme } = useThemeSettings();
const { showToast } = useToast(); const libraryStore = useLibraryStore();

// 编辑表单的内存草稿结构
interface ModalInfoDraft {
  trackTitle: string;
  artistName: string;
  albumName: string;
  trackNo: string;
  discNo: string;
  releaseYear: string;
  newCoverPath: string | null;
  coverPreview: string;
}

const makeBlankDraft = (): ModalInfoDraft => ({
  trackTitle: '', artistName: '', albumName: '',
  trackNo: '', discNo: '', releaseYear: '',
  newCoverPath: null, coverPreview: '',
});

const coverImageSrc = ref('');
const savedSongSnapshot = ref<Song | null>(null);
const isDismissAnimating = ref(false);
const loadedDetail = ref<SongDetail | null>(null);
const isInfoEditing = ref(false);
const isInfoSaving = ref(false);
const infoEditError = ref('');
const infoDraft = ref<ModalInfoDraft>(makeBlankDraft());
const lyricsDraft = ref('');
const lyricsBaseline = ref('');
const lyricsOrigin = ref<LyricsStorageSource>('empty');
const lyricsOriginFile = ref<string | null>(null);
const isLoadingLyrics = ref(false);
const isSavingLyrics = ref(false);
const lyricsIssue = ref('');
const lyricsTextareaRef = ref<HTMLTextAreaElement | null>(null);
const isInfoStretched = ref(false);
const isLyricsStretched = ref(false);
const pendingInfoStretch = ref<boolean | null>(null);
const pendingLyricsStretch = ref<boolean | null>(null);
let latestFetchId = 0;
let infoStretchTimer: number | null = null;
let lyricsStretchTimer: number | null = null;

const stopInfoStretchTimer = () => {
  if (infoStretchTimer !== null) {
    window.clearTimeout(infoStretchTimer);
    infoStretchTimer = null;
  }
};

const stopLyricsStretchTimer = () => {
  if (lyricsStretchTimer !== null) {
    window.clearTimeout(lyricsStretchTimer);
    lyricsStretchTimer = null;
  }
};

// 先播放 200ms 退场动画再通知父级关闭
const requestDismiss = () => {
  if (isDismissAnimating.value) return;
  isDismissAnimating.value = true;
  window.setTimeout(() => {
    emit('close');
    isDismissAnimating.value = false;
  }, 200);
};

watch(
  [() => props.visible, () => props.song?.path ?? ''],
  async ([shown, path]) => {
    const fetchId = ++latestFetchId;

    if (!shown || !path) {
      // 弹窗收起：清空所有临时状态，封面延迟释放避免闪黑
      stopInfoStretchTimer();
      stopLyricsStretchTimer();
      loadedDetail.value = null;
      savedSongSnapshot.value = null;
      isInfoEditing.value = false;
      isInfoSaving.value = false;
      infoEditError.value = '';
      infoDraft.value = makeBlankDraft();
      lyricsDraft.value = '';
      lyricsBaseline.value = '';
      lyricsOrigin.value = 'empty';
      lyricsOriginFile.value = null;
      lyricsIssue.value = '';
      isLoadingLyrics.value = false;
      isSavingLyrics.value = false;
      isInfoStretched.value = false;
      isLyricsStretched.value = false;
      pendingInfoStretch.value = null;
      pendingLyricsStretch.value = null;
      window.setTimeout(() => {
        if (fetchId === latestFetchId) {
          coverImageSrc.value = '';
        }
      }, 200);
      return;
    }

    // 切换目标歌曲：复位编辑态后并行拉取封面、详情与歌词
    stopInfoStretchTimer();
    stopLyricsStretchTimer();
    isDismissAnimating.value = false;
    savedSongSnapshot.value = null;
    isInfoEditing.value = false;
    isInfoSaving.value = false;
    infoEditError.value = '';
    infoDraft.value = makeBlankDraft();
    isLoadingLyrics.value = true;
    isSavingLyrics.value = false;
    lyricsOrigin.value = 'empty';
    lyricsOriginFile.value = null;
    lyricsIssue.value = '';
    isInfoStretched.value = false;
    isLyricsStretched.value = false;
    pendingInfoStretch.value = null;
    pendingLyricsStretch.value = null;

    const [fetchedCover, fetchedDetail, lyricsResult] = await Promise.all([
      loadCover(path),
      fetchSongDetail(path).catch(() => null),
      lyricsApi.getSongLyricsForEdit(path)
        .then((lyrics) => ({ ...lyrics, error: '' }))
        .catch((error) => ({
          lyrics: '',
          source: 'empty' as LyricsStorageSource,
          sourcePath: null,
          error: String(error),
        })),
    ]);

    // 请求已过期或弹窗已切走时丢弃结果
    if (fetchId !== latestFetchId || !props.visible || path !== (props.song?.path ?? '')) {
      return;
    }

    coverImageSrc.value = fetchedCover || '';
    loadedDetail.value = fetchedDetail;
    lyricsDraft.value = lyricsResult.lyrics;
    lyricsBaseline.value = lyricsResult.lyrics;
    lyricsOrigin.value = lyricsResult.source;
    lyricsOriginFile.value = lyricsResult.sourcePath;
    lyricsIssue.value = lyricsResult.error;
    isLoadingLyrics.value = false;
    await nextTick();
    await runInitialAction(path);
  },
  { immediate: true },
);

const lyricsDirty = computed(() => lyricsDraft.value !== lyricsBaseline.value);
const infoStretchVisual = computed(() => pendingInfoStretch.value ?? isInfoStretched.value);
const lyricsStretchVisual = computed(() => pendingLyricsStretch.value ?? isLyricsStretched.value);

// 舞台容器的过渡状态类（展开/收起进行中 vs 稳态）
const stageStateClass = computed(() => [
  isDismissAnimating.value ? 'scale-95 opacity-0 translate-y-4' : 'scale-100 opacity-100 -translate-y-3',
  isInfoStretched.value ? 'song-info-stage--song-expanded' : '',
  isLyricsStretched.value ? 'song-info-stage--lyrics-expanded' : '',
  pendingInfoStretch.value === true ? 'song-info-stage--song-expanding' : '',
  pendingInfoStretch.value === false ? 'song-info-stage--song-collapsing' : '',
  pendingLyricsStretch.value === true ? 'song-info-stage--lyrics-expanding' : '',
  pendingLyricsStretch.value === false ? 'song-info-stage--lyrics-collapsing' : '',
]);

// 展示用歌曲对象：以扫描详情补全基础曲库记录
const presentedSong = computed(() => {
  if (!props.song) {
    return null;
  }

  const baseSong = savedSongSnapshot.value?.path === props.song.path ? savedSongSnapshot.value : props.song;

  return {
    ...baseSong,
    genre: loadedDetail.value?.genre ?? baseSong.genre,
    year: loadedDetail.value?.year ?? baseSong.year,
    container: loadedDetail.value?.container ?? baseSong.container,
    codec: loadedDetail.value?.codec ?? baseSong.codec,
    file_size: loadedDetail.value?.file_size ?? baseSong.file_size,
    track_number: loadedDetail.value?.track_number,
    disc_number: loadedDetail.value?.disc_number,
  };
});

const presentedTitle = computed(() => {
  const song = presentedSong.value;
  return song ? song.title || song.name : '';
});

const coverDisplaySrc = computed(() => infoDraft.value.coverPreview || coverImageSrc.value);

const onGlobalKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.visible) {
    requestDismiss();
  }
};

onMounted(() => window.addEventListener('keydown', onGlobalKey));
onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKey);
  stopInfoStretchTimer();
  stopLyricsStretchTimer();
});

const revealSongFolder = () => {
  if (props.song?.path) {
    void revealInFileManager(props.song.path);
    requestDismiss();
  }
};

const MUSICTAG_PATH_STORAGE_KEY = 'toolbox_musictag_path';

// 定位 MusicTag 可执行程序：优先复用本地记录，失效则引导重新登记
const locateMusicTagBinary = async (): Promise<string | null> => {
  let storedPath = localStorage.getItem(MUSICTAG_PATH_STORAGE_KEY);

  if (storedPath) {
    const stillOnDisk = await downloadApi.fileExists(storedPath);
    if (!stillOnDisk) {
      localStorage.removeItem(MUSICTAG_PATH_STORAGE_KEY);
      showToast('MusicTag 路径无效，请重新选择', 'error');
      storedPath = null;
    }
  }

  if (!storedPath) {
    const registered = await appApi.registerExternalProgram();

    if (!registered) {
      showToast('已取消选择 MusicTag', 'info');
      return null;
    }

    localStorage.setItem(MUSICTAG_PATH_STORAGE_KEY, registered);
    storedPath = registered;
  }

  return storedPath;
};

const sendSongToMusicTag = async () => {
  const songPath = props.song?.path;
  if (!songPath) {
    showToast('当前歌曲文件路径无效', 'error');
    return;
  }

  const songOnDisk = await downloadApi.fileExists(songPath);
  if (!songOnDisk) {
    showToast('当前歌曲文件路径无效', 'error');
    return;
  }

  const musicTagBinary = await locateMusicTagBinary();
  if (!musicTagBinary) {
    return;
  }

  try {
    await appApi.openExternalProgram(musicTagBinary, [songPath]);
    showToast('已在 MusicTag 中打开当前歌曲', 'success');
  } catch (error) {
    console.error('Failed to open MusicTag:', error);
    showToast('无法打开 MusicTag，请检查路径配置', 'error');
  }
};

const commitLyrics = async () => {
  if (!props.song?.path || isSavingLyrics.value) return;

  isSavingLyrics.value = true;
  lyricsIssue.value = '';

  try {
    const saved = await lyricsApi.saveSongLyrics(
      props.song.path,
      lyricsDraft.value,
      lyricsOrigin.value,
      lyricsOriginFile.value,
    );
    lyricsBaseline.value = lyricsDraft.value;
    lyricsOrigin.value = saved.source;
    lyricsOriginFile.value = saved.sourcePath;
  } catch (error) {
    lyricsIssue.value = String(error);
  } finally {
    isSavingLyrics.value = false;
  }
};

// 展开另一栏时立即收起本栏的对侧，动画结束后落定真实状态
const switchInfoStretch = () => {
  stopInfoStretchTimer();
  const target = !isInfoStretched.value;
  pendingInfoStretch.value = target;

  if (target) {
    stopLyricsStretchTimer();
    isLyricsStretched.value = false;
    pendingLyricsStretch.value = null;
  }

  infoStretchTimer = window.setTimeout(() => {
    isInfoStretched.value = target;
    pendingInfoStretch.value = null;
    infoStretchTimer = null;
  }, 360);
};

const switchLyricsStretch = () => {
  stopLyricsStretchTimer();
  const target = !isLyricsStretched.value;
  pendingLyricsStretch.value = target;

  if (target) {
    stopInfoStretchTimer();
    isInfoStretched.value = false;
    pendingInfoStretch.value = null;
  }

  lyricsStretchTimer = window.setTimeout(() => {
    isLyricsStretched.value = target;
    pendingLyricsStretch.value = null;
    lyricsStretchTimer = null;
  }, 360);
};

const fillDraftFromSong = () => {
  const song = presentedSong.value;
  if (!song) {
    infoDraft.value = makeBlankDraft();
    return;
  }

  infoDraft.value = {
    trackTitle: song.title || song.name || '',
    artistName: song.artist || '',
    albumName: song.album || '',
    trackNo: song.track_number || '',
    discNo: song.disc_number || '',
    releaseYear: song.year || '',
    newCoverPath: null,
    coverPreview: '',
  };
};

const enterInfoEdit = () => {
  infoEditError.value = '';
  fillDraftFromSong();
  isInfoEditing.value = true;
};

const leaveInfoEdit = () => {
  if (isInfoSaving.value) return;
  infoEditError.value = '';
  isInfoEditing.value = false;
  fillDraftFromSong();
};

const trimToNull = (value: string) => value.trim() || null;

const handleChooseCover = async () => {
  if (!isInfoEditing.value) return;

  const picked = await open({
    multiple: false, directory: false,
    title: '选择歌曲封面',
    filters: [
      {
        name: '图片',
        extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'],
      },
    ],
  });

  if (!picked || Array.isArray(picked)) {
    return;
  }

  infoDraft.value.newCoverPath = picked;
  infoDraft.value.coverPreview = convertFileSrc(picked);
};

// 按外部指定的入口动作直接落到对应编辑态
const runInitialAction = async (path: string) => {
  if (!props.visible || props.song?.path !== path) return;

  if (props.initialAction === 'cover') {
    enterInfoEdit();
    isInfoStretched.value = true;
    isLyricsStretched.value = false;
    await nextTick();
    await handleChooseCover();
    return;
  }

  if (props.initialAction === 'lyrics') {
    isInfoStretched.value = false;
    isLyricsStretched.value = true;
    await nextTick();
    lyricsTextareaRef.value?.focus();
  }
};

const commitSongInfo = async () => {
  const songPath = props.song?.path;
  if (!songPath || isInfoSaving.value) return;

  const nextTitle = infoDraft.value.trackTitle.trim();
  if (!nextTitle) {
    infoEditError.value = '歌名不能为空';
    return;
  }

  isInfoSaving.value = true;
  infoEditError.value = '';

  try {
    const result = await lyricsApi.saveSongInfo(songPath, {
      title: nextTitle,
      artist: infoDraft.value.artistName.trim(),
      album: infoDraft.value.albumName.trim(),
      trackNumber: trimToNull(infoDraft.value.trackNo),
      discNumber: trimToNull(infoDraft.value.discNo),
      year: trimToNull(infoDraft.value.releaseYear),
      coverPath: infoDraft.value.newCoverPath,
    });

    savedSongSnapshot.value = result.song;
    loadedDetail.value = result.detail;
    libraryStore.setSongRecord(result.song);

    if (infoDraft.value.newCoverPath) {
      await appApi.clearCoverCache();
      clearCoverCaches();
      coverImageSrc.value = (await loadCover(songPath)) || '';
    }

    isInfoEditing.value = false;
    fillDraftFromSong();
    showToast('歌曲信息已保存', 'success');
  } catch (error) {
    const message = String(error);
    infoEditError.value = message;
    showToast(`保存歌曲信息失败: ${message}`, 'error');
  } finally {
    isInfoSaving.value = false;
  }
};

const describeFileSize = (bytes?: number) => {
  if (bytes === undefined || bytes <= 0) { return '无'; }
  return formatFileSize(bytes);
};

const describeDuration = (seconds?: number) => {
  if (!seconds) { return '无'; }
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const restSeconds = wholeSeconds % 60;
  return `${minutes}:${restSeconds.toString().padStart(2, '0')}`;
};

const describeBitrate = (bitrate?: number) =>
  (!bitrate ? '待扫描' : `${Math.round(bitrate)} kbps`);

const describeSampleRate = (rate?: number) =>
  (!rate ? '无' : `${(rate / 1000).toFixed(1)} kHz`);

const describeTimestamp = (timestampSeconds?: number) => {
  if (!timestampSeconds) { return '无'; }
  const at = new Date(timestampSeconds * 1000);
  return at.toLocaleString();
};
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="z-[10000] fixed inset-0 flex items-center justify-center p-4 sm:p-6"
      :class="{'pointer-events-none': isDismissAnimating}"
    >
      <div
        class="inset-0 absolute bg-black/40 backdrop-blur-sm duration-300 ease-out transition-opacity"
        :class="isDismissAnimating ? 'opacity-0' : 'opacity-100'"
        @click="requestDismiss"
      ></div>

      <div data-tauri-drag-region class="song-info-window-drag-strip"></div>

      <div
        class="song-info-stage"
        :class="[stageStateClass, isDarkTheme ? 'song-info-stage--dark' : '']"
      >
        <section class="song-info-column">
          <div class="song-info-header modal-external-header">
            <div class="song-info-header-title">
              <h2 class="text-lg font-bold dark:text-white text-gray-900">歌曲信息</h2>
              <button
                type="button"
                class="song-info-edit-toggle"
                :class="isInfoEditing ? 'song-info-edit-toggle--active' : ''"
                :aria-label="isInfoEditing ? '取消编辑歌曲信息' : '编辑歌曲信息'"
                :title="isInfoEditing ? '取消编辑歌曲信息' : '编辑歌曲信息'"
                @click="isInfoEditing ? leaveInfoEdit() : enterInfoEdit()"
              >
                <SquarePen class="h-4 w-4" :stroke-width="2.2" />
              </button>
            </div>
            <button
              type="button"
              class="lyrics-editor-expand-button"
              :title="infoStretchVisual ? '还原歌曲信息' : '放大歌曲信息'"
              @click="switchInfoStretch"
            >
              <svg v-if="!infoStretchVisual" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <svg v-else class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </div>

          <div
            class="song-info-main relative w-full dark:bg-gray-900/90 bg-white/85 backdrop-blur-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col dark:border-white/10 border border-white/40"
          >
            <div v-if="presentedSong" class="song-info-content p-6 custom-scrollbar overflow-y-auto">
              <div class="song-info-hero flex flex-col sm:flex-row mb-4 gap-6">
                <button
                  type="button"
                  class="song-info-cover w-32 h-32 shrink-0 rounded-xl overflow-hidden dark:bg-gray-800 bg-gray-100 shadow-md dark:border-gray-700/50 border border-gray-200/50 flex items-center justify-center"
                  :class="isInfoEditing ? 'song-info-cover--editable' : ''"
                  :disabled="!isInfoEditing"
                  @click="handleChooseCover"
                >
                  <img v-if="coverDisplaySrc" decoding="async" draggable="false" class="object-cover h-full w-full" :src="coverDisplaySrc" />
                  <svg v-else class="w-12 h-12 dark:text-gray-600 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path
                      d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                  <span v-if="isInfoEditing" class="song-info-cover-overlay">更换封面</span>
                </button>

                <div class="flex-1 min-w-0 flex flex-col justify-center">
                  <template v-if="isInfoEditing">
                    <div class="song-info-edit-wrapper">
                      <label class="song-info-edit-label" for="song-info-title-input">歌名</label>
                      <input
                        id="song-info-title-input"
                        v-model="infoDraft.trackTitle"
                        class="song-info-edit-input--title song-info-edit-input--with-label song-info-edit-input"
                        placeholder="请输入歌名"
                      />
                    </div>
                    <div class="song-info-edit-wrapper mt-3">
                      <label class="song-info-edit-label" for="song-info-artist-input">歌手</label>
                      <input
                        id="song-info-artist-input"
                        v-model="infoDraft.artistName"
                        class="song-info-edit-input--artist song-info-edit-input--with-label song-info-edit-input"
                        placeholder="请输入歌手名"
                      />
                    </div>
                    <div class="song-info-edit-wrapper mt-2">
                      <label class="song-info-edit-label" for="song-info-album-input">专辑</label>
                      <input
                        id="song-info-album-input"
                        v-model="infoDraft.albumName"
                        class="song-info-edit-input--with-label song-info-edit-input"
                        placeholder="请输入专辑名"
                      />
                    </div>
                  </template>
                  <template v-else>
                    <h3 class="song-info-name text-3xl font-bold dark:text-white truncate text-gray-900" :title="presentedTitle">{{ presentedTitle }}</h3>
                    <p class="text-lg mt-3 truncate dark:text-gray-300 text-gray-600" :title="presentedSong.artist">{{ presentedSong.artist }}</p>
                    <p class="text-base mt-2 truncate dark:text-gray-400 text-gray-500" :title="presentedSong.album">专辑：{{ presentedSong.album }}</p>
                  </template>

                  <div v-if="presentedSong.is_various_artists_album" class="flex gap-2 flex-wrap mt-4">
                    <span class="px-2 py-0.5 text-xs font-semibold rounded dark:bg-blue-900/30 bg-blue-100/80 dark:text-blue-300 text-blue-700 dark:border-blue-800/50 border border-blue-200">
                      群星合辑
                    </span>
                  </div>
                </div>
              </div>

              <div v-if="infoEditError" class="song-info-edit-error">{{ infoEditError }}</div>

              <div class="flex flex-col gap-4">
                <div class="song-info-detail-grid dark:bg-white/5 bg-gray-50/50 rounded-xl p-4 dark:border-gray-800 border border-gray-100 grid grid-cols-3 gap-y-6 gap-x-4">
                  <div>
                    <div class="text-[11px] font-semibold uppercase tracking-wider mb-1 text-gray-400 dark:text-gray-500">音轨号</div>
                    <input
                      v-if="isInfoEditing"
                      v-model="infoDraft.trackNo"
                      class="song-info-edit-input song-info-edit-input--compact"
                      placeholder="无"
                    />
                    <div v-else class="text-sm dark:text-gray-200 text-gray-800">{{ presentedSong.track_number || '无' }}</div>
                  </div>
                  <div>
                    <div class="text-[11px] font-semibold uppercase tracking-wider mb-1 text-gray-400 dark:text-gray-500">碟号</div>
                    <input
                      v-if="isInfoEditing"
                      v-model="infoDraft.discNo"
                      class="song-info-edit-input song-info-edit-input--compact"
                      placeholder="无"
                    />
                    <div v-else class="text-sm dark:text-gray-200 text-gray-800">{{ presentedSong.disc_number || '无' }}</div>
                  </div>
                  <div>
                    <div class="text-[11px] font-semibold uppercase tracking-wider mb-1 text-gray-400 dark:text-gray-500">年份</div>
                    <input
                      v-if="isInfoEditing"
                      v-model="infoDraft.releaseYear"
                      class="song-info-edit-input song-info-edit-input--compact"
                      placeholder="无"
                    />
                    <div v-else class="text-sm dark:text-gray-200 text-gray-800">{{ presentedSong.year || '无' }}</div>
                  </div>

                  <div>
                    <div class="text-[11px] font-semibold uppercase tracking-wider mb-1 text-gray-400 dark:text-gray-500">音乐时长</div>
                    <div class="text-sm dark:text-gray-200 text-gray-800">{{ describeDuration(presentedSong.duration) }}</div>
                  </div>
                  <div>
                    <div class="text-[11px] font-semibold uppercase tracking-wider mb-1 text-gray-400 dark:text-gray-500">文件大小</div>
                    <div class="text-sm dark:text-gray-200 text-gray-800">{{ describeFileSize(presentedSong.file_size) }}</div>
                  </div>
                  <div>
                    <div class="text-[11px] font-semibold uppercase tracking-wider mb-1 text-gray-400 dark:text-gray-500">格式</div>
                    <div class="text-sm uppercase dark:text-gray-200 text-gray-800">{{ presentedSong.format || presentedSong.container || '无' }}</div>
                  </div>

                  <div>
                    <div class="text-[11px] font-semibold uppercase tracking-wider mb-1 text-gray-400 dark:text-gray-500">位深</div>
                    <div class="text-sm dark:text-gray-200 text-gray-800">{{ presentedSong.bit_depth ? presentedSong.bit_depth + ' bit' : '无' }}</div>
                  </div>
                  <div>
                    <div class="text-[11px] font-semibold uppercase tracking-wider mb-1 text-gray-400 dark:text-gray-500">采样率</div>
                    <div class="text-sm dark:text-gray-200 text-gray-800">{{ describeSampleRate(presentedSong.sample_rate) }}</div>
                  </div>
                  <div>
                    <div class="text-[11px] font-semibold uppercase tracking-wider mb-1 text-gray-400 dark:text-gray-500">比特率</div>
                    <div class="text-sm dark:text-gray-200 text-gray-800">{{ describeBitrate(presentedSong.bitrate) }}</div>
                  </div>
                </div>

                <div class="dark:bg-white/5 bg-gray-50/50 rounded-xl p-4 dark:border-gray-800 border border-gray-100">
                  <div class="text-[11px] font-semibold uppercase tracking-wider mb-1 no-text-select text-gray-400 dark:text-gray-500">文件路径</div>
                  <div class="text-sm break-all leading-snug selectable-text dark:text-gray-200 text-gray-800">{{ presentedSong.path }}</div>
                </div>

                <div class="song-info-time-grid dark:bg-white/5 bg-gray-50/50 rounded-xl p-4 dark:border-gray-800 border border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div class="text-[11px] font-semibold uppercase tracking-wider mb-1 text-gray-400 dark:text-gray-500">添加时间</div>
                    <div class="text-sm dark:text-gray-200 text-gray-800">{{ describeTimestamp(presentedSong.added_at) }}</div>
                  </div>
                  <div>
                    <div class="text-[11px] font-semibold uppercase tracking-wider mb-1 text-gray-400 dark:text-gray-500">文件修改时间</div>
                    <div class="text-sm dark:text-gray-200 text-gray-800">{{ describeTimestamp(presentedSong.file_modified_at) }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="modal-external-actions song-info-footer">
            <button
              v-if="!isInfoEditing"
              class="modal-action-button--wide modal-action-button"
              @click="revealSongFolder"
            >
              <svg class="w-4 h-4 mr-2 dark:text-gray-400 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              打开文件所在目录
            </button>
            <button
              v-if="!isInfoEditing"
              class="modal-action-button--wide modal-action-button"
              :disabled="!props.song?.path"
              @click="sendSongToMusicTag"
            >
              <Tag class="w-4 h-4 mr-2 dark:text-gray-400 text-gray-500" />
              用 MusicTag 修正标签
            </button>
            <template v-else>
              <button
                type="button"
                class="modal-action-button"
                :disabled="isInfoSaving"
                @click="leaveInfoEdit"
              >
                取消
              </button>
              <button
                type="button"
                class="modal-action-button--primary modal-action-button"
                :disabled="isInfoSaving"
                @click="commitSongInfo"
              >
                {{ isInfoSaving ? '保存中' : '保存信息' }}
              </button>
            </template>
          </div>
        </section>

        <section class="lyrics-editor-column" :class="lyricsStretchVisual ? 'lyrics-editor-column--expanded' : ''">
          <div class="lyrics-editor-header modal-external-header">
            <div class="lyrics-editor-heading">
              <div class="lyrics-editor-title" :class="lyricsStretchVisual ? 'lyrics-editor-title--expanded' : ''">
                编辑歌词
              </div>
              <div
                v-if="presentedSong"
                class="lyrics-editor-inline-song"
                :class="lyricsStretchVisual ? '' : 'lyrics-editor-inline-song--hidden'"
              >
                <div class="lyrics-editor-cover">
                  <img v-if="coverImageSrc" alt="" decoding="async" draggable="false" :src="coverImageSrc" />
                  <svg v-else class="h-5 w-5 dark:text-white/40 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path
                      d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </div>
                <div class="min-w-0">
                  <div class="truncate text-sm font-bold dark:text-white text-gray-900" :title="presentedTitle">
                    {{ presentedTitle }}
                  </div>
                  <div class="truncate text-xs dark:text-white/50 text-gray-500" :title="presentedSong.artist">
                    {{ presentedSong.artist }}
                  </div>
                </div>
              </div>
            </div>
            <button
              type="button"
              class="lyrics-editor-expand-button"
              :title="lyricsStretchVisual ? '还原歌词编辑器' : '放大歌词编辑器'"
              @click="switchLyricsStretch"
            >
              <svg v-if="!lyricsStretchVisual" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <svg v-else class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </div>

          <aside class="lyrics-editor-panel" :class="lyricsStretchVisual ? 'lyrics-editor-panel--expanded' : ''">
            <textarea
              ref="lyricsTextareaRef"
              v-model="lyricsDraft"
              class="custom-scrollbar lyrics-editor-textarea"
              :placeholder="isLoadingLyrics ? '正在读取歌词...' : '[00:00.00] 在这里编辑 LRC 歌词'"
              :disabled="isLoadingLyrics"
              spellcheck="false"
            ></textarea>

            <div v-if="lyricsIssue" class="lyrics-editor-error">{{ lyricsIssue }}</div>
          </aside>

          <div class="modal-external-actions lyrics-editor-actions">
            <button
              type="button"
              class="modal-action-button--primary modal-action-button"
              :disabled="!lyricsDirty || isSavingLyrics"
              @click="commitLyrics"
            >
              {{ isSavingLyrics ? '保存中' : '保存' }}
            </button>
          </div>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 动画曲线工具类 */
.cubic-bezier { transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1); }

.song-info-stage {
  /* 面板尺寸与布局节奏相关的全部调节变量 */
  --song-info-footer-height: clamp(44px, 5.8vh, 52px); --song-info-footer-gap: clamp(10px, 1.2vh, 14px); --song-info-page-gap: clamp(12px, 1.3vw, 18px);
  --song-info-viewport-x: clamp(360px, 26vw, 520px); --song-info-viewport-y: clamp(120px, 14vh, 190px);
  --lyrics-panel-width: clamp(340px, 32vw, 460px); --song-info-main-width: min(680px, calc(100% - var(--lyrics-panel-width) - var(--song-info-page-gap)));
  --lyrics-editor-panel-bg: rgba(255, 255, 255, 0.82);
  --lyrics-editor-panel-border: rgba(255, 255, 255, 0.38); --lyrics-editor-panel-shadow: 0 24px 70px rgba(15, 23, 42, 0.2);
  --modal-external-header-bg: rgba(255, 255, 255, 0.62); --modal-external-header-border: rgba(255, 255, 255, 0.42); --modal-external-header-shadow: 0 10px 28px rgba(15, 23, 42, 0.12);
  --lyrics-editor-title-color: rgb(17 24 39); --lyrics-editor-text-color: rgb(31 41 55); --lyrics-editor-placeholder-color: rgb(156 163 175);
  --lyrics-editor-button-bg: rgba(255, 255, 255, 0.72); --lyrics-editor-button-border: rgba(148, 163, 184, 0.26); --lyrics-editor-button-color: rgb(55 65 81);
  --lyrics-editor-button-shadow: 0 4px 12px rgba(15, 23, 42, 0.08); --lyrics-editor-expand-bg: rgba(255, 255, 255, 0.68); --lyrics-editor-expand-border: rgba(148, 163, 184, 0.22); --lyrics-editor-expand-color: rgb(75 85 99);
  position: relative; z-index: 2; display: flex;
  gap: var(--song-info-page-gap);
  width: min(1360px, calc(100vw - var(--song-info-viewport-x)));
  height: min(1040px, calc(100dvh - var(--song-info-viewport-y))); max-height: min(1040px, calc(100dvh - var(--song-info-viewport-y)));
  -webkit-user-select: text; user-select: text;
  transform-origin: center center;
  transition: gap 360ms cubic-bezier(0.4, 0, 0.2, 1), opacity 300ms ease, transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.song-info-stage--dark {
  --lyrics-editor-panel-bg: rgba(15, 23, 42, 0.92);
  --lyrics-editor-panel-border: rgba(255, 255, 255, 0.1); --lyrics-editor-panel-shadow: 0 24px 70px rgba(0, 0, 0, 0.38);
  --modal-external-header-bg: rgba(15, 23, 42, 0.72);
  --modal-external-header-border: rgba(255, 255, 255, 0.1); --modal-external-header-shadow: 0 10px 28px rgba(0, 0, 0, 0.26);
  --lyrics-editor-title-color: rgb(248 250 252); --lyrics-editor-text-color: rgba(255, 255, 255, 0.86); --lyrics-editor-placeholder-color: rgba(148, 163, 184, 0.72);
  --lyrics-editor-button-bg: rgba(255, 255, 255, 0.06);
  --lyrics-editor-button-border: rgba(255, 255, 255, 0.1); --lyrics-editor-button-color: rgba(255, 255, 255, 0.82); --lyrics-editor-button-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
  --lyrics-editor-expand-bg: rgba(255, 255, 255, 0.06); --lyrics-editor-expand-border: rgba(255, 255, 255, 0.1); --lyrics-editor-expand-color: rgba(255, 255, 255, 0.68);
}

.song-info-window-drag-strip {
  position: absolute; top: 0; right: 0; left: 0; z-index: 1;
  height: clamp(56px, 9vh, 92px); cursor: default;
}

.song-info-content { flex: 1 1 auto; min-height: 0; padding: clamp(18px, 2.2vw, 24px); }

.song-info-hero { gap: clamp(16px, 2vw, 24px); }

.song-info-cover { width: clamp(96px, 10vw, 128px); height: clamp(96px, 10vw, 128px); }

.song-info-name { font-size: clamp(22px, 2.8vw, 30px); line-height: 1.18; }

.song-info-detail-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: clamp(14px, 1.8vw, 24px) clamp(12px, 1.6vw, 16px); }

.song-info-stage--song-expanding, .song-info-stage--song-expanded, .song-info-stage--lyrics-expanding, .song-info-stage--lyrics-expanded { gap: 0; }

.song-info-stage--song-collapsing, .song-info-stage--lyrics-collapsing { gap: var(--song-info-page-gap); }

.song-info-stage--lyrics-expanding .song-info-column, .song-info-stage--lyrics-expanded .song-info-column { flex-basis: 0; width: 0; opacity: 0; transform: translateX(-18px); pointer-events: none; }

.song-info-stage--lyrics-collapsing .song-info-column { flex-basis: var(--song-info-main-width); width: auto; opacity: 1; transform: translateX(0); pointer-events: auto; }

.song-info-stage--song-expanding .song-info-column, .song-info-stage--song-expanded .song-info-column { flex-basis: 100%; }

.song-info-stage--song-collapsing .song-info-column { flex-basis: var(--song-info-main-width); }

.song-info-stage--lyrics-expanding .lyrics-editor-column, .song-info-stage--lyrics-expanded .lyrics-editor-column { flex-basis: 100%; }

.song-info-stage--song-expanding .lyrics-editor-column, .song-info-stage--song-expanded .lyrics-editor-column { flex-basis: 0; min-width: 0; width: 0; opacity: 0; transform: translateX(18px); pointer-events: none; }

.song-info-stage--lyrics-collapsing .lyrics-editor-column { flex-basis: var(--lyrics-panel-width); }

.song-info-stage--song-collapsing .lyrics-editor-column { flex-basis: var(--lyrics-panel-width); opacity: 1; transform: translateX(0); pointer-events: auto; }

.song-info-stage--lyrics-expanding .lyrics-editor-textarea, .song-info-stage--lyrics-collapsing .lyrics-editor-textarea, .song-info-stage--song-expanding .song-info-content, .song-info-stage--song-collapsing .song-info-content { scrollbar-width: none; }

.song-info-stage--lyrics-expanding .lyrics-editor-textarea::-webkit-scrollbar, .song-info-stage--lyrics-collapsing .lyrics-editor-textarea::-webkit-scrollbar, .song-info-stage--song-expanding .song-info-content::-webkit-scrollbar, .song-info-stage--song-collapsing .song-info-content::-webkit-scrollbar { width: 0; height: 0; }

.song-info-column, .lyrics-editor-column { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; max-height: min(860px, calc(100dvh - var(--song-info-viewport-y))); transition: flex-basis 360ms cubic-bezier(0.4, 0, 0.2, 1), width 360ms cubic-bezier(0.4, 0, 0.2, 1), opacity 360ms cubic-bezier(0.4, 0, 0.2, 1), transform 360ms cubic-bezier(0.4, 0, 0.2, 1), max-height 360ms cubic-bezier(0.4, 0, 0.2, 1); }

.song-info-main, .lyrics-editor-panel { flex: 1 1 0; min-height: 0; height: auto; max-height: min(860px, calc(100dvh - var(--song-info-viewport-y))); transition: border-color 160ms ease, background-color 160ms ease, max-height 360ms cubic-bezier(0.4, 0, 0.2, 1); }

.song-info-column {
  flex: 0 1 var(--song-info-main-width); min-width: 0;
  animation: info-column-enter 520ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.song-info-main { overflow: hidden; }

.lyrics-editor-column {
  flex: 1 1 var(--lyrics-panel-width); min-width: min(320px, 100%);
  animation: lyrics-column-enter 560ms cubic-bezier(0.16, 1, 0.3, 1) 40ms both;
}

.song-info-stage--lyrics-expanded .lyrics-editor-column { max-height: min(860px, calc(100dvh - var(--song-info-viewport-y))); height: min(860px, calc(100dvh - var(--song-info-viewport-y))); }

.lyrics-editor-panel { position: relative; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--lyrics-editor-panel-border); border-radius: 22px; background: var(--lyrics-editor-panel-bg); box-shadow: var(--lyrics-editor-panel-shadow); backdrop-filter: blur(24px) saturate(150%); -webkit-backdrop-filter: blur(24px) saturate(150%); transform: translateX(0) scale(1); transition: border-color 160ms ease, background-color 160ms ease; }

.lyrics-editor-panel--expanded { transform: translateX(0) scale(1); }

.modal-external-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 52px; padding: 6px 18px; margin-bottom: 10px; border: 1px solid var(--modal-external-header-border); border-radius: 16px; background: var(--modal-external-header-bg); box-shadow: var(--modal-external-header-shadow); backdrop-filter: blur(18px) saturate(145%); -webkit-backdrop-filter: blur(18px) saturate(145%); flex-shrink: 0; }

.song-info-header-title { display: flex; align-items: center; gap: 10px; min-width: 0; }

.song-info-edit-toggle { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; flex-shrink: 0; border: 0; border-radius: 8px; background: transparent; padding: 0; color: var(--lyrics-editor-button-color); line-height: 1; transition: border-color 160ms ease, background-color 160ms ease, color 160ms ease; }

.song-info-edit-toggle:hover, .song-info-edit-toggle--active { background: transparent; color: #ec4141; }

/* 提升为独立合成层，规避圆角裁剪在 Chromium 下的溢出缺陷 */
.song-info-cover { position: relative; padding: 0; color: inherit; cursor: default; transform: translateZ(0); border-radius: 12px; overflow: hidden; }

.song-info-cover:disabled { opacity: 1; }

.song-info-cover--editable { cursor: pointer; }

.song-info-cover--editable:hover { border-color: rgba(236, 65, 65, 0.35); }

/* 底部圆角与外层容器对齐，保证覆盖层不出现直角 */
.song-info-cover-overlay { position: absolute; right: 0; bottom: 0; left: 0; display: flex; align-items: center; justify-content: center; min-height: 32px; background: rgba(15, 23, 42, 0.62); color: #fff; font-size: 12px; font-weight: 800; line-height: 1; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-radius: 0 0 12px 12px; }

.song-info-edit-input { width: 100%; min-width: 0; border: 1px solid rgba(148, 163, 184, 0.22); border-radius: 10px; background: rgba(255, 255, 255, 0.64); padding: 9px 11px; color: rgb(17 24 39); font-size: 14px; font-weight: 700; line-height: 1.2; outline: none; transition: border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease; }

.song-info-edit-input:focus { border-color: rgba(236, 65, 65, 0.45); background: rgba(255, 255, 255, 0.9); box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.1); }

.song-info-edit-input--title { padding: 10px 12px; font-size: clamp(21px, 2.6vw, 28px); font-weight: 800; }

.song-info-edit-input--artist { font-size: 16px; }

.song-info-edit-input--compact { height: 32px; padding: 6px 8px; font-size: 13px; }

.song-info-edit-error {
  margin-bottom: 14px;
  border: 1px solid rgba(236, 65, 65, 0.22); border-radius: 12px;
  background: rgba(236, 65, 65, 0.08); padding: 10px 12px;
  color: #ec4141; font-size: 12px; line-height: 1.5;
}

.song-info-stage--dark .song-info-edit-input { border-color: rgba(255, 255, 255, 0.1); background: rgba(255, 255, 255, 0.06); color: rgba(255, 255, 255, 0.9); }

.song-info-stage--dark .song-info-edit-input:focus { border-color: rgba(236, 65, 65, 0.42); background: rgba(255, 255, 255, 0.1); }

.lyrics-editor-header { padding-right: 18px; }

.lyrics-editor-heading { display: flex; align-items: center; gap: 18px; min-width: 0; }

.lyrics-editor-expand-button { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; flex-shrink: 0; border: 0; border-radius: 10px; background: transparent; color: var(--lyrics-editor-expand-color); transition: border-color 160ms ease, background-color 160ms ease, color 160ms ease; }

.lyrics-editor-expand-button:hover { background: transparent; color: #ec4141; }

.song-info-stage--dark .lyrics-editor-expand-button:hover { border-color: rgba(236, 65, 65, 0.4); color: #ff8b8b; }

.lyrics-editor-title { flex-shrink: 0; color: var(--lyrics-editor-title-color); font-size: 18px; font-weight: 800; line-height: 1.2; }

.lyrics-editor-inline-song { display: flex; align-items: center; gap: 12px; animation: lyrics-summary-enter 160ms ease both; }

.lyrics-editor-inline-song--hidden { opacity: 0; visibility: hidden; }

.lyrics-editor-cover { display: flex; align-items: center; justify-content: center; width: 42px; height: 42px; flex-shrink: 0; overflow: hidden; border-radius: 10px; background: rgba(148, 163, 184, 0.14); }

.lyrics-editor-cover img { width: 100%; height: 100%; object-fit: cover; }

.lyrics-editor-textarea { flex: 1; box-sizing: border-box; width: 100%; min-height: 420px; resize: none; border: 0; background: transparent; padding: 18px; color: var(--lyrics-editor-text-color); font-family: "Sarasa Gothic SC", "Sarasa Mono SC", "Sarasa Gothic", "Sarasa Mono", sans-serif; font-size: 13px; line-height: 1.7; outline: none; }

.lyrics-editor-panel--expanded .lyrics-editor-textarea { min-height: 0; }

.modal-action-button { display: inline-flex; align-items: center; justify-content: center; min-width: 88px; height: 44px; border: 1px solid var(--lyrics-editor-button-border); border-radius: 10px; background: var(--lyrics-editor-button-bg); box-shadow: var(--lyrics-editor-button-shadow); padding: 0 16px; color: var(--lyrics-editor-button-color); font-size: 14px; font-weight: 700; line-height: 1; backdrop-filter: blur(16px) saturate(145%); -webkit-backdrop-filter: blur(16px) saturate(145%); transition: border-color 160ms ease, background-color 160ms ease, color 160ms ease, box-shadow 160ms ease; }

@keyframes lyrics-summary-enter { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }

@keyframes info-column-enter { from { transform: translateX(-24px); } to { transform: translateX(0); } }

@keyframes lyrics-column-enter { from { transform: translateX(24px); } to { transform: translateX(0); } }

@media (prefers-reduced-motion: reduce) {
  .song-info-stage, .song-info-column, .lyrics-editor-column, .lyrics-editor-panel { transition-duration: 0ms; }

  .song-info-column, .lyrics-editor-column, .lyrics-editor-inline-song { animation: none; }
}

.lyrics-editor-textarea::placeholder { color: var(--lyrics-editor-placeholder-color); }

.lyrics-editor-error { margin: 0 18px 12px; border: 1px solid rgba(236, 65, 65, 0.22); border-radius: 12px; background: rgba(236, 65, 65, 0.08); padding: 10px 12px; color: #ec4141; font-size: 12px; line-height: 1.5; }

.modal-external-actions { position: absolute; right: 0; left: 0; top: calc(100% + var(--song-info-footer-gap)); display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: var(--song-info-footer-height); background: transparent; pointer-events: auto; }

.lyrics-editor-actions { gap: clamp(10px, 1.4vw, 20px); }

.modal-action-button--wide { min-width: 184px; }

.modal-action-button:hover:not(:disabled) { border-color: rgba(236, 65, 65, 0.38); color: #ec4141; }

.modal-action-button:disabled { cursor: not-allowed; opacity: 0.48; }

.modal-action-button--primary { border-color: transparent; background: #ec4141; color: #fff; }

.song-info-stage--dark .modal-action-button--primary { background: #ec4141; color: #fff; }

@media (max-width: 1100px) {
  .song-info-stage { --song-info-footer-height: clamp(42px, 6vh, 48px); --song-info-footer-gap: 10px; --song-info-viewport-x: clamp(180px, 24vw, 280px); --song-info-viewport-y: clamp(120px, 20vh, 190px); flex-direction: column; overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none; width: min(100%, calc(100vw - var(--song-info-viewport-x))); height: calc(100dvh - var(--song-info-viewport-y)); max-height: calc(100dvh - var(--song-info-viewport-y)); }

  .song-info-stage::-webkit-scrollbar { display: none; width: 0; height: 0; }

  .modal-external-actions { position: static; justify-content: center; margin-top: var(--song-info-footer-gap); }

  .song-info-stage--lyrics-expanding .song-info-column, .song-info-stage--lyrics-expanded .song-info-column { position: absolute; inset: 0; }

  .song-info-column, .lyrics-editor-column, .song-info-main, .lyrics-editor-panel { max-height: none; }

  .song-info-main { flex: 0 0 auto; height: auto; overflow: visible; }

  .song-info-content { overflow: visible; }

  .song-info-column, .song-info-stage--lyrics-collapsing .song-info-column { flex: 0 0 auto; width: 100%; height: auto; }

  .lyrics-editor-column, .song-info-stage--lyrics-collapsing .lyrics-editor-column { flex: 0 0 min(440px, calc(100dvh - var(--song-info-viewport-y))); width: 100%; min-width: 0; min-height: 360px; }

  .song-info-stage--lyrics-expanding .lyrics-editor-column, .song-info-stage--lyrics-expanded .lyrics-editor-column { flex-basis: auto; max-height: calc(100dvh - var(--song-info-viewport-y)); height: calc(100dvh - var(--song-info-viewport-y)); }

  .lyrics-editor-textarea { min-height: 280px; }

  .lyrics-editor-panel--expanded .lyrics-editor-textarea { min-height: 0; }

  .lyrics-editor-heading { gap: 12px; }
}

@media (max-width: 760px) {
  .song-info-stage { --song-info-viewport-x: clamp(96px, 20vw, 132px); --song-info-viewport-y: clamp(72px, 16vh, 112px); --song-info-footer-height: 42px; border-radius: 18px; }

  .song-info-hero { flex-direction: row; align-items: center; gap: 14px; }

  .song-info-cover { width: 84px; height: 84px; }

  .song-info-name { font-size: 22px; }

  .song-info-detail-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }

  .song-info-footer, .lyrics-editor-actions { gap: 8px; }

  .modal-action-button { min-width: 76px; height: 38px; padding-inline: 11px; font-size: 13px; }

  .modal-action-button--wide { min-width: 152px; }
}

@media (max-width: 520px) {
  .song-info-stage { --song-info-viewport-x: 64px; --song-info-viewport-y: 56px; --song-info-footer-height: 42px; border-radius: 16px; }

  .song-info-content { padding: 12px; }

  .song-info-hero { gap: 10px; }

  .song-info-cover { width: 64px; height: 64px; }

  .song-info-detail-grid, .song-info-time-grid { grid-template-columns: 1fr; }

  .modal-action-button--wide { min-width: 0; }

  .modal-external-header { min-height: 48px; padding: 5px 14px; }

  .lyrics-editor-expand-button { width: 32px; height: 32px; }
}

@media (max-height: 720px) {
  .song-info-stage { --song-info-footer-height: 42px; --song-info-viewport-y: clamp(88px, 18vh, 140px); }

  .modal-external-header { min-height: 48px; padding-block: 5px; }

  .lyrics-editor-textarea { min-height: 220px; padding-block: 14px; }

  .song-info-cover { width: clamp(84px, 12vh, 112px); height: clamp(84px, 12vh, 112px); }
}

.song-info-edit-wrapper { position: relative; width: 100%; }

.song-info-edit-label { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); font-size: 11px; font-weight: 700; color: #94a3b8; letter-spacing: 0.05em; pointer-events: none; user-select: none; transition: color 160ms ease, opacity 160ms ease; z-index: 1; }

.song-info-edit-wrapper:focus-within .song-info-edit-label { color: #ec4141; }

.song-info-edit-input--with-label { padding-left: 56px; }

.song-info-stage--dark .song-info-edit-label { color: rgba(255, 255, 255, 0.4); }

.song-info-stage--dark .song-info-edit-wrapper:focus-within .song-info-edit-label { color: #ec4141; }

/* 文本选中与图片拖拽行为的细化控制 */
.no-text-select { -webkit-user-select: none; user-select: none; }

.selectable-text { -webkit-user-select: text; user-select: text; }

.modal-external-header, .song-info-header-title, .song-info-edit-toggle, .lyrics-editor-expand-button, .lyrics-editor-inline-song, .song-info-cover, .song-info-cover-overlay, .song-info-detail-grid, .song-info-time-grid, .modal-external-actions, .modal-action-button { -webkit-user-select: none; user-select: none; }

.song-info-stage input, .song-info-stage textarea, .song-info-stage [contenteditable='true'], .song-info-stage .selectable-text { -webkit-user-select: text; user-select: text; }

.song-info-cover img { -webkit-user-drag: none; user-drag: none; border-radius: 12px; }

.lyrics-editor-cover img { -webkit-user-drag: none; user-drag: none; }
</style>
