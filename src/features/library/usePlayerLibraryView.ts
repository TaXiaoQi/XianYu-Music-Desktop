import { computed } from "vue";
import { storeToRefs } from "pinia";

import { useCollectionsStore } from "../collections/store";
import { useLibraryStore } from "./store";
import { useNavigationStore } from "../../shared/stores/navigation";
import { useLibraryCatalogSelectors } from "./useLibraryCatalogSelectors";
import { useLibraryCollectionSelectors } from "./useLibraryCollectionSelectors";
import { useLibraryCurrentViewSongs } from "./useLibraryCurrentViewSongs";
import { useLibraryFolderSelectors } from "./useLibraryFolderSelectors";
export type { AlbumListItem, ArtistListItem } from "./playerLibraryViewShared";

// 这些视图模式都属于本地曲库范畴。
const LOCAL_MUSIC_MODES: readonly string[] = ["all", "artist", "album"];

export function usePlayerLibraryView() {
    const navRefs = storeToRefs(useNavigationStore());
    const libRefs = storeToRefs(useLibraryStore());
    const collectionRefs = storeToRefs(useCollectionsStore());

    const currentViewMode = navRefs.currentViewMode;
    const searchQuery = navRefs.searchQuery;

    const isLocalMusic = computed(() =>
        LOCAL_MUSIC_MODES.includes(currentViewMode.value),
    );
    const isFolderMode = computed(() => currentViewMode.value === "folder");

    const catalog = useLibraryCatalogSelectors({
        artistCatalog: libRefs.artistCatalog,
        albumCatalog: libRefs.albumCatalog,
        searchQuery,
        artistSortMode: libRefs.artistSortMode,
        albumSortMode: libRefs.albumSortMode,
        artistCustomOrder: libRefs.artistCustomOrder,
        albumCustomOrder: libRefs.albumCustomOrder,
    });

    const folders = useLibraryFolderSelectors({
        watchedFolders: libRefs.watchedFolders,
        sourceSongPaths: libRefs.sourceSongPaths,
        songLookup: libRefs.songLookup,
        currentFolderFilter: navRefs.currentFolderFilter,
        folderSortMode: libRefs.folderSortMode,
        folderCustomOrder: libRefs.folderCustomOrder,
    });

    const collections = useLibraryCollectionSelectors({
        favoritePaths: collectionRefs.favoritePaths,
        songLookup: libRefs.songLookup,
    });

    const currentView = useLibraryCurrentViewSongs({
        canonicalSongPaths: libRefs.canonicalSongPaths,
        playlists: collectionRefs.playlists,
        recentSongs: collectionRefs.recentSongs,
        songLookup: libRefs.songLookup,
        favoriteSongPaths: collections.favoriteSongPaths,
        currentFolderSongPaths: folders.currentFolderSongPaths,
        currentViewMode,
        searchQuery,
        localMusicTab: navRefs.localMusicTab,
        currentArtistFilter: navRefs.currentArtistFilter,
        currentAlbumFilter: navRefs.currentAlbumFilter,
        currentFolderFilter: navRefs.currentFolderFilter,
        filterCondition: navRefs.filterCondition,
        favTab: navRefs.favTab,
        folderSortMode: libRefs.folderSortMode,
        localSortMode: libRefs.localSortMode,
        albumDetailSortMode: libRefs.albumDetailSortMode,
        localCustomOrder: libRefs.localCustomOrder,
        playlistSortMode: collectionRefs.playlistSortMode,
    });

    return {
        activeRootPath: navRefs.activeRootPath,
        albumList: catalog.albumList,
        artistList: catalog.artistList,
        canonicalSongs: libRefs.canonicalSongs,
        currentViewSongCount: currentView.currentViewSongCount,
        currentViewSongPaths: currentView.currentViewSongPaths,
        currentFolderSongs: folders.currentFolderSongs,
        currentViewSongs: currentView.currentViewSongs,
        favoriteSongList: collections.favoriteSongList,
        filteredAlbumList: catalog.filteredAlbumList,
        filteredArtistList: catalog.filteredArtistList,
        folderList: folders.folderList,
        isFolderMode,
        isLocalMusic,
        libraryFolders: libRefs.libraryFolders,
        libraryHierarchy: libRefs.libraryHierarchy,
        resolveSongByPath: currentView.resolveSongByPath,
        searchQuery,
        sourceSongs: libRefs.sourceSongs,
        // 旧调用方使用的兼容别名。
        displaySongList: currentView.currentViewSongs,
        folderTree: libRefs.libraryHierarchy,
        librarySongs: libRefs.canonicalSongs,
        songList: libRefs.sourceSongs,
    };
}
