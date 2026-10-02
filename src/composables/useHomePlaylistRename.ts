import { ref, type Ref } from "vue";

import type { Playlist } from "../types";

/** 歌单重命名弹窗所需的上下文 */
interface PlaylistRenameContext {
    /** 当前视图模式 */
    currentViewMode: Ref<string>;
    /** 视图过滤条件（歌单视图下为歌单 id） */
    filterCondition: Ref<string>;
    /** 用户歌单列表 */
    playlists: Ref<Playlist[]>;
    /** 轻提示 */
    showToast: (message: string, type?: "success" | "error" | "info") => void;
    /** 更新歌单封面，返回是否生效 */
    setPlaylistCover: (id: string, coverPath: string | null) => boolean;
}

/** 歌单重命名：打开弹窗装入当前信息，提交时按需写回名称与封面 */
export function useHomePlaylistRename(page: PlaylistRenameContext) {
    const isRenameDialogOpen = ref(false);
    const draftName = ref("");
    const draftCoverPath = ref<string | undefined>(undefined);
    const targetPlaylistId = ref("");

    /** 取歌单视图当前对应的歌单；不在歌单视图时视为无目标 */
    function locateActivePlaylist(): Playlist | null {
        if (page.currentViewMode.value !== "playlist") {
            return null;
        }

        const matched = page.playlists.value.find(
            (item) => item.id === page.filterCondition.value,
        );
        return matched ?? null;
    }

    /** 打开重命名弹窗，预填歌单名称与封面 */
    function openRenameDialog() {
        const playlist = locateActivePlaylist();
        if (!playlist) {
            return;
        }

        targetPlaylistId.value = playlist.id;
        draftName.value = playlist.name;
        draftCoverPath.value = playlist.coverPath;
        isRenameDialogOpen.value = true;
    }

    /** 提交编辑：名称与封面仅在真实变化时写回，有变更才提示成功 */
    function applyPlaylistEdits(payload: {
        name: string;
        coverPath: string | null;
    }) {
        const playlist = locateActivePlaylist();
        if (!playlist) {
            return;
        }

        const nextName = payload.name.trim();
        if (!nextName) {
            return;
        }

        let touched = false;
        if (nextName !== playlist.name) {
            playlist.name = nextName;
            touched = true;
        }

        const coverAdjusted =
            (payload.coverPath ?? null) !== (playlist.coverPath ?? null);
        if (coverAdjusted) {
            page.setPlaylistCover(playlist.id, payload.coverPath);
            touched = true;
        }

        if (touched) {
            page.showToast("歌单信息已更新", "success");
        }

        isRenameDialogOpen.value = false;
    }

    return {
        showRenameModal: isRenameDialogOpen,
        renameInitialValue: draftName,
        renameInitialCoverPath: draftCoverPath,
        editingPlaylistId: targetPlaylistId,
        handleRenamePlaylist: openRenameDialog,
        confirmRename: applyPlaylistEdits,
    };
}
