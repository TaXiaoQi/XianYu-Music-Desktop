import {
    computed,
    nextTick,
    onUnmounted,
    ref,
    watch,
    type ComputedRef,
    type Ref,
} from "vue";
import { storeToRefs } from "pinia";
import type { FolderNode, Song } from "../types";
import { usePlaybackStore } from "../features/playback/store";
import {
    INDEX_KEYS,
    getAlphabetIndexKey,
    type AlphabetIndexKey,
} from "../utils/alphabetIndex";
import { normalizePath, getParentFolderPath } from "../utils/path";

// 行高与索引条交互的固定参数
const ROW_HEIGHT_PX = 72;
const INDEX_BAR_PROXIMITY_PX = 72;
const AUTO_HIDE_DELAY_MS = 500;
const TOP_BUTTON_VIEW_MODES = new Set([
    "all",
    "playlist",
    "artist",
    "album",
    "favorites",
    "recent",
    "dailyRecommend",
]);
const SCROLL_NAV_ROUTES = new Set([
    "/",
    "/favorites",
    "/recent",
    "/search",
    "/online-detail",
]);

interface UseSongTableAlphabetIndexOptions { // 实现
    songs: Ref<Song[]>;
    scrollTop: Ref<number>;
    containerHeight: Ref<number>;
    containerRef: Ref<HTMLElement | null>;
    rootRef: Ref<HTMLElement | null>;
    listOffsetTop?: Ref<number>;
    routePath: Ref<string> | ComputedRef<string>;
    currentViewMode: Ref<string>;
    localSortMode: Ref<string>;
    folderSortMode: Ref<string>;
    activeRootPath: Ref<string | null>;
    currentFolderFilter: Ref<string>;
    folderTree: Ref<FolderNode[]>;
    refreshFolder: (folderPath: string) => Promise<unknown>;
    expandFolderPath: (path: string) => Promise<unknown>;
}

export function useSongTableAlphabetIndex(
    options: UseSongTableAlphabetIndexOptions,
) {
    const {
        songs,
        scrollTop,
        containerHeight,
        containerRef,
        rootRef,
        routePath,
        currentViewMode,
        localSortMode,
        folderSortMode,
        activeRootPath,
        currentFolderFilter,
        folderTree,
        refreshFolder,
        expandFolderPath,
        listOffsetTop,
    } = options;

    const playbackStore = usePlaybackStore();
    const { currentSong } = storeToRefs(playbackStore);

    const indexBarRef = ref(null as HTMLElement | null);
    const isIndexDragging = ref<boolean>(false);
    const dragIndexKey = ref(null as AlphabetIndexKey | null);
    const hoverIndexKey = ref(null as AlphabetIndexKey | null);
    const isIndexBarVisible = ref<boolean>(false);
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    /** 列表相对自身的滚动位置（扣除列表顶部与容器顶部的偏移） */
    const listViewportTop = computed<number>(() => {
        const offset = listOffsetTop?.value ?? 0;
        return scrollTop.value > offset ? scrollTop.value - offset : 0;
    });

    type SongLabelGetter = (song: Song) => string;

    /** 当前视图/排序下用于计算字母索引的标签取值函数；不适用时为 null */
    const indexLabelGetter = computed<SongLabelGetter | null>(() => {
        const titleLabel = (song: Song) => song.title || song.name;

        if (currentViewMode.value === "all") {
            return localSortMode.value === "title" ? titleLabel : null;
        }
        if (currentViewMode.value === "folder") {
            if (folderSortMode.value === "name") {
                return (song: Song) => song.name;
            }
            if (folderSortMode.value === "title") {
                return titleLabel;
            }
        }
        return null;
    });

    const showAlphabetIndex = computed(() => {
        if (routePath.value !== "/" || songs.value.length === 0) {
            return false;
        }
        return indexLabelGetter.value !== null;
    });

    /** 每个字母索引键对应的首个歌曲行号 */
    const firstSongIndexByKey = computed(() => {
        const indexMap: Map<AlphabetIndexKey, number> = new Map();
        const labelOf = indexLabelGetter.value;
        if (!labelOf) return indexMap;

        const songItems = songs.value;
        for (let index = 0; index < songItems.length; index += 1) {
            const key = getAlphabetIndexKey(labelOf(songItems[index]));
            if (!indexMap.has(key)) indexMap.set(key, index);
        }

        return indexMap;
    });

    /** 视口顶部当前停留的行的索引键 */
    const activeIndexKey = computed<AlphabetIndexKey | null>(() => {
        const labelOf = indexLabelGetter.value;
        if (!labelOf || songs.value.length === 0) {
            return null;
        }

        const rawIndex = Math.floor(listViewportTop.value / ROW_HEIGHT_PX);
        const visibleIndex = Math.min(
            songs.value.length - 1,
            Math.max(0, rawIndex),
        );
        return getAlphabetIndexKey(labelOf(songs.value[visibleIndex]));
    });

    const currentSongIndex = computed(() => {
        const playingPath = currentSong.value?.path;
        if (!playingPath) {
            return -1;
        }
        return songs.value.findIndex((song) => song.path === playingPath);
    });

    /** 找到包含目标路径的根目录（按路径前缀匹配，取最长者） */
    const findOwningRootPath = (targetPath: string) => {
        const wanted = normalizePath(targetPath);
        const owningRoots = folderTree.value
            .map((node: FolderNode) => node.path)
            .filter((candidate) => {
                const rootNorm = normalizePath(candidate);
                return wanted === rootNorm || wanted.startsWith(`${rootNorm}/`);
            })
            .sort((a, b) => normalizePath(b).length - normalizePath(a).length);

        return owningRoots[0] || null;
    };

    /** 当前播放曲目是否可在本视图定位（已在列表中，或可切到其所在文件夹） */
    const canLocateCurrentSong = computed<boolean>(() => {
        const playingPath = currentSong.value?.path;
        if (!playingPath) return false;
        if (currentSongIndex.value >= 0) return true;
        if (currentViewMode.value !== "folder") return false;

        const owningRoot = findOwningRootPath(getParentFolderPath(playingPath));
        return owningRoot !== null;
    });

    const isCurrentSongVisibleInViewport = computed(() => {
        if (currentSongIndex.value < 0) return false;

        const viewportHeight = Math.max(
            containerHeight.value,
            containerRef.value?.clientHeight ?? 0,
        );
        if (viewportHeight <= 0) return false;

        const viewportTop = listViewportTop.value;
        const rowTop = currentSongIndex.value * ROW_HEIGHT_PX;
        const rowBottom = rowTop + ROW_HEIGHT_PX;

        return rowBottom > viewportTop && rowTop < viewportTop + viewportHeight;
    });

    const showLocateCurrentSongButton = computed(() => {
        return (
            SCROLL_NAV_ROUTES.has(routePath.value) &&
            canLocateCurrentSong.value &&
            !isCurrentSongVisibleInViewport.value
        );
    });

    const showScrollToTopButton = computed(() => {
        if (!SCROLL_NAV_ROUTES.has(routePath.value)) {
            return false;
        }

        const isOnlineContext = ["/search", "/online-detail"].includes(
            routePath.value,
        );
        if (
            !isOnlineContext &&
            !TOP_BUTTON_VIEW_MODES.has(currentViewMode.value)
        ) {
            return false;
        }

        return songs.value.length > 0 && listViewportTop.value > ROW_HEIGHT_PX;
    });

    const clearHideTimer = (): void => {
        if (hideTimer != null) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
    };

    const showIndexBar = (): void => {
        if (!showAlphabetIndex.value) return;
        clearHideTimer();
        isIndexBarVisible.value = true;
    };

    /** 稍后自动隐藏索引条；拖拽进行中或索引条本就不可见时跳过 */
    const armAutoHide = (): void => {
        clearHideTimer();
        if (!showAlphabetIndex.value || isIndexDragging.value) return;

        hideTimer = setTimeout(() => {
            if (isIndexDragging.value) return;
            isIndexBarVisible.value = false;
        }, AUTO_HIDE_DELAY_MS);
    };

    const flashIndexBarTemporarily = (): void => {
        showIndexBar();
        armAutoHide();
    };

    const jumpToSongIndex = (songIndex: number): void => {
        const container = containerRef.value;
        if (!container) return;

        const scrollDestination =
            songIndex * ROW_HEIGHT_PX + (listOffsetTop?.value ?? 0);
        container.scrollTo({ top: scrollDestination, behavior: "smooth" });
        scrollTop.value = scrollDestination;
    };

    const scrollToTop = (): void => {
        containerRef.value?.scrollTo({ top: 0, behavior: "smooth" });
    };

    /** 把目标文件夹（及其根目录）对应的行滚动到可视范围 */
    const scrollFolderTargetsIntoView = (
        folderPath: string,
        rootPath: string | null,
    ): void => {
        const matchedRows = Array.from(
            document.querySelectorAll<HTMLElement>("[data-folder-path]"),
        ).filter((element) => {
            return (
                element.dataset.folderPath === folderPath ||
                (!!rootPath && element.dataset.folderPath === rootPath)
            );
        });

        matchedRows.forEach((element) => {
            element.scrollIntoView({
                block: "nearest",
                inline: "nearest",
                behavior: "smooth",
            });
        });
    };

    /** 定位当前播放歌曲：先尝试滚动到所在行，否则切换到其所属文件夹后再定位 */
    const scrollToCurrentSong = async (): Promise<void> => {
        const playingPath = currentSong.value?.path;
        if (!playingPath) {
            return;
        }

        showIndexBar();

        const inListIndex = currentSongIndex.value;
        if (inListIndex >= 0) {
            if (
                currentViewMode.value === "folder" &&
                currentFolderFilter.value
            ) {
                scrollFolderTargetsIntoView(
                    currentFolderFilter.value,
                    activeRootPath.value,
                );
            }
            jumpToSongIndex(inListIndex);
            armAutoHide();
            return;
        }

        // 不在当前列表：仅 folder 视图且目标文件夹归属某个根目录时才跨目录定位
        const canSwitchToFolder =
            currentViewMode.value === "folder" &&
            findOwningRootPath(getParentFolderPath(playingPath)) !== null;
        if (!canSwitchToFolder) {
            armAutoHide();
            return;
        }

        const targetFolderPath = getParentFolderPath(playingPath);
        const targetRootPath = findOwningRootPath(targetFolderPath) as string;

        activeRootPath.value = targetRootPath;
        currentFolderFilter.value = targetFolderPath;
        await expandFolderPath(targetFolderPath).then(() =>
            refreshFolder(targetFolderPath),
        );
        await nextTick();
        requestAnimationFrame(() =>
            scrollFolderTargetsIntoView(targetFolderPath, targetRootPath),
        );

        // 等待刷新后重新在列表中查找（期间播放曲目可能已变化）
        const refreshedIndex = songs.value.findIndex(
            (song) => song.path === currentSong.value?.path,
        );
        if (refreshedIndex !== -1) jumpToSongIndex(refreshedIndex);

        armAutoHide();
    };

    const handleIndexHotspotEnter = () => showIndexBar();

    const handleIndexHotspotMove = () => showIndexBar();

    const handleIndexHotspotLeave = () => armAutoHide();

    const handleRootMouseMove = (event: MouseEvent): void => {
        if (!showAlphabetIndex.value || !rootRef.value) return;

        const rootRect = rootRef.value.getBoundingClientRect();
        const nearRightEdge =
            rootRect.right - event.clientX <= INDEX_BAR_PROXIMITY_PX;
        if (nearRightEdge) {
            flashIndexBarTemporarily();
        }
    };

    const handleRootMouseLeave = (): void => {
        armAutoHide();
    };

    /** 目标键没有对应歌曲时，按前后就近原则找最近的有效索引键 */
    const resolveNearestIndexKey = (
        targetKey: AlphabetIndexKey,
    ): AlphabetIndexKey | null => {
        if (firstSongIndexByKey.value.has(targetKey)) return targetKey;

        const targetIndex = INDEX_KEYS.indexOf(targetKey);
        const maxOffset = INDEX_KEYS.length - 1;
        for (let offset = 1; offset <= maxOffset; offset += 1) {
            const forwardCandidate = INDEX_KEYS[targetIndex + offset];
            if (
                forwardCandidate &&
                firstSongIndexByKey.value.has(forwardCandidate)
            ) {
                return forwardCandidate;
            }

            const backwardCandidate = INDEX_KEYS[targetIndex - offset];
            if (
                backwardCandidate &&
                firstSongIndexByKey.value.has(backwardCandidate)
            ) {
                return backwardCandidate;
            }
        }

        return null;
    };

    const navigateToIndexKey = (targetKey: AlphabetIndexKey): void => {
        const nearest = resolveNearestIndexKey(targetKey);
        if (!nearest) return;

        const rowIndex = firstSongIndexByKey.value.get(nearest);
        if (
            rowIndex === undefined ||
            rowIndex < 0 ||
            rowIndex >= songs.value.length
        )
            return;

        jumpToSongIndex(rowIndex);
    };

    /** 拖拽索引条时按纵坐标换算命中的索引键并跳转 */
    const updateDragIndexFromPoint = (clientY: number): void => {
        const bar = indexBarRef.value;
        if (!bar) return;

        const rect = bar.getBoundingClientRect();
        const clampedY = Math.max(0, Math.min(rect.height, clientY - rect.top));
        const slotHeight = Math.max(rect.height / INDEX_KEYS.length, 1);
        const slotIndex = Math.min(
            INDEX_KEYS.length - 1,
            Math.floor(clampedY / slotHeight),
        );

        const slotKey: AlphabetIndexKey = INDEX_KEYS[slotIndex];
        dragIndexKey.value = slotKey;
        navigateToIndexKey(slotKey);
    };

    const handleGlobalIndexPointerMove = (event: PointerEvent): void => {
        if (!isIndexDragging.value) return;
        updateDragIndexFromPoint(event.clientY);
    };

    const bindIndexDragListeners = (): void => {
        window.addEventListener("pointermove", handleGlobalIndexPointerMove);
        window.addEventListener("pointerup", stopIndexDrag);
        window.addEventListener("pointercancel", stopIndexDrag);
    };

    const unbindIndexDragListeners = (): void => {
        window.removeEventListener("pointermove", handleGlobalIndexPointerMove);
        window.removeEventListener("pointerup", stopIndexDrag);
        window.removeEventListener("pointercancel", stopIndexDrag);
    };

    const stopIndexDrag = (): void => {
        if (!isIndexDragging.value) return;

        isIndexDragging.value = false;
        dragIndexKey.value = null;
        unbindIndexDragListeners();
        armAutoHide();
    };

    const handleIndexPointerDown = (
        event: PointerEvent,
        key: AlphabetIndexKey,
    ): void => {
        if (!showAlphabetIndex.value) return;

        isIndexDragging.value = true;
        showIndexBar();
        dragIndexKey.value = key;
        navigateToIndexKey(dragIndexKey.value!);
        bindIndexDragListeners();
        const captureTarget = event.currentTarget as HTMLElement | null;
        captureTarget?.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    };

    watch(
        showAlphabetIndex,
        (visible) => {
            clearHideTimer();
            if (visible) {
                flashIndexBarTemporarily();
                return;
            }
            isIndexBarVisible.value = false;
            hoverIndexKey.value = null;
        },
        { immediate: true },
    );

    onUnmounted(() => {
        stopIndexDrag();
        clearHideTimer();
    });

    return {
        showAlphabetIndex,
        firstSongIndexByKey,
        activeIndexKey,
        indexBarRef,
        isIndexDragging,
        dragIndexKey,
        hoverIndexKey,
        isIndexBarVisible,
        canLocateCurrentSong,
        showLocateCurrentSongButton,
        showScrollToTopButton,
        handleIndexHotspotEnter,
        handleIndexHotspotMove,
        handleIndexHotspotLeave,
        handleRootMouseMove,
        handleRootMouseLeave,
        handleIndexPointerDown,
        showIndexBar,
        scrollToCurrentSong,
        scrollToTop,
    };
}
