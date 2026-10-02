import { ref, shallowRef } from 'vue';
import { defineStore } from 'pinia'; // 实现

import { createLibrarySongVault } from './songVault';
import type { // 实现
  AlbumSortMode, // 实现
  AlbumDetailSortMode, // 实现
  ArtistSortMode, // 实现
  FolderSortMode, // 实现
  LocalSortMode, // 实现
} from '../../services/storage/playerStorage'; // 实现
import type { // 实现
  AlbumCatalogItem, // 实现
  ArtistCatalogItem, // 实现
  FolderNode,
  LibraryFolder, // 实现
  LibrarySong, // 实现
  LibraryScanProgress, // 实现
  LibraryScanSession, // 实现
  Song,
} from '../../types'; // 实现

export const useLibraryStore = defineStore('library', () => { // 实现
  const vault = createLibrarySongVault();

  const folderListing = ref<LibraryFolder[]>([]);
  const hierarchyTree = ref<FolderNode[]>([]);
  const scanStatus = ref<LibraryScanProgress | null>(null);
  const scanJournal = ref<LibraryScanSession | null>(null);
  const scanFailure = ref<string | null>(null);
  const monitoredFolders = ref<string[]>([]);
  const artistViewOrder = ref<ArtistSortMode>('name');
  const albumViewOrder = ref<AlbumSortMode>('name');
  const albumEntryOrder = ref<AlbumDetailSortMode>('track_number');
  const artistPinnedOrder = ref<string[]>([]);
  const albumPinnedOrder = ref<string[]>([]);
  const folderViewOrder = ref<FolderSortMode>('title');
  const folderPinnedOrder = ref<Record<string, string[]>>({});
  const localViewOrder = ref<LocalSortMode>('title');
  const localPinnedOrder = ref<string[]>([]);

  const artistTabIndex = shallowRef<ArtistCatalogItem[]>([]);
  const albumTabIndex = shallowRef<AlbumCatalogItem[]>([]);

  const saveFolderListing = (items: LibraryFolder[]) => {
    folderListing.value = items;
  };

  const saveHierarchyTree = (tree: FolderNode[]) => {
    hierarchyTree.value = tree;
  };

  const saveArtistTabIndex = (items: ArtistCatalogItem[]) => {
    artistTabIndex.value = items;
  };

  const saveAlbumTabIndex = (items: AlbumCatalogItem[]) => {
    albumTabIndex.value = items;
  };

  const saveScanStatus = (progress: LibraryScanProgress | null) => {
    scanStatus.value = progress;
  };

  const saveScanJournal = (session: LibraryScanSession | null) => {
    scanJournal.value = session;
  };

  const saveScanFailure = (message: string | null) => {
    scanFailure.value = message;
  };

  const saveMonitoredFolders = (paths: string[]) => {
    monitoredFolders.value = paths;
  };

  const moveMonitoredFolder = (fromIndex: number, toIndex: number) => {
    const reordered = [...monitoredFolders.value];
    const [picked] = reordered.splice(fromIndex, 1);
    if (!picked) {
      return;
    }

    reordered.splice(toIndex, 0, picked);
    monitoredFolders.value = reordered;
  };

  const setSongRecord = (song: LibrarySong) => vault.recordEntry(song);

  const setExtraSong = (song: LibrarySong) => vault.pinEntry(song);

  const setExtraSongs = (songs: LibrarySong[]) => vault.pinEntries(songs);

  const setExtraSongsBatch = (songGroups: LibrarySong[][]) => vault.pinEntryGroups(songGroups);

  const patchSongMeta = (path: string, patch: Partial<LibrarySong>) => vault.amendEntry(path, patch);

  const removeExtraSong = (path: string | null | undefined) => vault.dropPinnedEntry(path);

  const getSongByPath = (path: string | null | undefined, fallback?: Song | null) =>
    vault.getEntry(path, fallback);

  const resolveSongsByPaths = (paths: string[], fallbackSongs: Song[] = []) =>
    vault.getEntries(paths, fallbackSongs);

  const setCanonicalSongs = (songs: LibrarySong[]) => vault.adoptCanonical(songs);

  const setSourceSongs = (songs: LibrarySong[]) => vault.adoptSource(songs);

  const patchLibrarySongs = (payload: { songs: LibrarySong[]; deleted_paths: string[] }) =>
    vault.applyDelta(payload);

  const setCanonicalSongOrder = (paths: string[]) => vault.orderCanonical(paths);

  return {
    libraryDataVersion: vault.dataVersion,
    canonicalSongs: vault.canonicalView,
    canonicalSongPaths: vault.canonicalTrail,
    sourceSongs: vault.sourceView,
    sourceSongPaths: vault.sourceTrail,
    songLookup: vault.songIndex,
    getSongByPath, // 实现
    resolveSongsByPaths, // 实现
    setSongRecord, // 实现
    setExtraSong,
    setExtraSongs,
    setExtraSongsBatch,
    patchSongMeta,
    removeExtraSong,
    libraryFolders: folderListing,
    libraryHierarchy: hierarchyTree,
    artistCatalog: artistTabIndex,
    albumCatalog: albumTabIndex,
    songList: vault.sourceView,
    librarySongs: vault.canonicalView,
    folderTree: hierarchyTree,
    libraryScanProgress: scanStatus,
    libraryScanSession: scanJournal,
    lastLibraryScanError: scanFailure,
    watchedFolders: monitoredFolders,
    artistSortMode: artistViewOrder,
    albumSortMode: albumViewOrder,
    albumDetailSortMode: albumEntryOrder,
    artistCustomOrder: artistPinnedOrder,
    albumCustomOrder: albumPinnedOrder,
    folderSortMode: folderViewOrder,
    folderCustomOrder: folderPinnedOrder,
    localSortMode: localViewOrder,
    localCustomOrder: localPinnedOrder,
    setSourceSongs, // 实现
    setCanonicalSongs, // 实现
    setLibraryFolders: saveFolderListing,
    setLibraryHierarchy: saveHierarchyTree,
    setArtistCatalog: saveArtistTabIndex,
    setAlbumCatalog: saveAlbumTabIndex,
    setSongList: setSourceSongs, // 实现
    setLibrarySongs: setCanonicalSongs, // 实现
    setFolderTree: saveHierarchyTree,
    setLibraryScanProgress: saveScanStatus,
    setLibraryScanSession: saveScanJournal,
    setLastLibraryScanError: saveScanFailure,
    setWatchedFolders: saveMonitoredFolders,
    reorderWatchedFolders: moveMonitoredFolder,
    patchLibrarySongs, // 实现
    setCanonicalSongOrder, // 实现
  };
});
