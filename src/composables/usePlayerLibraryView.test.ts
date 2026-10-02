import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import type { Song } from "../types";
import { useCollectionsStore } from "../features/collections/store";
import { useLibraryStore } from "../features/library/store";
import { useNavigationStore } from "../shared/stores/navigation";
import { usePlayerLibraryView } from "../features/library/usePlayerLibraryView";
import { compareSongPathsByTrackNumber } from "../features/library/playerLibraryViewShared";

const tauriInvokeMock = vi.fn(); // 实现

vi.mock("../services/tauri/invoke", () => ({
    tauriInvoke: (...args: unknown[]) => tauriInvokeMock(...args),
}));

// 标准歌曲构造器：与后端返回的 Song 形状保持一致。
const buildSong = (overrides: Partial<Song> = {}): Song => ({
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
    added_at: 1,
    ...overrides,
});

// 依次取有效艺人名列表，逐级回退到原始字段。
const pickArtistNames = (song: Song): string[] => {
    if (song.effective_artist_names.length > 0)
        return song.effective_artist_names;
    if (song.artist_names.length > 0) return song.artist_names;
    return [song.artist];
};

// 专辑聚合键：优先使用预计算值，缺失时按"专辑::艺人"拼出。
const albumKeyOf = (song: Song): string => {
    if (song.album_key) return song.album_key;
    const albumPart = song.album || "Unknown";
    const artistPart = song.album_artist || song.artist || "Unknown";
    return `${albumPart}::${artistPart}`;
};

// 粗略复刻视图层的搜索匹配规则：命中任一文本字段即视为匹配。
const matchesSearchText = (song: Song, query: string) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    const fields = [
        song.name,
        song.title,
        song.artist,
        song.album,
        song.album_artist,
        ...pickArtistNames(song),
    ];
    return fields.some((field) => field?.toLowerCase().includes(needle));
};

// 标题排序比较器（zh-CN 语序）。
const byTitle = (a: Song, b: Song) =>
    (a.title || a.name).localeCompare(b.title || b.name, "zh-CN");

// 各排序模式对应的比较器；未登记的模式保持原顺序。
const SORT_COMPARATORS: Record<string, (a: Song, b: Song) => number> = {
    title: byTitle,
    artist: (a, b) => a.artist.localeCompare(b.artist, "zh-CN"),
    added_at: (a, b) => (b.added_at || 0) - (a.added_at || 0),
    added_at_asc: (a, b) => (a.added_at || 0) - (b.added_at || 0),
    file_modified_at: (a, b) =>
        (b.file_modified_at || 0) - (a.file_modified_at || 0),
    file_modified_at_asc: (a, b) =>
        (a.file_modified_at || 0) - (b.file_modified_at || 0),
};

const applySortMode = (songs: Song[], mode: string) => {
    const comparator = SORT_COMPARATORS[mode];
    return comparator ? [...songs].sort(comparator) : [...songs];
};

// 判断 child 是否为 parent 文件夹的直接子项（统一分隔符后比较）。
const isImmediateChildOf = (parentPath: string, childPath: string) => {
    const parent = parentPath.replace(/\\/g, "/").replace(/\/$/, "");
    const child = childPath.replace(/\\/g, "/");
    const cut = child.lastIndexOf("/");
    return cut > -1 && child.slice(0, cut) === parent;
};

const indexByPath = (songs: Song[]) =>
    new Map(songs.map((item) => [item.path, item] as const));

// 等待一轮微任务/宏任务，让视图层的异步加载落地。
const settleTasks = () => new Promise((resolve) => setTimeout(resolve, 0));

const readFavoritePaths = (payload?: Record<string, unknown>) =>
    new Set((payload?.favoritePaths as string[] | undefined) ?? []);

const pickByArtist = (songs: Song[], artistName: string) =>
    songs
        .filter((item) => pickArtistNames(item).includes(artistName))
        .sort(byTitle);

interface InvokeContext {
    songs: Song[];
    lookup: Map<string, Song>;
}

type CommandHandler = (
    ctx: InvokeContext,
    payload?: Record<string, unknown>,
) => unknown;

// 常规命令的本地模拟实现：语义对齐后端查询接口。
const COMMAND_HANDLERS: Record<string, CommandHandler> = {
    get_library_song_paths_for_all_view: ({ songs }, payload) => {
        const query = String(payload?.query ?? "")
            .trim()
            .toLowerCase();
        const artistFilter = String(payload?.artistFilter ?? "");
        const albumFilter = String(payload?.albumFilter ?? "");
        const sortMode = String(payload?.sortMode ?? "title");
        let matched = songs.filter((item) => matchesSearchText(item, query));
        if (artistFilter) {
            matched = matched.filter((item) =>
                pickArtistNames(item).includes(artistFilter),
            );
        }
        if (albumFilter) {
            matched = matched.filter(
                (item) => albumKeyOf(item) === albumFilter,
            );
        }
        return applySortMode(matched, sortMode).map((item) => item.path);
    },

    get_library_song_paths_by_artist: ({ songs }, payload) =>
        pickByArtist(songs, String(payload?.artistName ?? "")).map(
            (item) => item.path,
        ),

    get_library_song_paths_by_album: ({ songs }, payload) =>
        songs
            .filter(
                (item) => albumKeyOf(item) === String(payload?.albumKey ?? ""),
            )
            .sort(byTitle)
            .map((item) => item.path),

    get_favorite_artist_catalog: ({ songs }, payload) => {
        const favorites = readFavoritePaths(payload);
        const tally = new Map<
            string,
            { count: number; firstSongPath: string }
        >();
        songs
            .filter((item) => favorites.has(item.path))
            .forEach((item) => {
                pickArtistNames(item).forEach((name) => {
                    const entry = tally.get(name) ?? {
                        count: 0,
                        firstSongPath: item.path,
                    };
                    entry.count += 1;
                    tally.set(name, entry);
                });
            });
        return Array.from(tally.entries()).map(([name, value]) => ({
            ...value,
            name,
        }));
    },

    get_favorite_album_catalog: ({ songs }, payload) => {
        const favorites = readFavoritePaths(payload);
        const albums = new Map<
            string,
            {
                key: string;
                name: string;
                count: number;
                artist: string;
                firstSongPath: string;
            }
        >();
        songs
            .filter((item) => favorites.has(item.path))
            .forEach((item) => {
                const key = albumKeyOf(item);
                const entry = albums.get(key) ?? {
                    key,
                    name: item.album,
                    count: 0,
                    artist: item.album_artist || item.artist,
                    firstSongPath: item.path,
                };
                entry.count += 1;
                albums.set(key, entry);
            });
        return Array.from(albums.values());
    },

    get_favorite_song_paths_view: ({ songs }, payload) => {
        const favorites = readFavoritePaths(payload);
        const query = String(payload?.query ?? "")
            .trim()
            .toLowerCase();
        const sortMode = String(payload?.sortMode ?? "title");
        const detailType = payload?.detailFilterType as
            "artist" | "album" | undefined;
        const detailValue = payload?.detailFilterValue as string | undefined;
        let matched = songs.filter(
            (item) =>
                favorites.has(item.path) && matchesSearchText(item, query),
        );
        if (detailType === "artist" && detailValue) {
            matched = matched.filter((item) =>
                pickArtistNames(item).includes(detailValue),
            );
        }
        if (detailType === "album" && detailValue) {
            matched = matched.filter(
                (item) => albumKeyOf(item) === detailValue,
            );
        }
        return applySortMode(matched, sortMode).map((item) => item.path);
    },

    get_recent_song_paths_view: ({ lookup }, payload) => {
        const entries =
            (payload?.recentEntries as
                { songPath: string; playedAt: number }[] | undefined) ?? [];
        const query = String(payload?.query ?? "")
            .trim()
            .toLowerCase();
        const sortMode = String(payload?.sortMode ?? "title");
        const matched = Array.from(
            new Set(entries.map((item) => item.songPath)),
        )
            .map((path) => lookup.get(path))
            .filter((item): item is Song => !!item)
            .filter((item) => matchesSearchText(item, query));
        return applySortMode(matched, sortMode).map((item) => item.path);
    },

    get_library_song_paths_for_folder_view: ({ songs, lookup }, payload) => {
        const folderPath = String(payload?.folderPath ?? "");
        const query = String(payload?.query ?? "")
            .trim()
            .toLowerCase();
        const sortMode = String(payload?.sortMode ?? "title");
        const matched = songs
            .filter((item) => isImmediateChildOf(folderPath, item.path))
            .filter((item) => matchesSearchText(item, query));
        if (sortMode === "track_number") {
            return [...matched]
                .sort((left, right) =>
                    compareSongPathsByTrackNumber(
                        left.path,
                        right.path,
                        lookup,
                    ),
                )
                .map((item) => item.path);
        }
        return applySortMode(
            matched,
            sortMode === "name" ? "title" : sortMode,
        ).map((item) => item.path);
    },
};

// "all 视图缓存过期"场景专用：部分命令走特殊逻辑，其余回落到共享实现。
interface StaleInvokeContext extends InvokeContext {
    stalePaths: string[];
}

type StaleCommandHandler = (
    ctx: StaleInvokeContext,
    payload?: Record<string, unknown>,
) => unknown;

const STALE_VIEW_HANDLERS: Record<string, StaleCommandHandler> = {
    get_library_song_paths_for_all_view: ({ stalePaths }) => stalePaths,

    get_favorite_song_paths_view: ({ songs }, payload) => {
        const favorites = readFavoritePaths(payload);
        return songs
            .filter((item) => favorites.has(item.path))
            .map((item) => item.path);
    },

    get_recent_song_paths_view: ({ lookup }, payload) => {
        const entries =
            (payload?.recentEntries as
                { songPath: string; playedAt: number }[] | undefined) ?? [];
        return entries
            .map((item) => lookup.get(item.songPath))
            .filter((item): item is Song => !!item)
            .map((item) => item.path);
    },
};

const defaultInvoke = async (
    command: string,
    payload?: Record<string, unknown>,
) => {
    const songs = useLibraryStore().canonicalSongs;
    const ctx: InvokeContext = { songs, lookup: indexByPath(songs) };
    const handler = COMMAND_HANDLERS[command];
    return handler ? handler(ctx, payload) : [];
};

describe("player library view", () => {
    beforeEach(() => {
        tauriInvokeMock.mockImplementation(defaultInvoke);

        setActivePinia(createPinia());
        Object.assign(useLibraryStore(), {
            artistSortMode: "count",
            albumSortMode: "artist",
            artistCustomOrder: [],
            albumCustomOrder: [],
            folderSortMode: "title",
            folderCustomOrder: {},
            localSortMode: "title",
            localCustomOrder: [],
        });
        useCollectionsStore().playlistSortMode = "custom";
    });

    // 每个用例以标题为键登记，统一循环注册，保证与逐个 it 声明等价。
    const cases: Record<string, () => Promise<void>> = {
        "filters folder songs to direct children and keeps custom folder order":
            async () => {
                const library = useLibraryStore();
                const nav = useNavigationStore();
                const trackA = buildSong({
                    path: "/music/root/alpha.flac",
                    title: "Alpha",
                    artist: "A",
                });
                const trackB = buildSong({
                    path: "/music/root/beta.flac",
                    title: "Beta",
                    artist: "B",
                });
                const nestedTrack = buildSong({
                    path: "/music/root/live/gamma.flac",
                    title: "Gamma",
                    artist: "C",
                });

                library.songList = [trackA, trackB, nestedTrack];
                nav.currentViewMode = "folder";
                nav.currentFolderFilter = "/music/root";
                library.folderSortMode = "custom";
                library.folderCustomOrder = {
                    "/music/root": [trackB.path, trackA.path],
                };

                const view = usePlayerLibraryView();
                await settleTasks();

                expect(
                    view.displaySongList.value.map((item) => item.path),
                ).toEqual([trackB.path, trackA.path]);
            },

        "lists favorite songs on the songs tab and keeps collection tabs song-free":
            async () => {
                const library = useLibraryStore();
                const collections = useCollectionsStore();
                const nav = useNavigationStore();
                const zebraTrack = buildSong({
                    path: "/music/zebra.flac",
                    title: "Zebra",
                    name: "zebra.flac",
                    artist: "Target Artist",
                    artist_names: ["Target Artist"],
                    effective_artist_names: ["Target Artist"],
                    added_at: 2,
                });
                const alphaTrack = buildSong({
                    path: "/music/alpha.flac",
                    title: "Alpha",
                    name: "alpha.flac",
                    artist: "Target Artist",
                    artist_names: ["Target Artist"],
                    effective_artist_names: ["Target Artist"],
                    added_at: 3,
                });
                const outsiderTrack = buildSong({
                    path: "/music/other.flac",
                    title: "Other",
                    artist: "Other Artist",
                    artist_names: ["Other Artist"],
                    effective_artist_names: ["Other Artist"],
                    added_at: 1,
                });

                library.librarySongs = [zebraTrack, alphaTrack, outsiderTrack];
                collections.favoritePaths = [
                    zebraTrack.path,
                    alphaTrack.path,
                    outsiderTrack.path,
                ];
                nav.currentViewMode = "favorites";
                nav.favTab = "songs";
                library.localSortMode = "title";

                const view = usePlayerLibraryView();
                await settleTasks();

                expect(
                    view.displaySongList.value.map((item) => item.title),
                ).toEqual(["Alpha", "Other", "Zebra"]);

                nav.favTab = "playlists";
                await settleTasks();
                expect(view.displaySongList.value).toEqual([]);

                nav.favTab = "albums";
                await settleTasks();
                expect(view.displaySongList.value).toEqual([]);
            },

        "resolves recent songs from path-backed history entries": async () => {
            const library = useLibraryStore();
            const collections = useCollectionsStore();
            const nav = useNavigationStore();
            const trackOne = buildSong({
                path: "/music/alpha.flac",
                title: "Alpha",
                added_at: 3,
            });
            const trackTwo = buildSong({
                path: "/music/beta.flac",
                title: "Beta",
                added_at: 2,
            });

            library.librarySongs = [trackOne, trackTwo];
            collections.recentSongs = [
                { path: trackTwo.path, playedAt: 2 },
                { path: "/music/missing.flac", playedAt: 3 },
                { path: trackOne.path, playedAt: 1 },
            ];
            nav.currentViewMode = "recent";
            library.localSortMode = "title";

            const view = usePlayerLibraryView();
            await settleTasks();

            expect(view.displaySongList.value.map((item) => item.path)).toEqual(
                [trackOne.path, trackTwo.path],
            );
        },

        "sorts local music by file modified time in both directions":
            async () => {
                const library = useLibraryStore();
                const nav = useNavigationStore();
                const olderTrack = buildSong({
                    path: "/music/old.flac",
                    title: "Old",
                    file_modified_at: 10,
                });
                const newerTrack = buildSong({
                    path: "/music/new.flac",
                    title: "New",
                    file_modified_at: 20,
                });

                library.librarySongs = [olderTrack, newerTrack];
                nav.currentViewMode = "all";
                library.localSortMode = "file_modified_at";

                const view = usePlayerLibraryView();
                await settleTasks();

                expect(
                    view.displaySongList.value.map((item) => item.path),
                ).toEqual([newerTrack.path, olderTrack.path]);

                library.localSortMode = "file_modified_at_asc";
                await settleTasks();

                expect(
                    view.displaySongList.value.map((item) => item.path),
                ).toEqual([olderTrack.path, newerTrack.path]);
            },

        "updates local music immediately after deletion even when the cached all-view paths stay stale":
            async () => {
                const library = useLibraryStore();
                const nav = useNavigationStore();
                const alpha = buildSong({
                    path: "/music/alpha.flac",
                    title: "Alpha",
                });
                const beta = buildSong({
                    path: "/music/beta.flac",
                    title: "Beta",
                });
                const stalePaths = [alpha.path, beta.path];

                tauriInvokeMock.mockImplementation(
                    async (
                        command: string,
                        payload?: Record<string, unknown>,
                    ) => {
                        const songs = library.canonicalSongs;
                        const ctx: StaleInvokeContext = {
                            songs,
                            lookup: indexByPath(songs),
                            stalePaths,
                        };
                        const override = STALE_VIEW_HANDLERS[command];
                        if (override) {
                            return override(ctx, payload);
                        }
                        const shared = COMMAND_HANDLERS[command];
                        return shared ? shared(ctx, payload) : [];
                    },
                );

                library.librarySongs = [alpha, beta];
                nav.currentViewMode = "all";
                library.localSortMode = "title";

                const view = usePlayerLibraryView();
                await settleTasks();

                expect(
                    view.displaySongList.value.map((item) => item.path),
                ).toEqual([alpha.path, beta.path]);

                library.librarySongs = [alpha];
                await settleTasks();

                expect(
                    view.displaySongList.value.map((item) => item.path),
                ).toEqual([alpha.path]);
            },

        "applies album detail sorting rules including track order":
            async () => {
                const library = useLibraryStore();
                const nav = useNavigationStore();
                const discTwo = buildSong({
                    path: "/music/album/disc-two.flac",
                    title: "Disc Two",
                    album: "Detail Album",
                    album_key: "detail-album::artist",
                    added_at: 10,
                    disc_number: "2",
                    track_number: "1",
                });
                const firstTrack = buildSong({
                    path: "/music/album/first-track.flac",
                    title: "First Track",
                    album: "Detail Album",
                    album_key: "detail-album::artist",
                    added_at: 20,
                    disc_number: "1",
                    track_number: "1/10",
                });
                const secondTrack = buildSong({
                    path: "/music/album/second-track.flac",
                    title: "Second Track",
                    album: "Detail Album",
                    album_key: "detail-album::artist",
                    added_at: 30,
                    disc_number: "1",
                    track_number: "2",
                });

                library.librarySongs = [discTwo, secondTrack, firstTrack];
                nav.currentViewMode = "album";
                nav.filterCondition = "detail-album::artist";

                const view = usePlayerLibraryView();
                await settleTasks();

                const expectOrder = (expected: string[]) => {
                    expect(
                        view.displaySongList.value.map((item) => item.path),
                    ).toEqual(expected);
                };

                expectOrder([firstTrack.path, secondTrack.path, discTwo.path]);

                // 依次切换专辑详情排序模式并核对结果顺序。
                const modeSequence: Array<[string, string[]]> = [
                    [
                        "track_number_desc",
                        [discTwo.path, secondTrack.path, firstTrack.path],
                    ],
                    [
                        "added_at",
                        [secondTrack.path, firstTrack.path, discTwo.path],
                    ],
                    [
                        "added_at_asc",
                        [discTwo.path, firstTrack.path, secondTrack.path],
                    ],
                ];
                for (const [mode, expected] of modeSequence) {
                    library.albumDetailSortMode = mode;
                    await settleTasks();
                    expectOrder(expected);
                }
            },

        "applies folder view sorting rules including track order": async () => {
            const library = useLibraryStore();
            const nav = useNavigationStore();
            const discTwo = buildSong({
                path: "/music/folder/disc-two.flac",
                title: "Disc Two",
                added_at: 10,
                disc_number: "2",
                track_number: "1",
            });
            const firstTrack = buildSong({
                path: "/music/folder/first-track.flac",
                title: "First Track",
                added_at: 20,
                disc_number: "1",
                track_number: "1/10",
            });
            const secondTrack = buildSong({
                path: "/music/folder/second-track.flac",
                title: "Second Track",
                added_at: 30,
                disc_number: "1",
                track_number: "2",
            });

            library.librarySongs = [discTwo, secondTrack, firstTrack];
            nav.currentViewMode = "folder";
            nav.currentFolderFilter = "/music/folder";
            library.folderSortMode = "track_number";

            const view = usePlayerLibraryView();
            await settleTasks();

            expect(view.displaySongList.value.map((item) => item.path)).toEqual(
                [firstTrack.path, secondTrack.path, discTwo.path],
            );
        },

        "applies playlist view sorting rules": async () => {
            const library = useLibraryStore();
            const collections = useCollectionsStore();
            const nav = useNavigationStore();

            const alpha = buildSong({
                path: "/music/alpha.flac",
                title: "Alpha",
                added_at: 20,
            });
            const beta = buildSong({
                path: "/music/beta.flac",
                title: "Beta",
                added_at: 10,
            });
            const gamma = buildSong({
                path: "/music/gamma.flac",
                title: "Gamma",
                added_at: 30,
            });

            library.librarySongs = [alpha, beta, gamma];
            collections.playlists = [
                {
                    id: "test-playlist-1",
                    name: "Test Playlist",
                    songPaths: [gamma.path, alpha.path, beta.path],
                },
            ];

            nav.currentViewMode = "playlist";
            nav.filterCondition = "test-playlist-1";

            const view = usePlayerLibraryView();

            const expectOrderUnder = async (
                mode: string,
                expected: string[],
            ) => {
                collections.playlistSortMode = mode;
                await settleTasks();
                expect(
                    view.displaySongList.value.map((item) => item.title),
                ).toEqual(expected);
            };

            await expectOrderUnder("title", ["Alpha", "Beta", "Gamma"]);
            await expectOrderUnder("added_at", ["Gamma", "Alpha", "Beta"]);
            await expectOrderUnder("custom", ["Gamma", "Alpha", "Beta"]);
        },

        "applies playlist view sorting rules when search query is active":
            async () => {
                const library = useLibraryStore();
                const collections = useCollectionsStore();
                const nav = useNavigationStore();

                const alpha = buildSong({
                    path: "/music/alpha.flac",
                    title: "Alpha",
                    name: "alpha.flac",
                    album: "X",
                    added_at: 20,
                });
                const beta = buildSong({
                    path: "/music/beta.flac",
                    title: "Beta",
                    name: "beta.flac",
                    album: "Y",
                    added_at: 10,
                });
                const gamma = buildSong({
                    path: "/music/gamma.flac",
                    title: "Gamma",
                    name: "gamma.flac",
                    album: "Z",
                    added_at: 30,
                });

                library.librarySongs = [alpha, beta, gamma];
                collections.playlists = [
                    {
                        id: "test-playlist-1",
                        name: "Test Playlist",
                        songPaths: [gamma.path, alpha.path, beta.path],
                    },
                ];

                nav.currentViewMode = "playlist";
                nav.filterCondition = "test-playlist-1";
                nav.searchQuery = "alpha";

                const view = usePlayerLibraryView();

                const expectOnlyAlpha = async (mode: string) => {
                    collections.playlistSortMode = mode;
                    await settleTasks();
                    expect(
                        view.displaySongList.value.map((item) => item.title),
                    ).toEqual(["Alpha"]);
                };

                await expectOnlyAlpha("title");
                await expectOnlyAlpha("added_at");
                await expectOnlyAlpha("custom");
            },
    };

    Object.entries(cases).forEach(([title, run]) => {
        it(title, run);
    });
});
