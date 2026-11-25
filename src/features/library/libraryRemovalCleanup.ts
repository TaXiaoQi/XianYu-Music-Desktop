import { useCollectionsStore } from "../collections/store";
import { useLibraryStore } from "./store";
import { usePlaybackStore } from "../playback/store";
import type { Song } from "../../types";
import { tauriInvoke } from "../../services/tauri/invoke";
import { normalizePath } from "../../utils/path";

interface CleanupRemovedLibrarySongPathsOptions {
    removedPaths: string[];
    removedFolderPath?: string;
    stopPlayback?: () => Promise<void> | void;
    removeFromHistory?: (songPaths: string[]) => Promise<void> | void;
    removeSongStatistics?: (songPaths: string[]) => Promise<void> | void;
    clearCaches?: (songPaths: string[]) => Promise<void> | void;
}

/** 归一化匹配交给后端完成；空路径沿用旧行为直接判否 */
export const isPathInFolderScope = (
    folderPath: string,
    path: string,
): Promise<boolean> => {
    if (!folderPath || !path) {
        return Promise.resolve(false);
    }

    return tauriInvoke("path_within_root_scope", {
        candidate: path,
        root: folderPath,
    });
};

/** 批量收集位于 folder 范围内的歌曲路径（单次 IPC，保持歌曲原顺序并去重） */
export const collectSongPathsInFolderScope = async (
    songs: Song[],
    folderPath: string,
): Promise<string[]> => {
    if (!folderPath) {
        return [];
    }

    const candidatePaths = [
        ...new Set(
            songs
                .map((song) => song?.path)
                .filter((path): path is string => !!path),
        ),
    ];
    if (candidatePaths.length === 0) {
        return [];
    }

    const inScopePaths = await tauriInvoke("filter_paths_within_folder", {
        folderPath,
        paths: candidatePaths,
    });
    const inScopeSet = new Set(inScopePaths);

    const seen = new Set<string>();
    const paths: string[] = [];

    songs.forEach((song) => {
        if (!song?.path || !inScopeSet.has(song.path)) {
            return;
        }

        const normalizedPath = normalizePath(song.path);
        if (seen.has(normalizedPath)) {
            return;
        }

        seen.add(normalizedPath);
        paths.push(song.path);
    });

    return paths;
};

const dedupePaths = (paths: string[]) => {
    const seen = new Set<string>();
    const deduped: string[] = [];

    paths.forEach((path) => {
        const normalizedPath = normalizePath(path);
        if (!normalizedPath || seen.has(normalizedPath)) {
            return;
        }

        seen.add(normalizedPath);
        deduped.push(path);
    });

    return deduped;
};

export const syncRemovedLibrarySongPreferences = (removedPaths: string[]) => {
    const uniqueRemovedPaths = dedupePaths(removedPaths);
    if (uniqueRemovedPaths.length === 0) {
        return;
    }

    const libraryStore = useLibraryStore();
    const collectionsStore = useCollectionsStore();
    const removedPathSet = new Set(
        uniqueRemovedPaths.map(normalizePath),
    );
    const isRemovedPath = (path: string | null | undefined) =>
        !!path && removedPathSet.has(normalizePath(path));

    collectionsStore.favoritePaths = collectionsStore.favoritePaths.filter(
        (path) => !isRemovedPath(path),
    );
    collectionsStore.playlists.forEach((playlist) => {
        playlist.songPaths = playlist.songPaths.filter(
            (path) => !isRemovedPath(path),
        );
    });

    libraryStore.localCustomOrder = libraryStore.localCustomOrder.filter(
        (path) => !isRemovedPath(path),
    );
    libraryStore.folderCustomOrder = Object.fromEntries(
        Object.entries(libraryStore.folderCustomOrder).map(
            ([folderPath, paths]) => [
                folderPath,
                paths.filter((path) => !isRemovedPath(path)),
            ],
        ),
    );
};

export const cleanupRemovedLibrarySongPaths = async ({
    removedPaths,
    removedFolderPath = "",
    stopPlayback,
    removeFromHistory,
    removeSongStatistics,
    clearCaches,
}: CleanupRemovedLibrarySongPathsOptions) => {
    const uniqueRemovedPaths = dedupePaths(removedPaths);
    if (uniqueRemovedPaths.length === 0) {
        return;
    }

    const playbackStore = usePlaybackStore();
    const removedPathSet = new Set(
        uniqueRemovedPaths.map(normalizePath),
    );
    const isRemovedPath = (path: string | null | undefined) =>
        !!path && removedPathSet.has(normalizePath(path));
    const isRemovedFolderPath = (path: string | null | undefined) =>
        !!path &&
        !!removedFolderPath &&
        isPathInFolderScope(removedFolderPath, path);

    playbackStore.playQueue = playbackStore.playQueue.filter(
        (song) => !isRemovedPath(song.path),
    );
    playbackStore.tempQueue = playbackStore.tempQueue.filter(
        (song) => !isRemovedPath(song.path),
    );

    const activeSongPath =
        playbackStore.currentSongPath ??
        playbackStore.currentSong?.path ??
        null;
    if (
        isRemovedPath(activeSongPath) ||
        (await isRemovedFolderPath(activeSongPath))
    ) {
        await stopPlayback?.();
        playbackStore.isPlaying = false;
        playbackStore.isSongLoaded = false;
        playbackStore.currentTime = 0;
        playbackStore.currentSong = null;
        playbackStore.currentCover = "";
        playbackStore.currentCoverPath = "";
        playbackStore.currentCoverFull = "";
    }

    syncRemovedLibrarySongPreferences(uniqueRemovedPaths);

    const collectionsStore = useCollectionsStore();
    collectionsStore.recentSongs = collectionsStore.recentSongs.filter(
        (item) => !isRemovedPath(item.path),
    );

    await removeFromHistory?.(uniqueRemovedPaths);
    await removeSongStatistics?.(uniqueRemovedPaths);
    await clearCaches?.(uniqueRemovedPaths);
};
