import { ref } from "vue";
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Playlist } from "../types";
import type { Song } from "../types";
import { usePlaybackStore } from "../features/playback/store";
import { useHomeBatchActions } from "./useHomeBatchActions";

const deleteFileMock = vi.fn();

vi.mock("../services/tauri/fileApi", () => ({
    fileApi: {
        deleteMusicFile: (...callArgs: unknown[]) =>
            deleteFileMock(...callArgs),
    },
}));

// 单曲夹具中除路径外的固定字段
const staticSongFields = () => ({
    artist: "Artist",
    artist_names: ["Artist"],
    effective_artist_names: ["Artist"],
    album: "Album",
    album_artist: "Artist",
    album_key: "album::artist",
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: 180,
});

/** 构造一首测试歌曲，文件名截取自路径末段 */
const buildSong = (path: string): Song => {
    const fileName = path.split(/[\\/]/).pop() ?? path;
    return { path, name: fileName, title: fileName, ...staticSongFields() };
};

type ActionsOptions = Parameters<typeof useHomeBatchActions>[0];

/**
 * 搭建被测对象：按给定歌曲初始化曲库/收藏等默认状态，
 * 再由用例通过 customize 回调覆盖关心的选项。
 */
const buildActions = (
    songs: Song[],
    customize?: (options: ActionsOptions) => void,
) => {
    const allPaths = songs.map((song) => song.path);
    const state = {
        canonicalSongs: ref<Song[]>([...songs]),
        sourceSongs: ref<Song[]>([...songs]),
        favoritePaths: ref<string[]>([...allPaths]),
        playlists: ref<Playlist[]>([]),
        selectedPaths: ref(new Set<string>()),
    };
    const options: ActionsOptions = {
        ...state,
        currentViewMode: ref("folder"),
        isBatchMode: ref(true),
        isManagementMode: ref(true),
        moveFilesToFolder: vi.fn(),
        removeFromHistory: vi.fn(),
        showToast: vi.fn(),
        getRoutePath: () => "/",
    };
    customize?.(options);
    return { ...useHomeBatchActions(options), state };
};

describe("useHomeBatchActions 批量操作", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        deleteFileMock.mockReset();
    });

    it("物理删除后，播放队列、收藏、歌单与历史记录同步清理", async () => {
        const deletedSong = buildSong("C:\\Music\\deleted.flac");
        const keptSong = buildSong("C:\\Music\\kept.flac");

        // 预置播放状态：两条队列与当前曲目都包含将被删除的歌曲
        const playbackStore = usePlaybackStore();
        const initialQueue = [deletedSong, keptSong];
        playbackStore.playQueue = initialQueue;
        playbackStore.tempQueue = [deletedSong];
        playbackStore.currentSong = deletedSong;
        deleteFileMock.mockResolvedValue(undefined);

        const selectedPaths = ref(new Set<string>([deletedSong.path]));
        const playlists = ref<Playlist[]>([
            {
                id: "playlist-1",
                name: "Playlist",
                songPaths: [deletedSong.path, keptSong.path],
            },
        ]);
        const removeFromHistory = vi.fn(async () => undefined);

        const built = buildActions([deletedSong, keptSong], (options) => {
            options.selectedPaths = selectedPaths;
            options.playlists = playlists;
            options.removeFromHistory = removeFromHistory;
        });

        built.handleFolderBatchDelete();
        await built.executeConfirmAction();

        expect(playbackStore.playQueue.map((song) => song.path)).toEqual([
            keptSong.path,
        ]);
        expect(playbackStore.tempQueue).toEqual([]);
        expect(playbackStore.currentSong).toBeNull();
        expect(built.state.favoritePaths.value).toEqual([keptSong.path]);
        expect(playlists.value[0]?.songPaths).toEqual([keptSong.path]);
        expect(removeFromHistory).toHaveBeenCalledWith([deletedSong.path]);
    });
});
