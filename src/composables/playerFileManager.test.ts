import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import type { Song } from "../types";
import { useCollectionsStore } from "../features/collections/store";
import { useLibraryStore } from "../features/library/store";
import { usePlaybackStore } from "../features/playback/store";
import { useSettingsStore } from "../features/settings/store";
import { createPlayerFileManager } from "../features/playback/playerFileManager";

// —— fileApi 打桩：四个关注点透传给本地 spy，其余方法用空实现占位 ——

const scanFolderSpy = vi.fn();
const batchMoveSpy = vi.fn();
const firstSongSpy = vi.fn();
const deleteFileSpy = vi.fn();

// 工厂被提升到文件顶部执行，箭头函数保证 spy 在调用时才解引用
vi.mock("../services/tauri/fileApi", () => ({
    fileApi: {
        deleteFolder: vi.fn(),
        moveFileToFolder: vi.fn(),
        moveMusicFile: vi.fn(),
        showInFolder: vi.fn(),
        scanMusicFolder: (...args: unknown[]) => scanFolderSpy(...args),
        batchMoveMusicFiles: (...args: unknown[]) => batchMoveSpy(...args),
        getFolderFirstSong: (...args: unknown[]) => firstSongSpy(...args),
        deleteMusicFile: (...args: unknown[]) => deleteFileSpy(...args),
    },
}));

// 歌曲夹具：默认字段值属于行为规格，保持不变
const makeSong = (overrides: Partial<Song> = {}): Song => ({ // 实现
    path: "C:\\Music\\A\\demo.flac",
    name: "demo.flac",
    title: "Demo",
    artist: "Artist",
    artist_names: ["Artist"],
    effective_artist_names: ["Artist"],
    album: "Album",
    album_artist: "Artist",
    album_key: "album::artist",
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: 180,
    ...overrides,
});

const resetSpies = () => {
    scanFolderSpy.mockReset();
    batchMoveSpy.mockReset();
    firstSongSpy.mockReset();
    deleteFileSpy.mockReset();
};

// 全文件共享的初始化：全新的 pinia 容器 + 干净的 spy
beforeEach(() => {
    setActivePinia(createPinia());
    resetSpies();
});

/** 组装被测对象；未显式提供回调时使用一次性空实现 */
const buildFileManager = (
    overrides: {
        removeFromHistory?: ReturnType<typeof vi.fn>;
        showToast?: ReturnType<typeof vi.fn>;
    } = {},
) =>
    createPlayerFileManager({
        removeLibraryFolderLinked: vi.fn(),
        removeFromHistory: overrides.removeFromHistory ?? vi.fn(),
        showToast: overrides.showToast ?? vi.fn(),
    });

describe("refreshFolder：刷新文件夹后的状态同步", () => {
    it("刷新时移除已删除歌曲，并同步清理收藏 / 歌单 / 最近播放 / 播放队列", async () => {
        const libraryStore = useLibraryStore();
        const collectionsStore = useCollectionsStore();
        const playbackStore = usePlaybackStore();
        const removeFromHistory = vi.fn().mockResolvedValue(undefined);

        const keptSong = makeSong({
            path: "C:\\Music\\A\\b.flac",
            name: "b.flac",
            title: "B",
        });
        const removedSong = makeSong({
            path: "C:\\Music\\A\\a.flac",
            name: "a.flac",
            title: "A",
        });
        const addedSong = makeSong({
            path: "C:\\Music\\A\\d.flac",
            name: "d.flac",
            title: "D",
        });
        const outsideSong = makeSong({
            path: "C:\\Music\\Elsewhere\\c.flac",
            name: "c.flac",
            title: "C",
        });

        const folderSongs = [removedSong, keptSong, outsideSong];
        libraryStore.librarySongs = folderSongs;
        libraryStore.songList = folderSongs;
        collectionsStore.favoritePaths = [removedSong.path, outsideSong.path];
        collectionsStore.playlists = [
            {
                id: "playlist-1",
                name: "Playlist",
                songPaths: [removedSong.path, outsideSong.path],
            },
        ];
        collectionsStore.recentSongs = [
            { path: removedSong.path, playedAt: 1 },
            { path: outsideSong.path, playedAt: 2 },
        ];
        playbackStore.playQueue = [removedSong, outsideSong];
        playbackStore.tempQueue = [removedSong];
        playbackStore.currentSong = removedSong;

        scanFolderSpy.mockResolvedValue([keptSong, addedSong]);

        const fileManager = buildFileManager({ removeFromHistory });

        const summary = await fileManager.refreshFolder("c:/music/a");

        expect(summary).toEqual({
            removedCount: 1,
            removedPaths: [removedSong.path],
            hasChanges: true,
        });
        const survivingPaths = [
            outsideSong.path,
            keptSong.path,
            addedSong.path,
        ];
        expect(libraryStore.librarySongs.map((song) => song.path)).toEqual(
            survivingPaths,
        );
        expect(libraryStore.songList.map((song) => song.path)).toEqual(
            survivingPaths,
        );
        expect(collectionsStore.favoritePaths).toEqual([outsideSong.path]);
        expect(collectionsStore.playlists[0]?.songPaths).toEqual([
            outsideSong.path,
        ]);
        expect(collectionsStore.recentSongs.map((item) => item.path)).toEqual([
            outsideSong.path,
        ]);
        expect(playbackStore.playQueue.map((song) => song.path)).toEqual([
            outsideSong.path,
        ]);
        expect(playbackStore.tempQueue).toEqual([]);
        expect(playbackStore.currentSong).toBeNull();
        expect(removeFromHistory).toHaveBeenCalledWith([removedSong.path]);
    });

    it("路径不变但元数据变化时，媒体库状态就地更新", async () => {
        const libraryStore = useLibraryStore();
        const oldSong = makeSong({
            path: "C:\\Music\\A\\same.flac",
            name: "same.flac",
            title: "Old Title",
            artist: "Old Artist",
            duration: 180,
        });
        const refreshedSong = makeSong({
            path: oldSong.path,
            name: oldSong.name,
            title: "New Title",
            artist: "New Artist",
            duration: 240,
        });

        libraryStore.librarySongs = [oldSong];
        libraryStore.songList = [oldSong];
        scanFolderSpy.mockResolvedValue([refreshedSong]);

        const fileManager = buildFileManager();

        const summary = await fileManager.refreshFolder("c:/music/a");

        expect(summary).toEqual({
            removedCount: 0,
            removedPaths: [],
            hasChanges: true,
        });
        expect(libraryStore.librarySongs[0]?.title).toBe("New Title");
        expect(libraryStore.librarySongs[0]?.artist).toBe("New Artist");
        expect(libraryStore.librarySongs[0]?.duration).toBe(240);
        expect(libraryStore.songList[0]?.title).toBe("New Title");
    });

    it("刷新时把设置中的短音频阈值透传给扫描接口", async () => {
        const settingsStore = useSettingsStore();
        settingsStore.patchSettings({ libraryMinDurationSeconds: 60 });
        scanFolderSpy.mockResolvedValue([]);

        const fileManager = buildFileManager();

        await fileManager.refreshFolder("c:/music/a");

        expect(scanFolderSpy).toHaveBeenCalledWith("c:/music/a", 60);
    });
});

describe("moveFilesToFolder：批量移动文件", () => {
    it("移动失败的文件保留在原列表，计数只包含成功移动的文件", async () => {
        const libraryStore = useLibraryStore();
        const removeFromHistory = vi.fn().mockResolvedValue(undefined);
        const showToast = vi.fn();

        const movedSongA = makeSong({
            path: "C:\\Music\\A\\a.flac",
            name: "a.flac",
            title: "A",
        });
        const movedSongB = makeSong({
            path: "C:\\Music\\A\\b.flac",
            name: "b.flac",
            title: "B",
        });
        const failedSong = makeSong({
            path: "C:\\Music\\A\\c.flac",
            name: "c.flac",
            title: "C",
        });

        libraryStore.songList = [movedSongA, movedSongB, failedSong];
        libraryStore.libraryHierarchy = [
            {
                name: "A",
                path: "C:\\Music\\A",
                children: [],
                child_count: 0,
                children_loaded: true,
                song_count: 3,
                cover_song_path: movedSongA.path,
                is_expanded: false,
            },
            {
                name: "B",
                path: "C:\\Music\\B",
                children: [],
                child_count: 0,
                children_loaded: true,
                song_count: 0,
                cover_song_path: null,
                is_expanded: false,
            },
        ];

        batchMoveSpy.mockResolvedValue({
            moved_paths: [
                { old_path: movedSongA.path, new_path: "C:\\Music\\B\\a.flac" },
                { old_path: movedSongB.path, new_path: "C:\\Music\\B\\b.flac" },
            ],
        });
        firstSongSpy.mockImplementation((folderPath: string) => {
            const coverByFolder: Record<string, string | null> = {
                "C:\\Music\\A": failedSong.path,
                "C:\\Music\\B": "C:\\Music\\B\\a.flac",
            };
            return Promise.resolve(coverByFolder[folderPath] ?? null);
        });

        const fileManager = buildFileManager({ removeFromHistory, showToast });

        const movedCount = await fileManager.moveFilesToFolder(
            [movedSongA.path, movedSongB.path, failedSong.path],
            "C:\\Music\\B",
        );

        expect(movedCount).toBe(2);
        expect(libraryStore.songList.map((song) => song.path)).toEqual([
            failedSong.path,
        ]);
        expect(libraryStore.libraryHierarchy[0]?.song_count).toBe(1);
        expect(libraryStore.libraryHierarchy[0]?.cover_song_path).toBe(
            failedSong.path,
        );
        expect(libraryStore.libraryHierarchy[1]?.song_count).toBe(2);
        expect(libraryStore.libraryHierarchy[1]?.cover_song_path).toBe(
            "C:\\Music\\B\\a.flac",
        );
    });
});

describe("deleteFromDisk：从磁盘删除歌曲", () => {
    it("删除后同步清理当前播放与各队列", async () => {
        const libraryStore = useLibraryStore();
        const collectionsStore = useCollectionsStore();
        const playbackStore = usePlaybackStore();
        const removeFromHistory = vi.fn().mockResolvedValue(undefined);
        const showToast = vi.fn();

        const deletedSong = makeSong({
            path: "C:\\Music\\A\\deleted.flac",
            name: "deleted.flac",
            title: "Deleted",
        });
        const keptSong = makeSong({
            path: "C:\\Music\\A\\kept.flac",
            name: "kept.flac",
            title: "Kept",
        });

        libraryStore.librarySongs = [keptSong];
        libraryStore.songList = [keptSong];
        collectionsStore.favoritePaths = [deletedSong.path, keptSong.path];
        collectionsStore.playlists = [
            {
                id: "playlist-1",
                name: "Playlist",
                songPaths: [deletedSong.path, keptSong.path],
            },
        ];
        playbackStore.playQueue = [deletedSong, keptSong];
        playbackStore.tempQueue = [deletedSong];
        playbackStore.currentSong = deletedSong;
        deleteFileSpy.mockResolvedValue(undefined);

        const fileManager = buildFileManager({ removeFromHistory, showToast });

        await fileManager.deleteFromDisk(deletedSong);

        expect(playbackStore.playQueue.map((song) => song.path)).toEqual([
            keptSong.path,
        ]);
        expect(playbackStore.tempQueue).toEqual([]);
        expect(playbackStore.currentSong).toBeNull();
        expect(collectionsStore.favoritePaths).toEqual([keptSong.path]);
        expect(collectionsStore.playlists[0]?.songPaths).toEqual([
            keptSong.path,
        ]);
        expect(removeFromHistory).toHaveBeenCalledWith([deletedSong.path]);
    });
});
