import { ref } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import type { PluginSource } from '../../types';
import { getStoredPlugins, reorderPlugins } from '../../services/domain/pluginEngine';
import { findVerticalScrollContainer, getEdgeAutoScrollSpeed, resolveDragTargetIndex } from '../../utils/dragSort';

interface UsePluginDragSortOptions {
  plugins: Ref<PluginSource[]>;
  filteredPlugins: ComputedRef<PluginSource[]>;
  searchQuery: Ref<string>;
  sortPlugins: (list: PluginSource[]) => PluginSource[];
}

/**
 * 插件列表的拖拽排序（基于 pointer 事件）：
 * 拖动手柄按下后接管 window 的 pointermove/pointerup，边缘自动滚动，
 * 松手时按最终顺序写回插件存储。
 */
export function usePluginDragSort(options: UsePluginDragSortOptions) {
  const { plugins, filteredPlugins, searchQuery, sortPlugins } = options;

  const draggingIndex = ref<number | null>(null);
  const listRef = ref<HTMLElement | null>(null);
  const scrollContainer = ref<HTMLElement | null>(null);
  let latestPointerY = 0;
  let autoScrollFrame: number | null = null;

  const resolveTargetIndex = (clientY: number, currentIndex: number): number | null => {
    return resolveDragTargetIndex(listRef.value, '[data-plugin-row]', clientY, currentIndex);
  };

  const movePluginItem = (from: number, to: number) => {
    if (from < 0 || from >= filteredPlugins.value.length || to < 0 || to >= filteredPlugins.value.length || from === to) return;
    const sorted = [...filteredPlugins.value];
    const [moved] = sorted.splice(from, 1);
    sorted.splice(to, 0, moved);
    sorted.forEach((p, i) => {
      const plugin = plugins.value.find(item => item.id === p.id);
      if (plugin) plugin.sortOrder = i;
    });
  };
  const updateDraggedItemPosition = (clientY: number) => {
    const currentIndex = draggingIndex.value;
    if (currentIndex === null) return;

    const target = resolveTargetIndex(clientY, currentIndex);
    if (target === null || target === currentIndex) return;

    movePluginItem(currentIndex, target);
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
      const finalOrder = sortPlugins(plugins.value).map(p => p.id);
      reorderPlugins(finalOrder);
      plugins.value = getStoredPlugins();
    }
    draggingIndex.value = null;
    scrollContainer.value = null;
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
