import { computed, ref } from 'vue';

import type { Song } from '../../types';
import { useToast } from '../../composables/toast';
import { reportDailyLikeSignals } from '../../services/domain/dailyRecommendFeedback';
import { useCollectionsStore } from './store';

// 「添加到歌单」弹窗是应用级单例：状态放在模块层，多个调用方共享同一份。

const dialogVisible = ref(false);
const pendingSongPaths = ref<string[]>([]);
const pendingSongs = ref<Song[]>([]);
const excludedPlaylistId = ref<string | null>(null);
let pendingAddedCallback: (() => void) | null = null;

/** 去空、去重，整理出待添加的路径列表。 */
const collectUniquePaths = (input: string | string[]): string[] => {
  const rawList = Array.isArray(input) ? input : [input];
  const unique: string[] = [];
  for (const path of rawList) {
    if (typeof path === 'string' && path.length > 0 && !unique.includes(path)) {
      unique.push(path);
    }
  }
  return unique;
};

export function useAddToPlaylistDialog() {
  const collectionsStore = useCollectionsStore();
  const { showToast } = useToast();

  const closeAddToPlaylistDialog = () => {
    dialogVisible.value = false;
    pendingSongPaths.value = [];
    pendingSongs.value = [];
    excludedPlaylistId.value = null;
    pendingAddedCallback = null;
  };

  /**
   * 打开弹窗；无可添加路径时直接拒绝（返回 false）。
   * songs 提供完整元数据用于上报，excludedPlaylistId 用于在列表中隐藏来源歌单。
   */
  const openAddToPlaylistDialog = (
    songPaths: string | string[],
    options: { onAdded?: () => void; songs?: Song[]; excludedPlaylistId?: string | null } = {},
  ) => {
    const nextPaths = collectUniquePaths(songPaths);
    if (nextPaths.length === 0) {
      return false;
    }

    pendingSongPaths.value = nextPaths;
    pendingSongs.value = options.songs ?? [];
    excludedPlaylistId.value = options.excludedPlaylistId ?? null;
    pendingAddedCallback = options.onAdded ?? null;
    dialogVisible.value = true;
    return true;
  };

  const addSelectedSongsToPlaylist = (playlistId: string) => {
    const addedCount = collectionsStore.addSongsToPlaylist(
      playlistId,
      pendingSongPaths.value,
      pendingSongs.value.length > 0 ? pendingSongs.value : undefined,
    );
    const addedCallback = pendingAddedCallback;
    const likeSignals =
      addedCount > 0
        ? pendingSongs.value.map(song => ({
            songName: song.title ?? '',
            singer: song.artist ?? '',
          }))
        : [];

    closeAddToPlaylistDialog();

    if (likeSignals.length > 0) {
      void reportDailyLikeSignals(likeSignals, 'playlist');
    }

    if (addedCallback) {
      addedCallback();
    }

    showToast(
      addedCount === 0 ? '歌单内歌曲重复' : '已加入歌单',
      addedCount === 0 ? 'info' : 'success',
    );
    return addedCount;
  };

  return {
    showAddToPlaylistModal: dialogVisible,
    playlistAddTargetSongs: pendingSongPaths,
    excludedPlaylistId,
    selectedCount: computed(() => pendingSongPaths.value.length),
    openAddToPlaylistDialog,
    closeAddToPlaylistDialog,
    addSelectedSongsToPlaylist,
  };
}
