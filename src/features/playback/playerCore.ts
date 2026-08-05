import { storeToRefs } from 'pinia';

import { useLyrics } from '../../composables/lyrics';
import { useToast } from '../../composables/toast';
import { createPlayerFileManager } from './playerFileManager';
import { createLibraryFolderImport } from '../library/libraryFolderImport';
import { createLibraryFolderTree } from '../library/libraryFolderTree';
import { createLibraryBatch } from '../library/libraryBatch';
import { createLibraryManager } from '../library/libraryManager';
import { createLibraryRuntime } from '../library/libraryRuntime';
import { createLibrarySortingActions } from '../library/librarySortingActions';
import { createLibraryDomain } from '../library/libraryDomain';
import { createHistoryCollectionsActions } from '../statistics/historyCollectionsActions';
import { createHistoryRestore } from '../statistics/historyRestore';
import { createStatisticsCleanup } from '../statistics/statisticsCleanup';
import { createPlayerLifecycle } from './playerLifecycle';
import { createPlayerPersistence } from './playerPersistence';
import { createPlayerPlayback } from './playerPlayback';
import { createPlayerPlaylist } from './playerPlaylist';
import { createPlayerQueue } from './playerQueue';
import { createPlayerRestore } from './playerRestore';
import { createPlayerUiShell } from './playerUiShell';
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
import { playerStorage } from '../../services/storage/playerStorage';
import { playbackApi } from '../../services/tauri/playbackApi';
import { useCollectionsStore } from '../collections/store';
import { useLibraryStore } from '../library/store';
import { useNavigationStore } from '../../shared/stores/navigation';
import { usePlaybackStore } from './store';
import { useUiStore } from '../../shared/stores/ui';
import type { FolderNode, Song } from '../../types';
import { useSongDetailCache } from '../../composables/useSongDetailCache';
import {
  cleanupRemovedLibrarySongPaths,
  collectSongPathsInFolderScope,
  isPathInFolderScope,
  syncRemovedLibrarySongPreferences,
} from '../library/libraryRemovalCleanup';

interface LibraryRefreshSummary {
  removedCount: number;
  removedPaths: string[];
}

const PLAYER_PLAYLIST_PATHS_KEY = 'player_playlist_paths';
const PLAYER_QUEUE_PATHS_KEY = 'player_queue_paths';
const PLAYER_LAST_SONG_PATH_KEY = 'player_last_song_path';
const LEGACY_PLAYER_PLAYLIST_KEY = 'player_playlist';
const LEGACY_PLAYER_QUEUE_KEY = 'player_queue';
const LEGACY_PLAYER_HISTORY_KEY = 'player_history';
const LEGACY_PLAYER_LAST_SONG_KEY = 'player_last_song';

const readStoredStringArray = (key: string): string[] | null => playerStorage.readStringArray(key);
const readStoredSongArray = (key: string): Song[] => playerStorage.readSongArray(key);
const readStoredSong = (key: string): Song | null => playerStorage.readSong(key);

const dedupePaths = (paths: string[]) =>
  Array.from(new Set(paths.map(path => path.trim()).filter(Boolean)));

const dedupeSongs = (songs: Song[]) => {
  const seen = new Set<string>();

  return songs.filter(song => {
    if (seen.has(song.path)) {
      return false;
    }

    seen.add(song.path);
    return true;
  });
};

const createSongLookup = (fallbackSongs: Song[] = []) => {
  const libraryStore = useLibraryStore();
  const playbackStore = usePlaybackStore();
  const lookup = new Map<string, Song>();

  for (const song of fallbackSongs) {
    if (song?.path && !lookup.has(song.path)) {
      lookup.set(song.path, song);
    }
  }

  const activeSongs = [
    ...(playbackStore.playQueue || []),
    ...(playbackStore.tempQueue || []),
    ...(playbackStore.currentSong ? [playbackStore.currentSong] : []),
  ];
  for (const song of activeSongs) {
    if (song?.path && !lookup.has(song.path)) {
      lookup.set(song.path, song);
    }
  }

  libraryStore.canonicalSongs.forEach((song) => {
    lookup.set(song.path, song);
  });

  return lookup;
};

const resolveSongsFromPaths = (paths: string[], fallbackSongs: Song[] = []) => {
  const libraryStore = useLibraryStore();
  return libraryStore.resolveSongsByPaths(paths, fallbackSongs);
};

const formatTimeAgo = (timestamp: number) => {
  const now = Date.now();
  const diff = now - timestamp;
  const oneHour = 60 * 60 * 1000;

  if (diff < oneHour) {
    return `${Math.max(1, Math.floor(diff / 60000))}m ago`;
  }

  if (diff < 24 * oneHour) {
    return `${Math.floor(diff / oneHour)}h ago`;
  }

  return `${Math.floor(diff / (24 * oneHour))}d ago`;
};

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

  const addLibraryFolder = async (): Promise<void> => {
    await librarySync.addLibraryFolder();
  };
  const addLibraryFolderPath = async (path: string): Promise<void> => {
    await librarySync.addLibraryFolderPath(path);
  };
  const removeLibraryFolderPath = async (path: string): Promise<void> => {
    await librarySync.removeLibraryFolderPath(path);
  };
  const collectRemovedLibraryFolderSongPaths = (path: string) => {
    const candidates = [
      ...libraryStore.canonicalSongs,
      ...libraryStore.sourceSongs,
      ...playbackStore.playQueue,
      ...playbackStore.tempQueue,
      ...(playbackStore.currentSong ? [playbackStore.currentSong] : []),
    ];

    return collectSongPathsInFolderScope(candidates, path);
  };

  const removeLibraryFolderLinked = async (
    path: string,
    options: { showToast?: boolean } = {},
  ): Promise<void> => {
    const removedPaths = collectRemovedLibraryFolderSongPaths(path);
    const activeSongPath = currentSongPath.value ?? currentSong.value?.path ?? null;

    if (activeSongPath && isPathInFolderScope(path, activeSongPath)) {
      if (!removedPaths.some(songPath => songPath === activeSongPath)) {
        removedPaths.push(activeSongPath);
      }
      await stopPlaybackForMissingSong();
    }

    await librarySync.removeLibraryFolderLinked(path, options);
    await cleanupRemovedLibrarySongPaths({
      removedPaths,
      removedFolderPath: path,
      stopPlayback: stopPlaybackForMissingSong,
      removeFromHistory: songPaths => collectionsActions.removeFromHistory(songPaths),
      removeSongStatistics: songPaths => statisticsCleanup.removeSongsFromHistoryAndStatistics(songPaths),
      clearCaches: () => {
        clearCoverCaches();
        clearSongDetailCache();
      },
    });
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
    addToHistory,
    loadLyrics,
    handleAutoNext: playbackActions.handleAutoNext,
    onBeforePlay: (song, options) => {
      playerQueue.handleBeforePlay(song, options);
    },
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
    addFolder,
    addFoldersFromStructure,
    getSongsInFolder,
    clearLocalMusic,
  });

  const windowActions = useWindowActions({
    playerUiShell,
  });

  async function deleteFolder(path: string) {
    return playerFileManager.deleteFolder(path);
  }

  async function moveFilePhysical(sourcePath: string, targetFolderPath: string) {
    return playerFileManager.moveFilePhysical(sourcePath, targetFolderPath);
  }

  async function scanLibrary(options: ScanLibraryOptions = {}) {
    return libraryRuntime.scanLibrary(options);
  }

  async function fetchFolderTree() {
    return libraryFolderTree.fetchFolderTree();
  }

  async function ensureFolderChildrenLoaded(target: string | FolderNode) {
    return libraryFolderTree.ensureFolderChildrenLoaded(target);
  }

  async function createFolder(parentPath: string, folderName: string) {
    return libraryFolderTree.createFolder(parentPath, folderName);
  }

  async function toggleFolderNode(target: string | FolderNode) {
    return libraryFolderTree.toggleFolderNode(target);
  }

  async function addFoldersFromStructure() {
    return libraryFolderImport.addFoldersFromStructure();
  }

  function getSongsInFolder(folderPath: string) {
    return libraryFolderImport.getSongsInFolder(folderPath);
  }

  async function moveFilesToFolder(paths: string[], targetFolder: string) {
    return playerFileManager.moveFilesToFolder(paths, targetFolder);
  }

  async function refreshFolder(folderPath: string) {
    return playerFileManager.refreshFolder(folderPath);
  }

  function removeFolder(folderPath: string) {
    playerFileManager.removeFolder(folderPath);
  }

  async function addToHistory(song: Song) {
    return collectionsActions.addToHistory(song);
  }

  function clearLocalMusic() {
    libraryFolderImport.clearLocalMusic();
  }

  async function addFolder() {
    return libraryFolderImport.addFolder();
  }

  function generateOrganizedPath(song: Song): string {
    return playerFileManager.generateOrganizedPath(song);
  }

  async function moveFile(song: Song, newPath: string) {
    return playerFileManager.moveFile(song, newPath);
  }

  async function openInFinder(path: string) {
    return playerFileManager.openInFinder(path);
  }

  async function deleteFromDisk(song: Song) {
    return playerFileManager.deleteFromDisk(song);
  }

  const stopPlaybackForMissingSong = async () => {
    await playbackApi.stopAudio().catch(async () => {
      await playbackApi.pauseAudio().catch(() => {});
    });
    playerPlayback.stopPlaybackRuntime();
    isPlaying.value = false;
    isSongLoaded.value = false;
    currentSong.value = null;
    currentSongPath.value = null;
    currentTime.value = 0;
    currentCover.value = '';
    currentCoverFull.value = '';
  };

  const refreshLibraryAndCollectSummary = async (
    options: ScanLibraryOptions = { trigger: 'manual-rescan', visibility: 'inline' },
  ): Promise<LibraryRefreshSummary> => {
    const previousPaths = [...libraryStore.canonicalSongPaths];
    const previousPathSet = new Set(previousPaths);
    const activeSongPath = currentSongPath.value;

    await libraryRuntime.scanLibrary(options);

    const currentPathSet = new Set(libraryStore.canonicalSongPaths);
    const removedPaths = previousPaths.filter(path => !currentPathSet.has(path));

    if (removedPaths.length > 0) {
      syncRemovedLibrarySongPreferences(removedPaths);
      await collectionsActions.removeFromHistory(removedPaths);
      refreshStateSongReferences();
    }

    if (activeSongPath && previousPathSet.has(activeSongPath) && !currentPathSet.has(activeSongPath)) {
      await stopPlaybackForMissingSong();
      showToast('当前歌曲已不存在', 'info');
    }

    return {
      removedCount: removedPaths.length,
      removedPaths,
    };
  };

  async function playSong(song: Song, options: PlaySongOptions = {}) {
    return playerPlayback.playSong(song, options);
  }

  async function togglePlay() {
    return playerPlayback.togglePlay();
  }

  function nextSong() {
    playerQueue.nextSong();
  }

  function prevSong() {
    playerQueue.prevSong();
  }

  function init() {
    playerLifecycle.init();
  }

  async function refreshAllFolders() {
    return refreshLibraryAndCollectSummary({
      trigger: 'manual-rescan',
      visibility: 'inline',
    });
  }

  const state = {
    ...collectionsRefs,
    ...libraryRefs,
    ...navigationRefs,
    ...playbackRefs,
    ...uiRefs,
  };

  const views = {
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
    displaySongList: currentViewSongs,
    isLocalMusic,
    isFolderMode,
  };

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

  const lifecycle = {
    init,
    formatTimeAgo,
  };

  const appShellDomain = {
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
  };

  const legacyApi = {
    ...state,
    ...views,
    ...lifecycle,
    ...libraryDomain,
    ...collectionsActions,
    ...playbackDomain,
    ...windowActions,
    ...sortingDomain,
  };

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
