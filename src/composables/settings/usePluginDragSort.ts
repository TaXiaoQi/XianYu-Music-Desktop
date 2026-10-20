import { ref } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import type { PluginSource } from '../../types';
import { getStoredPlugins, reorderPlugins } from '../../services/domain/pluginEngine';
import { findVerticalScrollContainer, getEdgeAutoScrollSpeed, resolveDragTargetIndex } from '../../utils/dragSort';

/**
 * 可排序行：普通插件行，或网盘伪音源行（cloud，按网盘 providerId 区分）。
 * 网盘行的排序位（前方插件数）由调用方持久化到设置。
 */
export interface SortableSourceRow {
  key: string;
  plugin?: PluginSource;
  cloud?: { providerId: string };
}

interface UsePluginDragSortOptions {
  plugins: Ref<PluginSource[]>;
  rows: ComputedRef<SortableSourceRow[]>;
  searchQuery: Ref<string>;
  /** 松手时持久化网盘排序位（前方插件数；null=固定末尾）；本次拖拽不含网盘行时不调用 */
  persistCloudSortIndexes?: (indexes: Record<string, number | null>) => void;
  /** 拖拽过程中各网盘的排序位草稿（实时跟随落点，驱动行列表重排） */
  cloudSortIndexDrafts?: Ref<Record<string, number | null>>;
}

/**
 * 音源列表的拖拽排序（基于 pointer 事件）：
 * 拖动手柄按下后接管 window 的 pointermove/pointerup，边缘自动滚动，
 * 松手时按最终顺序写回插件存储与网盘排序位。
 */
export function usePluginDragSort(options: UsePluginDragSortOptions) {
  const { plugins, rows, searchQuery, persistCloudSortIndexes, cloudSortIndexDrafts } = options;

  const draggingIndex = ref<number | null>(null);
  const listRef = ref<HTMLElement | null>(null);
  const scrollContainer = ref<HTMLElement | null>(null);
  let latestPointerY = 0;
  let autoScrollFrame: number | null = null;
  let draggingContainsCloud = false;

  const resolveTargetIndex = (clientY: number, currentIndex: number): number | null => {
    return resolveDragTargetIndex(listRef.value, '[data-plugin-row]', clientY, currentIndex);
  };

  const moveRowItem = (from: number, to: number) => {
    if (from < 0 || from >= rows.value.length || to < 0 || to >= rows.value.length || from === to) return;
    const sorted = [...rows.value];
    const [moved] = sorted.splice(from, 1);
    sorted.splice(to, 0, moved);
    draggingContainsCloud = sorted.some((row) => row.cloud);
    sorted.forEach((row, i) => {
      if (row.plugin) {
        row.plugin.sortOrder = i;
      } else if (row.cloud && cloudSortIndexDrafts) {
        cloudSortIndexDrafts.value = {
          ...cloudSortIndexDrafts.value,
          [row.cloud.providerId]: i,
        };
      }
    });
  };
  const updateDraggedItemPosition = (clientY: number) => {
    const currentIndex = draggingIndex.value;
    if (currentIndex === null) return;

    const target = resolveTargetIndex(clientY, currentIndex);
    if (target === null || target === currentIndex) return;

    moveRowItem(currentIndex, target);
    draggingIndex.value = target;
  };

  const runAutoScroll = () => {
    autoScrollFrame = null;
    if (draggingIndex.value === null) return;

    const container = scrollContainer.value;
    if (!container) return;

    const speed = getEdgeAutoScrollSpeed(container, latestPointerY);
    if (speed === 0) return;
    const previousScrollTop = container.scrollTop;
    container.scrollTop += speed;
    if (container.scrollTop !== previousScrollTop) {
      updateDraggedItemPosition(latestPointerY);
      autoScrollFrame = requestAnimationFrame(runAutoScroll);
    }
  };
  const scheduleAutoScroll = () => {
    if (autoScrollFrame === null) {
      autoScrollFrame = requestAnimationFrame(runAutoScroll);
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (draggingIndex.value === null) return;
    event.preventDefault();

    latestPointerY = event.clientY;
    updateDraggedItemPosition(event.clientY);
    scheduleAutoScroll();
  };

  const stopDragging = () => {
    if (draggingIndex.value !== null) {
      const finalRows = sortRows(rows.value, cloudSortIndexDrafts?.value ?? {});
      reorderPlugins(finalRows.filter((row) => row.plugin).map((row) => row.plugin!.id));
      if (draggingContainsCloud && persistCloudSortIndexes && cloudSortIndexDrafts) {
        persistCloudSortIndexes({ ...cloudSortIndexDrafts.value });
      }
      plugins.value = getStoredPlugins();
    }
    draggingIndex.value = null;
    scrollContainer.value = null;
    draggingContainsCloud = false;
    if (autoScrollFrame !== null) {
      cancelAnimationFrame(autoScrollFrame);
      autoScrollFrame = null;
    }
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', stopDragging);
    window.removeEventListener('pointercancel', stopDragging);
  };

  const startDragging = (index: number, event: PointerEvent) => {
    if (searchQuery.value.trim()) return;
    if (event.button !== 0) return;
    event.preventDefault();

    draggingContainsCloud = rows.value.some((row) => row.cloud);
    draggingIndex.value = index;
    latestPointerY = event.clientY;
    scrollContainer.value = listRef.value ? findVerticalScrollContainer(listRef.value) : null;
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);
  };

  return {
    draggingIndex,
    listRef,
    startDragging,
    stopDragging,
  };
}

/** 按当前 sortOrder/草稿位稳定排序行（插件 sortOrder 已在拖拽中实时更新） */
function sortRows(
  rows: SortableSourceRow[],
  cloudIndexes: Record<string, number | null>,
): SortableSourceRow[] {
  const rowIndex = (row: SortableSourceRow) =>
    row.plugin ? (row.plugin.sortOrder ?? 0) : (cloudIndexes[row.cloud!.providerId] ?? Number.MAX_SAFE_INTEGER);
  return [...rows].sort((a, b) => {
    const sa = rowIndex(a);
    const sb = rowIndex(b);
    if (sa !== sb) return sa - sb;
    return rows.indexOf(a) - rows.indexOf(b);
  });
}
