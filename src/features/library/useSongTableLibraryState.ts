import { computed, onUnmounted, ref, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';

import type { ScanLibraryOptions } from './libraryScan';
import type { Song } from '../../types';
import { useLibraryStore } from './store';

// Hero 扫描卡片：最短展示时长与扫描成功后的额外停留时长（毫秒）。
const HERO_CARD_MIN_VISIBLE_MS = 700;
const HERO_CARD_SUCCESS_DWELL_MS = 900;

type HeroScanState = 'scanning' | 'success' | 'error';

interface UseSongTableStateOptions {
  currentViewMode: Ref<string>; searchQuery: Ref<string>; librarySongs: Ref<Song[]>;
  addLibraryFolder: () => Promise<unknown>; scanLibrary: (options?: ScanLibraryOptions) => Promise<unknown>;
}

// 扫描阶段到界面文案的映射；未收录的 phase 统一回落到"准备导入"。
const SCAN_PHASE_TEXT: Record<string, string> = {
  collecting: '扫描文件',
  parsing: '解析信息',
  writing: '写入音乐库',
  complete: '导入完成',
  error: '导入失败',
};

export function useSongTableLibraryState(options: UseSongTableStateOptions) {
  const { currentViewMode, searchQuery, librarySongs, addLibraryFolder, scanLibrary } = options;

  const library = useLibraryStore();
  const storeRefs = storeToRefs(library);
  const libraryFolders = storeRefs.libraryFolders;
  const scanProgress = storeRefs.libraryScanProgress;
  const scanSession = storeRefs.libraryScanSession;

  const heroCardVisible = ref(false);
  let heroCardTimer: ReturnType<typeof setTimeout> | null = null;

  const stopHeroCardTimer = () => {
    if (heroCardTimer !== null) {
      clearTimeout(heroCardTimer);
      heroCardTimer = null;
    }
  };

  // 扫描成功且已满足最短展示时长后，延时收起 Hero 卡片并清理会话。
  const scheduleHeroCardHide = (startedAt: number | undefined) => {
    const elapsedMs = Date.now() - (startedAt ?? Date.now());
    const delayMs = Math.max(0, HERO_CARD_MIN_VISIBLE_MS - elapsedMs) + HERO_CARD_SUCCESS_DWELL_MS;
    heroCardTimer = setTimeout(() => {
      heroCardVisible.value = false;
      if (hasHeroSession.value) {
        library.setLibraryScanSession(null);
      }
      heroCardTimer = null;
    }, delayMs);
  };

  const inAllView = computed(() => currentViewMode.value === 'all');
  const inFolderView = computed(() => currentViewMode.value === 'folder');
  const hasActiveSearch = computed(() => searchQuery.value.trim().length > 0);
  const isLibraryEmpty = computed(() => librarySongs.value.length === 0);
  const isScanRunning = computed(() => {
    const progress = scanProgress.value;
    return !!progress && !progress.done && !progress.failed;
  });
  const hasHeroSession = computed(
    () => scanSession.value?.trigger === 'first-import' && scanSession.value?.visibility === 'hero',
  );
  const heroCardShouldShow = computed(() => inAllView.value && hasHeroSession.value);
  const isQuietBootstrapScan = computed(() =>
    inAllView.value
    && scanSession.value?.trigger === 'bootstrap'
    && scanSession.value?.visibility === 'silent'
    && isScanRunning.value,
  );
  // "安静曲库视图"：处于全部音乐页、无搜索词且列表为空。
  const isQuietLibraryView = computed(
    () => inAllView.value && !hasActiveSearch.value && isLibraryEmpty.value,
  );
  const folderViewEmpty = computed(() => inFolderView.value && !hasActiveSearch.value);
  const onboardingCardVisible = computed(() =>
    isQuietLibraryView.value && libraryFolders.value.length === 0 && !heroCardVisible.value,
  );
  const checkingCardVisible = computed(() =>
    isQuietLibraryView.value
    && isQuietBootstrapScan.value
    && !heroCardVisible.value
    && libraryFolders.value.length > 0,
  );
  const emptyResultCardVisible = computed(() =>
    isQuietLibraryView.value
    && !checkingCardVisible.value
    && !heroCardVisible.value
    && libraryFolders.value.length > 0,
  );
  const scanPercent = computed(() => {
    const progress = scanProgress.value;
    if (!progress) return 0;
    if (progress.total <= 0) return 12;
    const ratio = (progress.current / progress.total) * 100;
    return Math.min(100, Math.max(8, ratio));
  });
  const scanPhaseText = computed(() => {
    const phase = scanProgress.value?.phase;
    if (phase && phase in SCAN_PHASE_TEXT) {
      return SCAN_PHASE_TEXT[phase];
    }
    return '准备导入';
  });
  const scanFolderText = computed(() => {
    const progress = scanProgress.value;
    if (!progress || progress.folder_total <= 1) return '';
    return `文件夹 ${progress.folder_index}/${progress.folder_total}`;
  });
  const heroScanBadge = computed<HeroScanState>(() => {
    const progress = scanProgress.value;
    if (progress?.failed) return 'error';
    return progress?.done ? 'success' : 'scanning';
  });
  const emptyText = computed(() => {
    if (hasActiveSearch.value) {
      return '未找到匹配的歌曲';
    }
    if (folderViewEmpty.value) {
      return '该文件夹内暂无歌曲';
    }
    if (currentViewMode.value === 'playlist') {
      return '歌单暂无歌曲';
    }
    return '列表为空';
  });

  const retryScan = async () => {
    const retrySource = scanSession.value?.sourcePath;
    if (retrySource) {
      await scanLibrary({ trigger: 'first-import', visibility: 'hero', sourcePath: retrySource });
      return;
    }
    await addLibraryFolder();
  };

  watch(
    [hasHeroSession, heroCardShouldShow, () => scanProgress.value?.done, () => scanProgress.value?.failed],
    ([sessionActive, shouldShow, done, failed]) => {
      stopHeroCardTimer();

      if (!sessionActive) {
        heroCardVisible.value = false;
        return;
      }

      heroCardVisible.value = !!shouldShow;
      if (done && !failed) {
        scheduleHeroCardHide(scanSession.value?.startedAt);
      }
    },
    { immediate: true },
  );

  onUnmounted(stopHeroCardTimer);

  return {
    showHeroScanCard: heroCardVisible,
    hasSearchQuery: hasActiveSearch,
    showLibraryOnboarding: onboardingCardVisible,
    showFolderEmpty: folderViewEmpty,
    showLibraryChecking: checkingCardVisible,
    showLibraryEmptyResult: emptyResultCardVisible,
    libraryScanPercent: scanPercent,
    libraryScanPhaseLabel: scanPhaseText,
    libraryScanFolderLabel: scanFolderText,
    heroScanStatus: heroScanBadge,
    emptyStateMessage: emptyText,
    retryHeroLibraryScan: retryScan,
  };
}
