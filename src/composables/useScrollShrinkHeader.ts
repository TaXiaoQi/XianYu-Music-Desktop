import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';

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
