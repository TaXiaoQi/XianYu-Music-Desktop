import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';

/**
 * 监听滚动容器，计算封面收缩进度（0 = 展开，1 = 完全收缩）。
 * 用于 QQ 音乐桌面版风格的"滚动缩小封面"效果。
 * @param scrollContainerRef 滚动容器元素（可为 null，容器就绪后自动绑定）
 * @param threshold 完全收缩所需的滚动距离（px）
 */
export function useScrollShrinkHeader(
  scrollContainerRef: Ref<HTMLElement | null>,
  threshold = 160,
) {
  const scrollTop = ref(0);
  let el: HTMLElement | null = null;

  const onScroll = () => {
    if (el) scrollTop.value = el.scrollTop;
  };

  watch(
    scrollContainerRef,
    (newEl, oldEl) => {
      if (oldEl) oldEl.removeEventListener('scroll', onScroll);
      el = newEl;
      if (newEl) {
        newEl.addEventListener('scroll', onScroll, { passive: true });
        scrollTop.value = newEl.scrollTop;
      } else {
        scrollTop.value = 0;
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    if (el) el.removeEventListener('scroll', onScroll);
  });

  const scrollProgress = computed(() => {
    if (threshold <= 0) return 0;
    return Math.min(1, Math.max(0, scrollTop.value / threshold));
  });

  return { scrollProgress };
}
