import { ref, watch, type Ref } from 'vue';

import { usePlaybackStore } from '../../../features/playback/store';
import { useSettingsStore } from '../../../features/settings/store';
import {
  createShareUrl,
  getCachedShareUrl,
  preloadShareUrl,
  reportShareAction,
} from '../../../services/domain/shareService';
import type { Song } from '../../../types';

interface FooterShareDeps {
  currentSong: Ref<Song | null>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  /** 分享入口展开时收起底栏工具弹层。 */
  closeFooterTools: () => void;
}

/**
 * 底栏分享与投屏弹窗：分享链接生成/复制、缓存与预加载。
 */
export const useFooterShare = ({
  currentSong,
  showToast,
  closeFooterTools,
}: FooterShareDeps) => {
  const playbackStore = usePlaybackStore();
  const settingsStore = useSettingsStore();
  const isShareLoading = ref(false);

  const showDlnaCastDialog = ref(false);
  const openDlnaCastDialog = () => {
    showDlnaCastDialog.value = true;
  };

  const showShareDialog = ref(false);
  const openShareDialog = () => {
    closeFooterTools();
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
    closeFooterTools();
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

  return {
    showShareDialog,
    openShareDialog,
    showDlnaCastDialog,
    openDlnaCastDialog,
    handleShareCopy,
    handleShareCast,
  };
};
