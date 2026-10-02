import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import type { Song } from "../types";
import { useLibraryStore } from "../features/library/store";
import { usePlaybackStore } from "../features/playback/store";
import { createLibraryBatch } from "../features/library/libraryBatch";

function makeSong(overrides: Partial<Song> = {}): Song {
    return {
        path: "/music/demo.flac",
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
    };
}

describe("createLibraryBatch", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("strips deleted songs out of source lists, queues and the current song reference", () => {
        const library = useLibraryStore();
        const playback = usePlaybackStore();
        const survivingSong = makeSong({
            path: "/music/keep.flac",
            title: "Keep",
        });
        const deletedSong = makeSong({
            path: "/music/remove.flac",
            title: "Remove",
        });

        library.librarySongs = [survivingSong];
        library.songList = [survivingSong, deletedSong];
        playback.playQueue = [survivingSong, deletedSong];
        playback.tempQueue = [deletedSong];
        playback.currentSong = deletedSong;

        const libraryBatch = createLibraryBatch({
            createSongLookup: (fallbackSongs: Song[] = []): Map<string, Song> =>
                new Map(
                    [...fallbackSongs, ...library.canonicalSongs]
                        .filter((song) => song?.path)
                        .map((song) => [song.path, song] as const),
                ),
        });

        libraryBatch.refreshStateSongReferences();

        expect(library.songList.map((song) => song.path)).toEqual([
            survivingSong.path,
        ]);
        expect(playback.playQueue.map((song) => song.path)).toEqual([
            survivingSong.path,
        ]);
        expect(playback.tempQueue).toEqual([]);
        expect(playback.currentSong).toBeNull();
    });
});
