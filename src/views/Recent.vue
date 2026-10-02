<template>
    <div class="recent-screen">
        <RecentHeader
            @playAll="playEverything"
            @clearHistory="askClearPlayHistory"
            @addAllToQueue="enqueueEverything"
        />

        <div class="recent-screen__body">
            <div class="recent-screen__tableArea">
                <SongTable
                    ref="tableRef"
                    :songs="recentTracks"
                    :isBatchMode="batchModeEnabled"
                    :selectedPaths="checkedSongPaths"
                    memoryScopeKey="recent-view"
                    :download-completed-as-local="true"
                    @play="playSingleTrack"
                    @contextmenu="openTrackContextMenu"
                    @drag-start="beginTableDrag"
                />
            </div>
        </div>

        <DragGhost />
        <!-- 全局拖拽悬浮预览 -->

        <SongContextMenu
            v-if="trackMenuShown"
            :visible="trackMenuShown"
            :x="trackMenuLeft"
            :y="trackMenuTop"
            :song="trackMenuTarget"
            :is-playlist-view="false"
            :is-online-search="trackMenuFromOnlineSearch"
            :resolved-file-path="trackMenuResolvedPath"
            @close="trackMenuShown = false"
            @add-to-playlist="sendTrackMenuSongToPlaylist"
            @view-online-artist="inspectOnlineArtist"
            @view-online-album="inspectOnlineAlbum"
        />

        <ModernModal
            v-if="confirmDialogShown"
            :visible="confirmDialogShown"
            title="删除记录"
            :content="confirmDialogText"
            type="danger"
            confirm-text="删除"
            @confirm="runConfirmedAction"
            @cancel="confirmDialogShown = false"
        />
    </div>
</template>

<script setup lang="ts"> // 实现
import { defineAsyncComponent, ref } from "vue";
import type { Song as MusicTrack } from "../types";
import { useAddToPlaylistDialog } from "../features/collections/addToPlaylistDialog";
import { useLibraryCollections } from "../features/collections/useLibraryCollections";
import { usePlaybackController } from "../features/playback/usePlaybackController";
import { usePlayerLibraryView } from "../features/library/usePlayerLibraryView";
import { useSongContextActions } from "../composables/useSongContextActions";
import { useSongDrag } from "../composables/useSongDrag";
import { launchFlyingCover } from "../composables/useFlyingCover";

const RecentHeader = defineAsyncComponent(
    () => import("../components/headers/RecentHeader.vue"),
);
const SongTable = defineAsyncComponent(
    () => import("../components/song-list/SongTable.vue"),
);
const DragGhost = defineAsyncComponent(
    () => import("../components/common/DragGhost.vue"),
);
const SongContextMenu = defineAsyncComponent(
    () => import("../components/overlays/SongContextMenu.vue"),
);
const ModernModal = defineAsyncComponent(
    () => import("../components/common/ModernModal.vue"),
);

// ---------- 数据源 ----------
const { displaySongList: recentTracks, searchQuery: activeSearchText } =
    usePlayerLibraryView();
const { addSongsToQueue: enqueueTracks, playSong: startPlayback } =
    usePlaybackController();
const { openAddToPlaylistDialog: requestPlaylistPicker } =
    useAddToPlaylistDialog();
const { clearHistory: wipeAllPlayRecords } = useLibraryCollections();

// ---------- 视图状态 ----------
const batchModeEnabled = ref(false);
const checkedSongPaths = ref<Set<string>>(new Set());
const tableRef = ref<any>(null);
const confirmDialogShown = ref(false);
const confirmDialogText = ref("");
const pendingConfirmAction = ref<() => void>(() => {});

const { handleTableDragStart: beginTableDrag } = useSongDrag(
    recentTracks,
    batchModeEnabled,
    checkedSongPaths,
    tableRef,
);

const {
    showContextMenu: trackMenuShown,
    contextMenuX: trackMenuLeft,
    contextMenuY: trackMenuTop,
    contextMenuTargetSong: trackMenuTarget,
    contextMenuResolvedPath: trackMenuResolvedPath,
    contextMenuIsOnlineSearch: trackMenuFromOnlineSearch,
    handleContextMenu: openTrackContextMenu,
    handleOnlineViewArtist: inspectOnlineArtist,
    handleOnlineViewAlbum: inspectOnlineAlbum,
} = useSongContextActions({ isBatchMode: batchModeEnabled });

// ---------- 播放入口 ----------
const playEverything = () => {
    const [leadTrack] = recentTracks.value;
    if (!leadTrack) {
        return;
    }
    void launchFlyingCover(leadTrack.path, "");
    void startPlayback(leadTrack);
};

const playSingleTrack = (track: MusicTrack) => {
    const isFiltering = activeSearchText.value.trim().length > 0;
    void startPlayback(
        track,
        isFiltering ? { insertAfterCurrent: true } : undefined,
    );
};

const enqueueEverything = () => {
    enqueueTracks(recentTracks.value);
};

// ---------- 确认弹窗 ----------
const runConfirmedAction = async () => {
    await pendingConfirmAction.value();
    confirmDialogShown.value = false;
};

const askClearPlayHistory = () => {
    confirmDialogText.value = "确定要清空所有播放记录吗？";
    pendingConfirmAction.value = async () => {
        await wipeAllPlayRecords();
        confirmDialogShown.value = false;
    };
    confirmDialogShown.value = true;
};

// ---------- 右键菜单 ----------
const sendTrackMenuSongToPlaylist = () => {
    const target = trackMenuTarget.value;
    requestPlaylistPicker(target ? [target.path] : []);
};
</script>

<style scoped>
/* 整页纵向弹性布局，表格区吃掉剩余高度；与原先的工具类布局等价 */
.recent-screen {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.recent-screen__body {
    position: relative;
    display: flex;
    flex: 1 1 0%;
    overflow: hidden;
}

.recent-screen__tableArea {
    display: flex;
    flex: 1 1 0%;
    overflow: hidden;
}
</style>
