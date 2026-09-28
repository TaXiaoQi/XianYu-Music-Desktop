import type { Song } from '../types';
import { launchFlyingCover } from './useFlyingCover';
import {
  REFRESH_FAILURE_PREFIX,
  REFRESH_OK_TEXT,
  describeLibraryRefresh,
  resolveFailureDetail,
} from './libraryRefreshFeedback';
import type { HomePageModelSources } from './homePageModelSources';
import type { useScopedBatchSelection } from './useScopedBatchSelection';
import type { useSongContextActions } from './useSongContextActions';

type SelectionState = Pick<
  ReturnType<typeof useScopedBatchSelection>,
  'isBatchMode' | 'selectedPaths'
>;

type SongContextState = Pick<ReturnType<typeof useSongContextActions>, 'contextMenuTargetSong'>;

/** 搜索结果播放时需要“插入到当前歌曲之后”的视图集合 */
const INSERT_AFTER_CURRENT_VIEWS = new Set(['all', 'artist', 'album', 'folder']);

const EMPTY_FOLDER_PLAYLIST_TOAST = '该文件夹下没有可用于创建歌单的歌曲';
const FOLDER_PLAYLIST_CREATED_TOAST = '已根据文件夹创建歌单';

export const shouldInsertAfterCurrentSong = (searchTerm: string, viewMode: string): boolean =>
  searchTerm.trim().length > 0 && INSERT_AFTER_CURRENT_VIEWS.has(viewMode);

/**
 * 首页页模型的播放与批量操作动作集。
 * 依赖统一来自 sources 聚合对象，选择态与右键菜单态由调用方注入。
 */
export function createHomePagePlaybackActions(
  sources: HomePageModelSources,
  selection: SelectionState,
  songContext: SongContextState,
) {
  const { isBatchMode, selectedPaths } = selection;
  const { contextMenuTargetSong } = songContext;
  const { showToast } = sources.toasts;
  const { openAddToPlaylistDialog } = sources.addToPlaylistDialog;
  const { playSong } = sources.playback;
  const { openHomeAlbum } = sources.navigation;
  const { coverCache } = sources.covers;
  const { refreshAllFolders, getSongsInFolder } = sources.runtime;
  const { createPlaylist, favoritePaths, toggleFavorite } = sources.collections;
  const { currentViewMode, filterCondition } = sources.viewState;
  const { displaySongList, currentViewSongPaths, searchQuery, resolveSongByPath } =
    sources.libraryView;

  /** 播放首曲前先送出封面飞行动画 */
  const startWithFlyingCover = (leadSong: Song) => {
    void launchFlyingCover(leadSong.path, coverCache.get(leadSong.path) ?? '');
    void playSong(leadSong);
  };

  const handlePlayAll = () => {
    const [leadSong] = displaySongList.value;
    if (leadSong) {
      startWithFlyingCover(leadSong);
    }
  };

  const handlePlaySong = (song: Song) => {
    const insertAfterCurrent = shouldInsertAfterCurrentSong(searchQuery.value, currentViewMode.value);
    void playSong(song, insertAfterCurrent ? { insertAfterCurrent: true } : undefined);
  };

  const handleBatchPlay = () => {
    const [leadSong] = displaySongList.value.filter((song) => selectedPaths.value.has(song.path));
    if (leadSong) {
      startWithFlyingCover(leadSong);
    }
  };

  /** 收集待加入歌单的目标路径：批量模式取所选，否则取右键目标 */
  const collectTargetSongPaths = () => {
    if (isBatchMode.value) {
      return Array.from(selectedPaths.value);
    }
    return contextMenuTargetSong.value ? [contextMenuTargetSong.value.path] : [];
  };

  const handleAddToPlaylistRequest = () => {
    const targetPaths = collectTargetSongPaths();
    const targetSongs = targetPaths
      .map((path) => resolveSongByPath(path))
      .filter((song): song is Song => Boolean(song));

    openAddToPlaylistDialog(targetPaths, {
      songs: targetSongs,
      excludedPlaylistId: currentViewMode.value === 'playlist' ? filterCondition.value : null,
      onAdded: () => {
        isBatchMode.value = false;
      },
    });
  };

  const handleSelectAll = () => {
    const viewPaths = currentViewSongPaths.value;
    const everythingPicked = viewPaths.length > 0 && selectedPaths.value.size === viewPaths.length;
    selectedPaths.value = new Set(everythingPicked ? [] : viewPaths);
  };

  const handleBatchAddToFavorites = () => {
    const pickedPaths = Array.from(selectedPaths.value);
    if (pickedPaths.length === 0) {
      return;
    }

    const alreadyFavorite = new Set(favoritePaths.value);
    const freshPaths = pickedPaths.filter((path) => !alreadyFavorite.has(path));

    for (const path of freshPaths) {
      toggleFavorite(resolveSongByPath(path) ?? path);
    }

    showToast(
      freshPaths.length > 0
        ? `已添加 ${freshPaths.length} 首歌曲到我喜欢`
        : '所选歌曲已在我喜欢中',
      'success',
    );
    isBatchMode.value = false;
  };

  const handleRefreshAll = async () => {
    try {
      showToast(describeLibraryRefresh(await refreshAllFolders()) ?? REFRESH_OK_TEXT, 'success');
    } catch (error: unknown) {
      showToast(`${REFRESH_FAILURE_PREFIX}${resolveFailureDetail(error)}`, 'error');
    }
  };

  const handleRootCreatePlaylistRequest = (folderPath: string, folderName: string) => {
    const folderSongs = getSongsInFolder(folderPath);
    if (folderSongs.length === 0) {
      showToast(EMPTY_FOLDER_PLAYLIST_TOAST, 'info');
      return;
    }

    createPlaylist(folderName, folderSongs.map((song) => song.path));
    showToast(FOLDER_PLAYLIST_CREATED_TOAST, 'success');
  };

  const handleArtistAlbumClick = (albumKey: string) =>
    void openHomeAlbum(albumKey);

  return {
    handlePlayAll,
    handleBatchPlay,
    playSong: handlePlaySong,
    handleAddToPlaylistRequest,
    handleSelectAll,
    handleBatchAddToFavorites,
    handleRefreshAll,
    handleRootCreatePlaylistRequest,
    handleArtistAlbumClick,
  };
}
