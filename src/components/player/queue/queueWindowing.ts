import { computed, ref } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import type { CSSProperties, Ref } from 'vue';

export interface QueueWindowSpec<T> {
  /** 参与窗口化的行数据全集 */
  entries: Ref<T[]>;
  /** 单行估高；行高恒定时即为实际行高 */
  rowExtent: number;
  /** 视口外额外预渲染的行数 */
  bufferRows: number;
}

export interface WindowedRow<T> {
  index: number;
  start: number;
  size: number;
  entry: T;
}

/**
 * 行级虚拟滚动：由 @tanstack/vue-virtual 计算可见窗口，
 * 这里负责暴露视口锚点、可见行投影、行的绝对定位样式
 * 以及“把某一行滚动到视口竖直居中”的能力。
 */
export function useQueueWindow<T>(spec: QueueWindowSpec<T>) {
  const viewportEl = ref<HTMLElement | null>(null);

  const engine = useVirtualizer({
    get count() { return spec.entries.value.length; },
    getScrollElement: () => viewportEl.value,
    estimateSize: () => spec.rowExtent,
    overscan: spec.bufferRows,
  });

  const renderedRows = computed<WindowedRow<T>[]>(() =>
    engine.value.getVirtualItems().map(item => ({
      index: item.index,
      start: item.start,
      size: item.size,
      entry: spec.entries.value[item.index],
    })),
  );

  const contentExtent = computed(() => engine.value.getTotalSize());

  /** 一行以绝对定位铺满宽度并平移到窗口起点处 */
  const placementFor = (row: WindowedRow<T>): CSSProperties => ({
    position: 'absolute',
    inset: '0 0 auto 0',
    height: `${row.size}px`,
    transform: `translate3d(0, ${row.start}px, 0)`,
  });

  /** 把第 rowIndex 行滚动到视口竖直居中位置 */
  const revealRow = (rowIndex: number, motion: 'auto' | 'smooth') => {
    engine.value.scrollToIndex(rowIndex, { align: 'center', behavior: motion });
  };

  return { viewportEl, renderedRows, contentExtent, placementFor, revealRow };
}
