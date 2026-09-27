import { ref, onMounted, onUnmounted, Ref } from 'vue';
import { storeToRefs } from 'pinia';

import { dragSession } from './dragState';
import { usePlayer } from '../features/playback';
import type { Song } from '../types';
import { useToast } from './toast';
import { useCollectionsStore } from '../features/collections/store';

// 行高与拖拽相关的固定参数
const ROW_HEIGHT_PX = 72;
const AUTO_SCROLL_SPEED = 15;
const EDGE_TRIGGER_PX = 60;
const DRAG_ACTIVATE_DISTANCE = 5;
const SELECT_ZONE_RATIO = 0.6;

export function useSongDrag(
    displaySongList: Ref<Song[]>,
    isBatchMode: Ref<boolean>,
    selectedPaths: Ref<Set<string>>,
    songTableRef: Ref<{ containerRef: HTMLElement | null } | null>
) {
    const { addSongsToPlaylist, songList, currentViewMode, currentFolderFilter, updateFolderOrder } = usePlayer();
    const { setPlaylistSortMode, filterCondition } = usePlayer();
    const { updateLocalOrder } = usePlayer();
    const { playlists } = storeToRefs(useCollectionsStore());

    interface ReorderPlan {
        reordered: string[];
        changed: boolean;
    }

    /**
     * 计算"把 movingPaths 移动到 targetPath 附近"后的新顺序。
     * 没有可移动项、或目标本身就在移动集合里时，视为无需重排。
     * 从上方拖来时插到目标之后，从下方拖来时插到目标之前。
     */
    const reorderPathOrder = (
        pathOrder: string[],
        movingPaths: string[],
        targetPath?: string,
    ): ReorderPlan => {
        const movingSet = new Set(movingPaths);
        const movingInOrder = pathOrder.filter((path) => movingSet.has(path));
        if (movingInOrder.length === 0 || (targetPath && movingSet.has(targetPath))) {
            return { reordered: pathOrder, changed: false };
        }

        const rest = pathOrder.filter((path) => !movingSet.has(path));
        let insertAt = rest.length;

        if (targetPath) {
            const targetIndexInRest = rest.indexOf(targetPath);
            if (targetIndexInRest !== -1) {
                const firstMovingIndex = pathOrder.findIndex((path) => movingSet.has(path));
                const targetIndexInOriginal = pathOrder.indexOf(targetPath);
                const movingFromAbove =
                    firstMovingIndex !== -1 && firstMovingIndex < targetIndexInOriginal;
                insertAt = movingFromAbove ? targetIndexInRest + 1 : targetIndexInRest;
            }
        }

        const merged = [...rest];
        merged.splice(insertAt, 0, ...movingInOrder);
        const changed = merged.some((path, position) => path !== pathOrder[position]);
        return { reordered: merged, changed };
    };

    /** 与 reorderPathOrder 同规则，但直接作用于歌曲数组（按 path 对齐） */
    const reorderSongArrayByPaths = (
        songs: Song[],
        movingPaths: string[],
        targetPath?: string,
    ): { reordered: Song[]; changed: boolean } => {
        const originalPaths = songs.map((song) => song.path);
        const plan = reorderPathOrder(originalPaths, movingPaths, targetPath);
        if (!plan.changed) {
            return { reordered: songs, changed: false };
        }
        const songByPath = new Map(songs.map((song) => [song.path, song] as const));
        return {
            reordered: plan.reordered
                .map((path) => songByPath.get(path))
                .filter((song): song is Song => song !== undefined),
            changed: true,
        };
    };

    let pointerActive = false;
    let originX = 0;
    let originY = 0;

    let autoScrollHandle: number | null = null;

    const stopAutoScroll = () => {
        if (autoScrollHandle) {
            cancelAnimationFrame(autoScrollHandle);
            autoScrollHandle = null;
        }
    };

    /** 沿指定方向持续滚动列表容器，直到指针松开 */
    const startAutoScroll = (direction: 'up' | 'down') => {
        if (autoScrollHandle) return;
        const container = songTableRef.value?.containerRef;
        if (!container) return;

        const step = () => {
            if (!pointerActive) {
                stopAutoScroll();
                return;
            }
            container.scrollTop += direction === 'up' ? -AUTO_SCROLL_SPEED : AUTO_SCROLL_SPEED;
            autoScrollHandle = requestAnimationFrame(step);
        };
        autoScrollHandle = requestAnimationFrame(step);
    };

    /** 指针贴近容器上下边缘时开启/关闭自动滚动 */
    const syncEdgeAutoScroll = (clientY: number, container: HTMLElement) => {
        const rect = container.getBoundingClientRect();
        if (clientY < rect.top + EDGE_TRIGGER_PX) {
            startAutoScroll('up');
        } else if (clientY > rect.bottom - EDGE_TRIGGER_PX) {
            startAutoScroll('down');
        } else {
            stopAutoScroll();
        }
    };

    const lastClickedIndex = ref(-1);
    const selectDragActive = ref(false);
    const selectMode = ref<'select' | 'deselect' | null>(null);

    const isPrimaryDragPointer = (event: PointerEvent): boolean => {
        const isPrimary = event.isPrimary !== false;
        const isLeftButtonMouse = event.pointerType !== 'mouse' || event.button === 0;
        return isPrimary && isLeftButtonMouse;
    };

    /** 批量模式：行左侧区域做框选拖拽，右侧区域按已选集合整体拖动 */
    const applyBatchDragStart = (event: PointerEvent, song: Song, index: number) => {
        const rowEl = event.currentTarget as HTMLElement;
        const rect = rowEl.getBoundingClientRect();

        if ((event.clientX - rect.left) / rect.width >= SELECT_ZONE_RATIO) {
            selectDragActive.value = false;
            if (!selectedPaths.value.has(song.path)) {
                selectedPaths.value.add(song.path);
            }
            dragSession.songs = displaySongList.value.filter((item) =>
                selectedPaths.value.has(item.path),
            );
            dragSession.insertIndex = index;
            return;
        }

        selectDragActive.value = true;
        if (event.shiftKey && lastClickedIndex.value !== -1) {
            const from = Math.min(lastClickedIndex.value, index);
            const to = Math.max(lastClickedIndex.value, index);
            for (let cursor = from; cursor <= to; cursor++) {
                const rowSong = displaySongList.value[cursor];
                if (rowSong) {
                    selectedPaths.value.add(rowSong.path);
                }
            }
        } else {
            if (selectedPaths.value.has(song.path)) {
                selectedPaths.value.delete(song.path);
            } else {
                selectedPaths.value.add(song.path);
            }
            lastClickedIndex.value = index;
        }
        selectMode.value = selectedPaths.value.has(song.path) ? 'select' : 'deselect';
    };

    /** 普通模式：仅特定视图允许发起歌曲拖拽 */
    const applyPlainDragStart = (song: Song, index: number) => {
        const draggableViews = ['folder', 'playlist', 'all', 'artist', 'album', 'genre', 'year'];
        if (draggableViews.includes(currentViewMode.value)) {
            dragSession.type = 'song';
            dragSession.songs = [song];
            dragSession.insertIndex = index;
        }
    };

    const handleTableDragStart = (payload: { event: PointerEvent; song: Song; index: number }) => {
        const { event, song, index } = payload;
        if (!isPrimaryDragPointer(event)) {
            return;
        }

        pointerActive = true;
        originX = event.clientX;
        originY = event.clientY;

        if (isBatchMode.value) {
            applyBatchDragStart(event, song, index);
        } else {
            applyPlainDragStart(song, index);
        }
    };

    /** 解析框选拖拽时指针所在行的下标；越出上下沿时取首/末行 */
    const resolveHoveredRowIndex = (e: PointerEvent, container: HTMLElement): number => {
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const rowEl = target?.closest('[data-index]') as HTMLElement | null;
        if (rowEl) {
            return parseInt(rowEl.dataset.index!, 10);
        }

        const rowElements = container.querySelectorAll('[data-index]');
        if (rowElements.length === 0) {
            return -1;
        }
        const firstRow = rowElements[0] as HTMLElement;
        const lastRow = rowElements[rowElements.length - 1] as HTMLElement;
        if (e.clientY < firstRow.getBoundingClientRect().top) {
            return parseInt(firstRow.dataset.index!, 10);
        }
        return parseInt(lastRow.dataset.index!, 10);
    };

    /** 框选拖拽过程：按锚点到当前行扩展或收缩选区 */
    const handleSelectionDragMove = (e: PointerEvent) => {
        const container = songTableRef.value?.containerRef;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        if (e.clientY < rect.top || e.clientY > rect.bottom) {
            return;
        }

        const hoveredIndex = resolveHoveredRowIndex(e, container);
        if (hoveredIndex === -1) {
            return;
        }
        const currentIndex = Math.max(0, Math.min(displaySongList.value.length - 1, hoveredIndex));

        if (currentIndex !== lastClickedIndex.value) {
            const from = Math.min(lastClickedIndex.value, currentIndex);
            const to = Math.max(lastClickedIndex.value, currentIndex);

            for (let cursor = from; cursor <= to; cursor++) {
                const rowSong = displaySongList.value[cursor];
                if (!rowSong) continue;
                if (selectMode.value === 'select') {
                    selectedPaths.value.add(rowSong.path);
                } else if (selectMode.value === 'deselect') {
                    selectedPaths.value.delete(rowSong.path);
                }
            }
            lastClickedIndex.value = currentIndex;
        }

        syncEdgeAutoScroll(e.clientY, container);
    };

    /** 命中文件夹/歌单投放区时更新会话状态；返回 true 表示事件已被投放区消费 */
    const applyDropTargetHit = (e: PointerEvent): boolean => {
        const target = document.elementFromPoint(e.clientX, e.clientY);

        const folderEl = target?.closest('.folder-drop-target');
        if (folderEl) {
            dragSession.targetFolder = {
                path: folderEl.getAttribute('data-folder-path')!,
                name: folderEl.getAttribute('data-folder-name')!,
            };
            dragSession.targetPlaylist = null;
            dragSession.insertIndex = -1;
            return true;
        }
        dragSession.targetFolder = null;

        const playlistEl = target?.closest('.playlist-drop-target');
        if (playlistEl) {
            dragSession.targetPlaylist = {
                id: playlistEl.getAttribute('data-playlist-id')!,
                name: playlistEl.getAttribute('data-playlist-name')!,
            };
            dragSession.insertIndex = -1;
            return true;
        }
        dragSession.targetPlaylist = null;

        return false;
    };

    /** 纯模式下根据指针在容器内的纵向偏移更新行间隙游标（带迟滞区间防抖） */
    const applyRowGapUpdate = (e: PointerEvent, container: HTMLElement | null | undefined) => {
        if (isBatchMode.value || dragSession.targetFolder || dragSession.targetPlaylist || !container) {
            return;
        }

        const containerRect = container.getBoundingClientRect();
        const insideContainer =
            e.clientX >= containerRect.left && e.clientX <= containerRect.right &&
            e.clientY >= containerRect.top && e.clientY <= containerRect.bottom;
        if (!insideContainer) {
            dragSession.insertIndex = -1;
            return;
        }

        const offsetY = e.clientY - containerRect.top + container.scrollTop;
        let gapIndex = dragSession.insertIndex;
        if (gapIndex === -1) {
            gapIndex = 0;
        }

        const maxIndex = displaySongList.value.length - 1;
        const upTrigger = (gapIndex - 0.5) * ROW_HEIGHT_PX;
        const downTrigger = (gapIndex + 1.5) * ROW_HEIGHT_PX;

        if (offsetY < upTrigger) {
            dragSession.insertIndex = Math.max(0, Math.floor(offsetY / ROW_HEIGHT_PX));
        } else if (offsetY > downTrigger) {
            dragSession.insertIndex = Math.min(maxIndex, Math.floor(offsetY / ROW_HEIGHT_PX));
        }
    };

    const onGlobalPointerMove = (e: PointerEvent) => {
        if (!pointerActive) return;
        if (e.pointerType !== 'mouse') {
            e.preventDefault();
        }

        if (isBatchMode.value && selectDragActive.value) {
            handleSelectionDragMove(e);
            return;
        }

        // 尚未激活时，移动距离超过阈值才进入拖拽状态
        if (!dragSession.active) {
            const travel = Math.sqrt(
                Math.pow(e.clientX - originX, 2) + Math.pow(e.clientY - originY, 2),
            );
            if (travel > DRAG_ACTIVATE_DISTANCE) {
                dragSession.active = true;
                dragSession.showGhost = true;
            }
        }

        if (!dragSession.active) return;

        dragSession.mouseX = e.clientX;
        dragSession.mouseY = e.clientY;

        const container = songTableRef.value?.containerRef;
        if (container) {
            syncEdgeAutoScroll(e.clientY, container);
        }

        if (applyDropTargetHit(e)) {
            return;
        }

        applyRowGapUpdate(e, container);
    };

    const resetDragState = () => {
        dragSession.targetFolder = null;
        dragSession.targetPlaylist = null;
        dragSession.insertIndex = -1;
        dragSession.showGhost = false;
        dragSession.active = false;
    };

    /** 投放到歌单：追加歌曲并按结果提示 */
    const commitSongsToPlaylist = () => {
        const target = dragSession.targetPlaylist!;
        const paths = dragSession.songs.map((item) => item.path);
        const addedCount = addSongsToPlaylist(target.id, paths);
        const message =
            addedCount > 0 ? `已添加 ${addedCount} 首歌曲到 ${target.name}` : '歌曲已存在于歌单';
        useToast().showToast(message, addedCount > 0 ? 'success' : 'info');
        dragSession.showGhost = false;
        dragSession.active = false;
    };

    /** 歌单视图内拖拽：重排当前歌单并切换为自定义排序 */
    const reorderPlaylist = (movingPaths: string[], targetPath: string | undefined) => {
        const playlistId = filterCondition.value;
        const playlist = playlists.value.find((item) => item.id === playlistId);
        if (!playlist) return;

        const visualPaths = displaySongList.value.map((item) => item.path);
        const plan = reorderPathOrder(visualPaths, movingPaths, targetPath);
        if (plan.changed) {
            playlist.songPaths = plan.reordered;
            setPlaylistSortMode('custom');
        }
    };

    /** 其余视图：按视图类型分别提交重排结果 */
    const reorderLibrary = (movingPaths: string[], targetPath: string | undefined) => {
        const fullList = [...songList.value];
        const arrayPlan = reorderSongArrayByPaths(fullList, movingPaths, targetPath);
        if (arrayPlan.changed) {
            songList.value = arrayPlan.reordered;
        }

        if (currentViewMode.value === 'folder' && currentFolderFilter.value) {
            const visualPaths = displaySongList.value.map((item) => item.path);
            const folderPlan = reorderPathOrder(visualPaths, movingPaths, targetPath);
            if (folderPlan.changed) {
                updateFolderOrder(currentFolderFilter.value, folderPlan.reordered);
            }
        }

        if (currentViewMode.value === 'all') {
            const visualPaths = displaySongList.value.map((item) => item.path);
            const localPlan = reorderPathOrder(visualPaths, movingPaths, targetPath);
            if (localPlan.changed) {
                updateLocalOrder(localPlan.reordered);
            }
        }
    };

    /** 落到行间隙：按当前视图提交重排 */
    const commitRowReorder = () => {
        const movingSongs = dragSession.songs;
        if (movingSongs.length === 0) {
            dragSession.showGhost = false;
            dragSession.active = false;
            return;
        }

        const movingPaths = movingSongs.map((item) => item.path);
        const targetVisualSong = displaySongList.value[dragSession.insertIndex];
        const targetPath = targetVisualSong?.path;

        if (currentViewMode.value === 'playlist') {
            reorderPlaylist(movingPaths, targetPath);
        } else {
            reorderLibrary(movingPaths, targetPath);
        }

        dragSession.showGhost = false;
        dragSession.active = false;
    };

    const onGlobalPointerEnd = (cancelled = false) => {
        pointerActive = false;
        stopAutoScroll();
        selectDragActive.value = false;
        selectMode.value = null;

        if (cancelled) {
            resetDragState();
            return;
        }

        if (!dragSession.active) return;

        if (dragSession.targetFolder) {
            // 投放目标由 drop 事件处理，这里仅收起拖拽幻影
            dragSession.showGhost = false;
            return;
        }

        if (dragSession.targetPlaylist) {
            commitSongsToPlaylist();
        } else if (dragSession.insertIndex > -1) {
            commitRowReorder();
        } else {
            dragSession.showGhost = false;
            dragSession.active = false;
        }
        dragSession.insertIndex = -1;
        setTimeout(() => {
            dragSession.targetPlaylist = null;
        }, 100);
    };

    const onGlobalPointerUp = () => onGlobalPointerEnd(false);
    const onGlobalPointerCancel = () => onGlobalPointerEnd(true);

    const bindGlobalListeners = () => {
        window.addEventListener('pointermove', onGlobalPointerMove);
        window.addEventListener('pointerup', onGlobalPointerUp);
        window.addEventListener('pointercancel', onGlobalPointerCancel);
    };

    const unbindGlobalListeners = () => {
        stopAutoScroll();
        window.removeEventListener('pointermove', onGlobalPointerMove);
        window.removeEventListener('pointerup', onGlobalPointerUp);
        window.removeEventListener('pointercancel', onGlobalPointerCancel);
    };

    onMounted(bindGlobalListeners);
    onUnmounted(unbindGlobalListeners);

    return {
        handleTableDragStart
    };
}
