<script setup lang="ts"> // 实现
import { computed } from "vue";

import type { FolderNode } from "../../types";
import type { Song } from "../../types";
import { default as HomeHeaderPanel } from "./HomeHeaderPanel.vue";
import { default as HomeContentPanel } from "./HomeContentPanel.vue";

type ArtistTabKey = "songs" | "albums" | "details";

interface PlaylistDetail {
    name: string;
    date: string;
}

interface ArtistAlbumItem {
    key: string;
    name: string;
    count: number;
    artist: string;
    firstSongPath: string;
}

interface HomePaneProps {
    localViewMode: string;
    isBatchMode: boolean;
    isManagementMode: boolean;
    activeRootPath: string;
    selectedCount: number;
    folderTree: FolderNode[];
    currentFolderFilter: string;
    playlistDetail: PlaylistDetail | null;
    localSongList: Song[];
    localSongPaths?: string[];
    resolveSongByPath?: (path: string) => Song | null;
    artistActiveTab: ArtistTabKey;
    localFilterCondition: string;
    selectedAlbumSong: Song | null;
    artistAlbumList: ArtistAlbumItem[];
    coverCache: Map<string, string>;
    loadingSet: Set<string>;
    selectedPaths: Set<string>;
    setSongTableRef?: (instance: any | null) => void;
    scrollContainerRef?: HTMLElement | null;
}

const viewProps = defineProps<HomePaneProps>();

interface HomePaneEmits {
    (e: "update:isBatchMode", value: boolean): void;
    (e: "update:isManagementMode", value: boolean): void;
    (e: "update:artistActiveTab", value: ArtistTabKey): void;
    (e: "update:selectedPaths", value: Set<string>): void;
    (e: "playAll"): void;
    (e: "batchPlay"): void;
    (e: "showAddToPlaylist"): void;
    (e: "batchDelete"): void;
    (e: "folderBatchDelete"): void;
    (e: "batchMove"): void;
    (e: "batchDownload"): void;
    (e: "rootCreatePlaylist", path: string, name: string): void;
    (e: "addFolder"): void;
    (e: "refreshFolder"): void;
    (e: "removeFolder", path: string, name?: string): void;
    (e: "rootCreateFolder", path: string): void;
    (e: "rootDeleteFolder", path: string): void;
    (e: "activeRootChange", value: string): void;
    (e: "renamePlaylist"): void;
    (e: "refreshAll"): void;
    (e: "playSong", song: Song): void;
    (e: "contextMenuSong", nativeEvent: MouseEvent, song: Song): void;
    (e: "tableDragStart", ...args: any[]): void;
    (e: "artistAlbumClick", albumKey: string): void;
    (e: "selectAll"): void;
    (e: "batchAddToFavorites"): void;
}

const emitEvent = defineEmits<HomePaneEmits>();

const DISCOVER_PAGES = new Set([
    "statistics",
    "leaderboard",
    "dailyRecommend",
    "topLists",
]);

const onDiscoverPage = (mode: string) => DISCOVER_PAGES.has(mode);

// 歌曲表格记忆槽位：同一槽位下的滚动/选择状态才互相恢复。
const listingScopeToken = computed(() => {
    const mode = viewProps.localViewMode;
    if (mode === "folder") {
        return `folder::${viewProps.currentFolderFilter || ""}::${viewProps.activeRootPath || ""}`;
    }
    if (mode === "artist" || mode === "album" || mode === "playlist") {
        return `${mode}::${viewProps.localFilterCondition || ""}`;
    }
    return onDiscoverPage(mode) ? "discover" : "all";
});

const viewInstanceKey = computed(() => {
    const modeTag = onDiscoverPage(viewProps.localViewMode)
        ? "discover"
        : viewProps.localViewMode;
    return [
        modeTag,
        viewProps.localFilterCondition ?? "",
        viewProps.currentFolderFilter ?? "",
        viewProps.activeRootPath ?? "",
        viewProps.artistActiveTab ?? "",
    ].join("::");
});

const headerBindings = computed(() => ({
    localViewMode: viewProps.localViewMode,
    isBatchMode: viewProps.isBatchMode,
    isManagementMode: viewProps.isManagementMode,
    activeRootPath: viewProps.activeRootPath,
    selectedCount: viewProps.selectedCount,
    folderTree: viewProps.folderTree,
    currentFolderFilter: viewProps.currentFolderFilter,
    playlistDetail: viewProps.playlistDetail,
    localSongList: viewProps.localSongList,
    localSongPaths: viewProps.localSongPaths,
    scrollContainerRef: viewProps.scrollContainerRef,
}));

const headerListeners = {
    "update:isBatchMode": (value: boolean) =>
        emitEvent("update:isBatchMode", value),
    "update:isManagementMode": (value: boolean) =>
        emitEvent("update:isManagementMode", value),
    playAll: () => emitEvent("playAll"),
    batchPlay: () => emitEvent("batchPlay"),
    showAddToPlaylist: () => emitEvent("showAddToPlaylist"),
    rootCreatePlaylist: (path: string, name: string) =>
        emitEvent("rootCreatePlaylist", path, name),
    batchDelete: () => emitEvent("batchDelete"),
    folderBatchDelete: () => emitEvent("folderBatchDelete"),
    batchMove: () => emitEvent("batchMove"),
    batchDownload: () => emitEvent("batchDownload"),
    addFolder: () => emitEvent("addFolder"),
    refreshFolder: () => emitEvent("refreshFolder"),
    removeFolder: (path: string, name?: string) =>
        emitEvent("removeFolder", path, name),
    rootCreateFolder: (path: string) => emitEvent("rootCreateFolder", path),
    rootDeleteFolder: (path: string) => emitEvent("rootDeleteFolder", path),
    activeRootChange: (value: string) => emitEvent("activeRootChange", value),
    renamePlaylist: () => emitEvent("renamePlaylist"),
    refreshAll: () => emitEvent("refreshAll"),
    selectAll: () => emitEvent("selectAll"),
    batchAddToFavorites: () => emitEvent("batchAddToFavorites"),
};

const contentBindings = computed(() => ({
    localViewMode: viewProps.localViewMode,
    isBatchMode: viewProps.isBatchMode,
    isManagementMode: viewProps.isManagementMode,
    artistActiveTab: viewProps.artistActiveTab,
    localFilterCondition: viewProps.localFilterCondition,
    songTableMemoryScopeKey: listingScopeToken.value,
    localSongList: viewProps.localSongList,
    localSongPaths: viewProps.localSongPaths,
    resolveSongByPath: viewProps.resolveSongByPath,
    selectedCount: viewProps.selectedCount,
    selectedAlbumSong: viewProps.selectedAlbumSong,
    artistAlbumList: viewProps.artistAlbumList,
    coverCache: viewProps.coverCache,
    loadingSet: viewProps.loadingSet,
    selectedPaths: viewProps.selectedPaths,
    setSongTableRef: viewProps.setSongTableRef,
    scrollContainerRef: viewProps.scrollContainerRef,
}));

const contentListeners = {
    "update:isBatchMode": (value: boolean) =>
        emitEvent("update:isBatchMode", value),
    "update:artistActiveTab": (value: ArtistTabKey) =>
        emitEvent("update:artistActiveTab", value),
    "update:selectedPaths": (value: Set<string>) =>
        emitEvent("update:selectedPaths", value),
    playAll: () => emitEvent("playAll"),
    batchPlay: () => emitEvent("batchPlay"),
    showAddToPlaylist: () => emitEvent("showAddToPlaylist"),
    batchDelete: () => emitEvent("batchDelete"),
    batchMove: () => emitEvent("batchMove"),
    playSong: (song: Song) => emitEvent("playSong", song),
    contextMenuSong: (nativeEvent: MouseEvent, song: Song) =>
        emitEvent("contextMenuSong", nativeEvent, song),
    tableDragStart: (...args: any[]) => emitEvent("tableDragStart", ...args),
    artistAlbumClick: (albumKey: string) =>
        emitEvent("artistAlbumClick", albumKey),
};
</script>

<template>
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
            :key="viewInstanceKey"
            class="home-pane-swap-host flex min-h-0 min-w-0 flex-1 flex-col"
        >
            <HomeHeaderPanel v-bind="headerBindings" v-on="headerListeners" />

            <HomeContentPanel
                v-bind="contentBindings"
                v-on="contentListeners"
            />
        </div>
    </div>
</template>

<style scoped>
.home-pane-swap-host {
    animation: home-pane-enter 260ms ease;
}

@keyframes home-pane-enter {
    from {
        opacity: 0;
        transform: translateY(8px);
    }

    to {
        opacity: 1;
        transform: translateY(0);
    }
}
</style>
