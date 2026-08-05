import { storeToRefs } from 'pinia';

import { useLyrics } from '../../composables/lyrics';
import { useToast } from '../../composables/toast';
import { createPlayerFileManager } from './playerFileManager';
import { createLibraryFolderImport } from '../library/libraryFolderImport';
import { createLibraryFolderTree } from '../library/libraryFolderTree';
import { createLibraryBatch } from '../library/libraryBatch';
import { createLibraryCoreActions } from '../library/libraryCoreActions';
import { dedupePaths, dedupeSongs } from '../library/libraryDeduplication';
import { createLibraryManager } from '../library/libraryManager';
import { createLibraryRuntime } from '../library/libraryRuntime';
import { createLibrarySortingActions } from '../library/librarySortingActions';
import { createLibraryDomain } from '../library/libraryDomain';
import { createLibraryFolderRemoval } from '../library/libraryFolderRemoval';
import { createLibraryRefreshSummary } from '../library/libraryRefreshSummary';
import { createHistoryCollectionsActions } from '../statistics/historyCollectionsActions';
import { createHistoryRestore } from '../statistics/historyRestore';
import { formatTimeAgo } from '../statistics/historyTimeFormat';
import { createStatisticsCleanup } from '../statistics/statisticsCleanup';
import { createMissingSongPlayback } from './missingSongPlayback';
import { createPlaybackCoreActions } from './playbackCoreActions';
import { createPlayerLifecycle } from './playerLifecycle';
import { createPlayerPersistence } from './playerPersistence';
import { createPlayerPlayback } from './playerPlayback';
import { createPlayerPlaylist } from './playerPlaylist';
import { createPlayerQueue } from './playerQueue';
import { createPlayerRestore } from './playerRestore';
import { createPlayerUiShell } from './playerUiShell';
import {
  createAppShellDomain,
  createLegacyPlayerApi,
  createLifecycleDomain,
  createPlayerCoreState,
  createPlayerCoreViews,
} from './playerCoreShape';
import { createPlaybackDomain } from './playbackDomain';
import type { PlaySongOptions } from './playbackDomain';
import { finalizeLibraryScanProgress } from '../library/libraryScan';
import type { ScanLibraryOptions } from '../library/libraryScan';
import { useCoverCache } from '../../composables/useCoverCache';
import { useFileImport } from '../../composables/useFileImport';
import { useLibrarySync } from '../library/useLibrarySync';
import { usePlaybackActions } from './usePlaybackActions';
import { usePlayerLibraryView } from '../library/usePlayerLibraryView';
import { useWindowActions } from '../../composables/useWindowActions';
import { useCollectionsStore } from '../collections/store';
import { useLibraryStore } from '../library/store';
import { useNavigationStore } from '../../shared/stores/navigation';
import { usePlaybackStore } from './store';
import { useUiStore } from '../../shared/stores/ui';
import type { FolderNode, Song } from '../../types';
import { useSongDetailCache } from '../../composables/useSongDetailCache';
import {
  LEGACY_PLAYER_HISTORY_KEY,
  LEGACY_PLAYER_LAST_SONG_KEY,
  LEGACY_PLAYER_PLAYLIST_KEY,
  LEGACY_PLAYER_QUEUE_KEY,
  PLAYER_LAST_SONG_PATH_KEY,
  PLAYER_PLAYLIST_PATHS_KEY,
  PLAYER_QUEUE_PATHS_KEY,
  readStoredSong,
  readStoredSongArray,
  readStoredStringArray,
} from './playerRestoreStorage';
import {
  createSongLookup,
  resolveSongsFromPaths,
} from './playerSongResolver';

function createPlayerCore() {
  const { loadLyrics } = useLyrics();
  const { showToast } = useToast();
  const { clearCoverCaches } = useCoverCache();
  const { clearSongDetailCache } = useSongDetailCache();

  const collectionsStore = useCollectionsStore();
  const libraryStore = useLibraryStore();
  const navigationStore = useNavigationStore();
  const playbackStore = usePlaybackStore();
  const uiStore = useUiStore();

  const collectionsRefs = storeToRefs(collectionsStore);
  const libraryRefs = storeToRefs(libraryStore);
  const navigationRefs = storeToRefs(navigationStore);
  const playbackRefs = storeToRefs(playbackStore);
  const uiRefs = storeToRefs(uiStore);

  const {
    currentSong,
    currentSongPath,
    playMode,
    isPlaying,
    isSongLoaded,
    currentCover,
    currentCoverFull,
    currentTime,
  } = playbackRefs;

  const libraryView = usePlayerLibraryView();
  const {
    artistList,
    albumList,
    filteredArtistList,
    filteredAlbumList,
    folderList,
    favoriteSongList,
    favArtistList,
    favAlbumList,
    recentAlbumList,
    recentPlaylistList,
    currentViewSongs,
    isLocalMusic,
    isFolderMode,
  } = libraryView;

  const {
    applyLibraryScanBatch,
    flushBufferedLibraryScanBatch,
    refreshStateSongReferences,
    dispose: disposeLibraryBatch,
  } = createLibraryBatch({
    createSongLookup,
  });

  let librarySync: ReturnType<typeof useLibrarySync>;
  let playerQueue: ReturnType<typeof createPlayerQueue>;
  let playerPlayback: ReturnType<typeof createPlayerPlayback>;
  let libraryRuntime: ReturnType<typeof createLibraryRuntime>;
  let libraryCoreActions: ReturnType<typeof createLibraryCoreActions>;
  let playbackCoreActions: ReturnType<typeof createPlaybackCoreActions>;

  const addLibraryFolder = async (): Promise<void> => {
    await librarySync.addLibraryFolder();
  };
  const addLibraryFolderPath = async (path: string): Promise<void> => {
    await librarySync.addLibraryFolderPath(path);
  };
  const removeLibraryFolderPath = async (path: string): Promise<void> => {
    await librarySync.removeLibraryFolderPath(path);
  };

  const resetShuffleState = () => playerQueue.resetShuffleState();

  const playerPlaylist = createPlayerPlaylist();

  const historyRestore = createHistoryRestore({
    legacyHistoryKey: LEGACY_PLAYER_HISTORY_KEY,
  });
  const statisticsCleanup = createStatisticsCleanup();
  const sortingActions = createLibrarySortingActions();

  const collectionsActions = createHistoryCollectionsActions({
    playerPlaylist,
  });

  const {
    stopPlaybackForMissingSong,
  } = createMissingSongPlayback({
    currentSong,
    currentSongPath,
    isPlaying,
    isSongLoaded,
    currentCover,
    currentCoverFull,
    currentTime,
    getPlayerPlayback: () => playerPlayback,
  });

  const {
    removeLibraryFolderLinkedWithCleanup: removeLibraryFolderLinked,
  } = createLibraryFolderRemoval({
    getCandidateSongs: () => [
      ...libraryStore.canonicalSongs,
      ...libraryStore.sourceSongs,
      ...playbackStore.playQueue,
      ...playbackStore.tempQueue,
      ...(playbackStore.currentSong ? [playbackStore.currentSong] : []),
    ],
    getActiveSongPath: () => currentSongPath.value ?? currentSong.value?.path ?? null,
    removeLibraryFolderLinked: (path, options) => librarySync.removeLibraryFolderLinked(path, options),
    stopPlayback: stopPlaybackForMissingSong,
    removeFromHistory: songPaths => collectionsActions.removeFromHistory(songPaths),
    removeSongStatistics: songPaths => statisticsCleanup.removeSongsFromHistoryAndStatistics(songPaths),
    clearCaches: () => {
      clearCoverCaches();
      clearSongDetailCache();
    },
  });

  const playerFileManager = createPlayerFileManager({
    removeLibraryFolderLinked,
    removeFromHistory: (songPaths: string[]) => collectionsActions.removeFromHistory(songPaths),
    showToast,
  });

  const {
    fetchLibraryFolders,
    addLibraryFolderRecord,
    removeLibraryFolderRecord,
    linkLibraryFolder,
    unlinkLibraryFolder,
    processExternalPaths,
  } = createLibraryManager({
    fetchFolderTree,
    scanLibrary,
    playSong,
    dedupePaths,
    dedupeSongs,
    resetShuffleState,
  });

  const libraryFolderTree = createLibraryFolderTree({
    addLibraryFolderPath,
    removeLibraryFolderPath,
    showToast,
  });

  const libraryFolderImport = createLibraryFolderImport({
    showToast,
  });

  const playerUiShell = createPlayerUiShell({
    addFolder: () => addLibraryFolder(),
    removeFromHistory: (songPaths: string[]) => collectionsActions.removeFromHistory(songPaths),
  });

  const playbackActions = usePlaybackActions({
    currentSong,
    playMode,
    getPlayerPlayback: () => playerPlayback,
    getPlayerQueue: () => playerQueue,
    playerUiShell,
  });

  libraryRuntime = createLibraryRuntime({
    fetchLibraryFolders,
    fetchFolderTree,
    flushBufferedLibraryScanBatch,
    refreshStateSongReferences,
    finalizeLibraryScanProgress,
    onSilentScanError: () => {
      showToast('Background library scan failed. Please retry in library settings.', 'error');
    },
  });

  const {
    refreshLibraryAndCollectSummary,
  } = createLibraryRefreshSummary({
    getCanonicalSongPaths: () => libraryStore.canonicalSongPaths,
    currentSongPath,
    scanLibrary: options => libraryRuntime.scanLibrary(options),
    removeFromHistory: songPaths => collectionsActions.removeFromHistory(songPaths),
    refreshStateSongReferences,
    stopPlayback: stopPlaybackForMissingSong,
    showToast,
  });

  libraryCoreActions = createLibraryCoreActions({
    playerFileManager,
    libraryFolderTree,
    libraryFolderImport,
    libraryRuntime,
    addToHistory: song => collectionsActions.addToHistory(song),
    refreshLibraryAndCollectSummary,
  });

  const {
    restorePathBackedState,
  } = createPlayerRestore({
    keys: {
      playerPlaylistPaths: PLAYER_PLAYLIST_PATHS_KEY,
      playerQueuePaths: PLAYER_QUEUE_PATHS_KEY,
      playerLastSongPath: PLAYER_LAST_SONG_PATH_KEY,
      legacyPlayerPlaylist: LEGACY_PLAYER_PLAYLIST_KEY,
      legacyPlayerQueue: LEGACY_PLAYER_QUEUE_KEY,
      legacyPlayerLastSong: LEGACY_PLAYER_LAST_SONG_KEY,
    },
    createSongLookup,
    resolveSongsFromPaths,
    readStoredSongArray,
    readStoredSong,
    readStoredStringArray,
    loadLibrarySongsFromCache: () => libraryRuntime.loadLibrarySongsFromCache(),
  });

  const {
    flushPersistedState,
    schedulePersistedState,
    dispose: disposePlayerPersistence,
  } = createPlayerPersistence({
    keys: {
      playerPlaylistPaths: PLAYER_PLAYLIST_PATHS_KEY,
      playerQueuePaths: PLAYER_QUEUE_PATHS_KEY,
      legacyPlayerPlaylist: LEGACY_PLAYER_PLAYLIST_KEY,
      legacyPlayerQueue: LEGACY_PLAYER_QUEUE_KEY,
    },
  });

  const playerLifecycle = createPlayerLifecycle({
    bootstrapLibrary: () => libraryRuntime.bootstrapLibrary(),
    togglePlay,
    nextSong,
    prevSong,
    applyLibraryScanBatch,
    flushBufferedLibraryScanBatch,
    handleSeekCompleted: payload => playerPlayback.handleSeekCompleted(payload),
    schedulePersistedState,
    flushPersistedState,
    restorePathBackedState,
    restoreRecentHistory: () => historyRestore.restoreRecentHistory(),
    refreshStateSongReferences,
    loadLyrics,
    disposePlayerPlayback: () => playerPlayback.dispose(),
    disposeLibraryRuntime: () => libraryRuntime.dispose(),
    disposePlayerPersistence,
    disposeLibraryBatch,
    lastSongPathKey: PLAYER_LAST_SONG_PATH_KEY,
    legacyLastSongKey: LEGACY_PLAYER_LAST_SONG_KEY,
  });

  playerQueue = createPlayerQueue({
    playSong: (song, options) => playerPlayback.playSong(song, options),
    stopPlaybackRuntime: () => playerPlayback.stopPlaybackRuntime(),
    showToast,
  });

  playerPlayback = createPlayerPlayback({
    getDisplaySongList: () => currentViewSongs.value,
    addToHistory: song => collectionsActions.addToHistory(song),
    loadLyrics,
    handleAutoNext: playbackActions.handleAutoNext,
    onBeforePlay: (song, options) => {
      playerQueue.handleBeforePlay(song, options);
    },
  });

  playbackCoreActions = createPlaybackCoreActions({
    getPlayerPlayback: () => playerPlayback,
    getPlayerQueue: () => playerQueue,
  });

  librarySync = useLibrarySync({
    fetchLibraryFolders,
    scanLibrary,
    refreshFolder,
    refreshAllFolders,
    linkLibraryFolder,
    unlinkLibraryFolder,
    processExternalPaths,
    addLibraryFolderRecord,
    removeLibraryFolderRecord,
  });

  const fileImportActions = useFileImport({
    addFolder: () => libraryCoreActions.addFolder(),
    addFoldersFromStructure: () => libraryCoreActions.addFoldersFromStructure(),
    getSongsInFolder: folderPath => libraryCoreActions.getSongsInFolder(folderPath),
    clearLocalMusic: () => libraryCoreActions.clearLocalMusic(),
  });

  const windowActions = useWindowActions({
    playerUiShell,
  });

  function deleteFolder(path: string) {
    return libraryCoreActions.deleteFolder(path);
  }

  function moveFilePhysical(sourcePath: string, targetFolderPath: string) {
    return libraryCoreActions.moveFilePhysical(sourcePath, targetFolderPath);
  }

  function scanLibrary(options: ScanLibraryOptions = {}) {
    return libraryCoreActions.scanLibrary(options);
  }

  function fetchFolderTree() {
    return libraryCoreActions.fetchFolderTree();
  }

  function ensureFolderChildrenLoaded(target: string | FolderNode) {
    return libraryCoreActions.ensureFolderChildrenLoaded(target);
  }

  function createFolder(parentPath: string, folderName: string) {
    return libraryCoreActions.createFolder(parentPath, folderName);
  }

  function toggleFolderNode(target: string | FolderNode) {
    return libraryCoreActions.toggleFolderNode(target);
  }

  function moveFilesToFolder(paths: string[], targetFolder: string) {
    return libraryCoreActions.moveFilesToFolder(paths, targetFolder);
  }

  function refreshFolder(folderPath: string) {
    return libraryCoreActions.refreshFolder(folderPath);
  }

  function removeFolder(folderPath: string) {
    return libraryCoreActions.removeFolder(folderPath);
  }

  function generateOrganizedPath(song: Song): string {
    return libraryCoreActions.generateOrganizedPath(song);
  }

  function moveFile(song: Song, newPath: string) {
    return libraryCoreActions.moveFile(song, newPath);
  }

  function openInFinder(path: string) {
    return libraryCoreActions.openInFinder(path);
  }

  function deleteFromDisk(song: Song) {
    return libraryCoreActions.deleteFromDisk(song);
  }

  function playSong(song: Song, options: PlaySongOptions = {}) {
    return playbackCoreActions.playSong(song, options);
  }

  function togglePlay() {
    return playbackCoreActions.togglePlay();
  }

  function nextSong() {
    return playbackCoreActions.nextSong();
  }

  function prevSong() {
    return playbackCoreActions.prevSong();
  }

  function init() {
    playerLifecycle.init();
  }

  function refreshAllFolders() {
    return libraryCoreActions.refreshAllFolders();
  }

  const state = createPlayerCoreState(
    collectionsRefs,
    libraryRefs,
    navigationRefs,
    playbackRefs,
    uiRefs,
  );

  const views = createPlayerCoreViews({
    artistList,
    albumList,
    filteredArtistList,
    filteredAlbumList,
    folderList,
    favoriteSongList,
    favArtistList,
    favAlbumList,
    recentAlbumList,
    recentPlaylistList,
    currentViewSongs,
    isLocalMusic,
    isFolderMode,
  });

  const playbackDomain = createPlaybackDomain({
    playSong,
    togglePlay,
    nextSong,
    prevSong,
    playbackActions,
  });

  const libraryDomain = createLibraryDomain({
    librarySync,
    fileImportActions,
    removeFolder,
    moveFile,
    generateOrganizedPath,
    openInFinder,
    deleteFromDisk,
    moveFilesToFolder,
    deleteFolder,
    moveFilePhysical,
    fetchFolderTree,
    ensureFolderChildrenLoaded,
    createFolder,
    toggleFolderNode,
    libraryFolderTree,
    libraryRuntime,
  });

  const sortingDomain = sortingActions;

  const lifecycle = createLifecycleDomain(init, formatTimeAgo);

  const appShellDomain = createAppShellDomain({
    init,
    playQueue: playbackRefs.playQueue,
    isMiniMode: uiRefs.isMiniMode,
    showPlayerDetail: uiRefs.showPlayerDetail,
    showMiniPlaylist: uiRefs.showMiniPlaylist,
    showPlaylist: uiRefs.showPlaylist,
    closeMiniPlaylist: playbackDomain.closeMiniPlaylist,
    showVolumePopover: uiRefs.showVolumePopover,
    handleExternalPaths: libraryDomain.handleExternalPaths,
    libraryScanProgress: libraryRefs.libraryScanProgress,
  });

  const legacyApi = createLegacyPlayerApi(
    state,
    views,
    lifecycle,
    libraryDomain,
    collectionsActions,
    playbackDomain,
    windowActions,
    sortingDomain,
  );

  return {
    state,
    views,
    lifecycle,
    appShellDomain,
    libraryDomain,
    collectionsDomain: collectionsActions,
    playbackDomain,
    windowDomain: windowActions,
    sortingDomain,
    legacyApi,
  };
}

let playerCore: ReturnType<typeof createPlayerCore> | null = null;

export function usePlayerCore() {
  if (!playerCore) {
    playerCore = createPlayerCore();
  }

  return playerCore;
}
