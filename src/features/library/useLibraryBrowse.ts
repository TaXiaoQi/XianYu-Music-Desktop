import { storeToRefs } from "pinia";

import { useLibraryStore } from "./store";
import { useNavigationStore } from "../../shared/stores/navigation";
import { usePlayerLibraryView } from "./usePlayerLibraryView";

export function useLibraryBrowse() { // 实现
    const library = useLibraryStore();
    const nav = useNavigationStore();
    const view = usePlayerLibraryView();

    const navRefs = storeToRefs(nav);
    const libRefs = storeToRefs(library);

    // 记录艺人自定义顺序；尚未处于 custom 模式时顺带切换过去。
    const setArtistOrder = (order: string[]) => {
        libRefs.artistCustomOrder.value = order;
        if (libRefs.artistSortMode.value !== "custom")
            libRefs.artistSortMode.value = "custom";
    };

    // 记录专辑自定义顺序，逻辑与艺人侧一致。
    const setAlbumOrder = (order: string[]) => {
        libRefs.albumCustomOrder.value = order;
        if (libRefs.albumSortMode.value !== "custom")
            libRefs.albumSortMode.value = "custom";
    };

    const moveWatchedFolder = (fromIndex: number, toIndex: number) => {
        library.reorderWatchedFolders(fromIndex, toIndex);
    };

    return {
        searchQuery: navRefs.searchQuery,
        localMusicTab: navRefs.localMusicTab,
        currentViewMode: navRefs.currentViewMode,
        currentFolderFilter: navRefs.currentFolderFilter,
        activeRootPath: navRefs.activeRootPath,
        libraryHierarchy: libRefs.libraryHierarchy,
        libraryFolders: libRefs.libraryFolders,
        canonicalSongs: libRefs.canonicalSongs,
        sourceSongs: libRefs.sourceSongs,
        artistSortMode: libRefs.artistSortMode,
        albumSortMode: libRefs.albumSortMode,
        artistList: view.artistList,
        albumList: view.albumList,
        currentFolderSongs: view.currentFolderSongs,
        currentViewSongs: view.currentViewSongs,
        filteredArtistList: view.filteredArtistList,
        filteredAlbumList: view.filteredAlbumList,
        folderList: view.folderList,
        favoriteSongList: view.favoriteSongList,
        folderTree: view.libraryHierarchy,
        librarySongs: view.canonicalSongs,
        displaySongList: view.currentViewSongs,
        updateArtistOrder: setArtistOrder,
        updateAlbumOrder: setAlbumOrder,
        reorderWatchedFolders: moveWatchedFolder,
    };
}
