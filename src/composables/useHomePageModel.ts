import { computed } from "vue";
import { ref } from "vue";

import { useHomeArtistAlbums } from "./useHomeArtistAlbums";
import { useHomeBatchActions } from "./useHomeBatchActions";
import { useHomeFolderManagement } from "./useHomeFolderManagement";
import { useHomePlaylistRename } from "./useHomePlaylistRename";
import { useScopedBatchSelection } from "./useScopedBatchSelection";
import { useHomeViewState } from "./useHomeViewState";
import { useSongContextActions } from "./useSongContextActions";
import { useSongDrag } from "./useSongDrag";
import { collectHomePageModelSources } from "./homePageModelSources";
import { createHomePagePlaybackActions } from "./homePageModelPlayback";

/**
 * 首页页模型：把路由态、库态与各子组合函数编排成 Home.vue 需要的完整视图模型。
 * 外部依赖统一经 collectHomePageModelSources 聚合，播放/批量动作经
 * createHomePagePlaybackActions 构建，此处只做状态编排与分组导出。
 */
export function useHomePageModel() { // 实现
    const sources = collectHomePageModelSources();
    const { route } = sources;
    const {
        currentViewMode,
        activeRootPath,
        currentFolderFilter,
        filterCondition,
    } = sources.viewState;
    const {
        currentViewSongPaths,
        displaySongList,
        librarySongs,
        folderTree,
        resolveSongByPath,
    } = sources.libraryView;

    const isManagementMode = ref<boolean>(false);
    // 歌曲表格组件实例
    const songTableRef = ref<any>(null);
    const setSongTableRef = (instance: any | null) => {
        songTableRef.value = instance;
    };

    const homeViewState = useHomeViewState({
        currentViewMode,
        filterCondition,
        isManagementMode,
    });

    const isPlaylistView = computed(() => currentViewMode.value === "playlist");
    const localSongPaths = computed(() => currentViewSongPaths.value);
    const localSongList = computed(() =>
        isPlaylistView.value ? [] : displaySongList.value,
    );
    const selectedAlbumSong = computed(() => localSongList.value[0] || null);

    const batchSelectionScopeKey = computed(() => {
        const scopeSegments = [
            route.path,
            currentViewMode.value,
            filterCondition.value,
            currentFolderFilter.value,
        ];
        return scopeSegments.join("::");
    });

    const { isBatchMode, selectedPaths } = useScopedBatchSelection(
        batchSelectionScopeKey,
    );

    const dragSongs = computed(() => displaySongList.value);
    const { handleTableDragStart } = useSongDrag(
        dragSongs,
        isBatchMode,
        selectedPaths,
        songTableRef,
    );

    const songContext = useSongContextActions({
        isBatchMode,
        deleteFromDisk: sources.runtime.deleteFromDisk,
    });

    const batchActions = useHomeBatchActions({
        currentViewMode,
        selectedPaths,
        isBatchMode,
        isManagementMode,
        canonicalSongs: sources.libraryRefs.canonicalSongs,
        sourceSongs: sources.libraryRefs.sourceSongs,
        favoritePaths: sources.collections.favoritePaths,
        playlists: sources.collections.playlists,
        moveFilesToFolder: sources.runtime.moveFilesToFolder,
        removeFromHistory: sources.collections.removeFromHistory,
        showToast: sources.toasts.showToast,
        getRoutePath: () => route.path,
        resolveSongByPath,
    });

    const folderManagement = useHomeFolderManagement({
        isManagementMode,
        activeRootPath,
        currentFolderFilter,
        libraryHierarchy: folderTree,
        sourceSongs: sources.libraryRefs.sourceSongs,
        refreshFolder: sources.runtime.refreshFolder,
        fetchFolderTree: sources.runtime.fetchFolderTree,
        createFolder: sources.runtime.createFolder,
        deleteFolder: sources.runtime.deleteFolder,
        expandFolderPath: sources.runtime.expandFolderPath,
        addLibraryFolder: sources.runtime.addLibraryFolder,
        removeLibraryFolderLinked: sources.runtime.removeLibraryFolderLinked,
        showToast: sources.toasts.showToast,
        openConfirm: batchActions.openConfirm,
    });

    const renameBox = useHomePlaylistRename({
        currentViewMode,
        filterCondition,
        playlists: sources.collections.playlists,
        showToast: sources.toasts.showToast,
        setPlaylistCover: sources.collections.setPlaylistCover,
    });

    const playlistDetail = computed(() => {
        if (homeViewState.localViewMode.value !== "playlist") {
            return null;
        }

        const matchedPlaylist = sources.collections.playlists.value.find(
            (entry) => entry.id === homeViewState.localFilterCondition.value,
        );
        if (!matchedPlaylist) {
            return null;
        }

        return {
            name: matchedPlaylist.name,
            date: (matchedPlaylist as any).createdAt || "",
        };
    });

    const { artistAlbumList } = useHomeArtistAlbums({
        localFilterCondition: homeViewState.localFilterCondition,
        filterCondition,
        librarySongs,
        albumSortMode: sources.libraryRefs.albumSortMode,
        albumCustomOrder: sources.libraryRefs.albumCustomOrder,
        preloadCovers: sources.covers.preloadCovers,
    });

    const playbackActions = createHomePagePlaybackActions(
        sources,
        { isBatchMode, selectedPaths },
        songContext,
    );

    // —— 输出分组：视图状态 ——
    const viewStateGroup = {
        viewTransitionKey: homeViewState.viewTransitionKey,
        localViewMode: homeViewState.localViewMode,
        isBatchMode,
        isManagementMode,
        activeRootPath,
        selectedPaths,
        folderTree,
        currentFolderFilter,
        playlistDetail,
    };

    // —— 输出分组：列表数据 ——
    const listingGroup = {
        localSongList,
        localSongPaths,
        resolveSongByPath,
        artistActiveTab: homeViewState.artistActiveTab,
        localFilterCondition: homeViewState.localFilterCondition,
        selectedAlbumSong,
        artistAlbumList,
    };

    // —— 输出分组：封面缓存 ——
    const coverGroup = {
        coverCache: sources.covers.coverCache,
        loadingSet: sources.covers.loadingSet,
    };

    // —— 输出分组：表格挂载与拖拽 ——
    const tableGroup = {
        songTableRef,
        setSongTableRef,
        handleTableDragStart,
    };

    // —— 输出分组：播放 ——
    const playbackGroup = {
        handlePlayAll: playbackActions.handlePlayAll,
        handleBatchPlay: playbackActions.handleBatchPlay,
        playSong: playbackActions.playSong,
        handleArtistAlbumClick: playbackActions.handleArtistAlbumClick,
    };

    // —— 输出分组：批量操作 ——
    const batchGroup = {
        handleAddToPlaylistRequest: playbackActions.handleAddToPlaylistRequest,
        handleSelectAll: playbackActions.handleSelectAll,
        handleBatchAddToFavorites: playbackActions.handleBatchAddToFavorites,
        handleRefreshAll: playbackActions.handleRefreshAll,
        handleBatchDownload: batchActions.handleBatchDownload,
        requestBatchDelete: batchActions.requestBatchDelete,
        handleFolderBatchDelete: batchActions.handleFolderBatchDelete,
        handleBatchMove: batchActions.handleBatchMove,
        confirmBatchMove: batchActions.confirmBatchMove,
        showMoveToFolderModal: batchActions.showMoveToFolderModal,
    };

    // —— 输出分组：文件夹管理 ——
    const folderGroup = {
        handleRootCreatePlaylistRequest:
            playbackActions.handleRootCreatePlaylistRequest,
        handleAddFolder: folderManagement.handleAddFolder,
        handleRefreshFolder: folderManagement.handleRefreshFolder,
        handleRemoveFolderWithConfirm:
            folderManagement.handleRemoveFolderWithConfirm,
        handleRootCreateFolderRequest:
            folderManagement.handleRootCreateFolderRequest,
        handleRootDeleteFolderRequest:
            folderManagement.handleRootDeleteFolderRequest,
        handleActiveRootChange: folderManagement.handleActiveRootChange,
        showCreateFolderModal: folderManagement.showCreateFolderModal,
        confirmCreateFolder: folderManagement.confirmCreateFolder,
        showFolderDeleteConfirm: folderManagement.showFolderDeleteConfirm,
        folderToDeletePath: folderManagement.folderToDeletePath,
        executeDeleteFolder: folderManagement.executeDeleteFolder,
    };

    // —— 输出分组：通用确认框 ——
    const confirmGroup = {
        showConfirm: batchActions.showConfirm,
        confirmTitle: batchActions.confirmTitle,
        confirmMessage: batchActions.confirmMessage,
        confirmButtonText: batchActions.confirmButtonText,
        executeConfirmAction: batchActions.executeConfirmAction,
    };

    // —— 输出分组：右键菜单 ——
    const contextMenuGroup = {
        handleContextMenu: songContext.handleContextMenu,
        showContextMenu: songContext.showContextMenu,
        contextMenuX: songContext.contextMenuX,
        contextMenuY: songContext.contextMenuY,
        contextMenuTargetSong: songContext.contextMenuTargetSong,
        contextMenuResolvedPath: songContext.contextMenuResolvedPath,
        contextMenuIsOnlineSearch: songContext.contextMenuIsOnlineSearch,
        handleOnlineViewArtist: songContext.handleOnlineViewArtist,
        handleOnlineViewAlbum: songContext.handleOnlineViewAlbum,
        showSongPhysicalDeleteConfirm:
            songContext.showSongPhysicalDeleteConfirm,
        songToPhysicalDelete: songContext.songToPhysicalDelete,
        handleSongPhysicalDelete: songContext.handleSongPhysicalDelete,
        executeSongPhysicalDelete: songContext.executeSongPhysicalDelete,
    };

    // —— 输出分组：歌单重命名 ——
    const renameGroup = {
        handleRenamePlaylist: renameBox.handleRenamePlaylist,
        confirmRename: renameBox.confirmRename,
        showRenameModal: renameBox.showRenameModal,
        renameInitialValue: renameBox.renameInitialValue,
        renameInitialCoverPath: renameBox.renameInitialCoverPath,
        editingPlaylistId: renameBox.editingPlaylistId,
    };

    return {
        ...viewStateGroup,
        ...listingGroup,
        ...coverGroup,
        ...tableGroup,
        ...playbackGroup,
        ...batchGroup,
        ...folderGroup,
        ...confirmGroup,
        ...contextMenuGroup,
        ...renameGroup,
    };
}
