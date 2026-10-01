import { computed, nextTick, ref, watch, type Ref } from 'vue';

import type { Song } from '../../../types';

interface MarqueeDeps {
  currentSong: Ref<Song | null>;
  isShowingDetail: Ref<boolean>;
  footerLayout: Ref<unknown>;
}

/**
 * 底栏歌名滚动：文本溢出时启动 marquee，并用 ResizeObserver + rAF 重算。
 * 观察器的挂载/卸载仍由调用方在 onMounted/onUnmounted 中按原顺序触发，
 * 以免打乱与其它生命周期钩子的相对次序。
 */
export const useFooterMarquee = ({
  currentSong,
  isShowingDetail,
  footerLayout,
}: MarqueeDeps) => {
  const songTitleWrapperRef = ref<HTMLElement | null>(null);
  const songTitleTextRef = ref<HTMLElement | null>(null);
  const shouldMarquee = ref(false);
  const marqueeDuration = ref(12);
  const isMarqueePaused = ref(false);
  let marqueeResizeObserver: ResizeObserver | null = null;
  let marqueeCheckFrame: number | null = null;

  const songTitleText = computed(() => {
    if (!currentSong.value) return '听我想听的音乐';
    return currentSong.value.title || currentSong.value.name.replace(/\.[^/.]+$/, "");
  });

  const checkMarquee = () => {
    nextTick(() => {
      if (marqueeCheckFrame !== null) {
        cancelAnimationFrame(marqueeCheckFrame);
      }

      marqueeCheckFrame = requestAnimationFrame(() => {
        marqueeCheckFrame = null;
        const wrapper = songTitleWrapperRef.value;
        const span = songTitleTextRef.value;
        if (!wrapper || !span) {
          shouldMarquee.value = false;
          return;
        }

        const wrapperWidth = wrapper.getBoundingClientRect().width;
        const textWidth = span.getBoundingClientRect().width;
        const overflow = textWidth - wrapperWidth;
        if (overflow > 0) {
          shouldMarquee.value = true;
          marqueeDuration.value = Math.max(8, Math.min(30, 6 + overflow / 25));
        } else {
          shouldMarquee.value = false;
          isMarqueePaused.value = false;
        }
      });
    });
  };

  const setupMarqueeObserver = () => {
    marqueeResizeObserver?.disconnect();
    if (typeof ResizeObserver === 'undefined') {
      checkMarquee();
      return;
    }

    marqueeResizeObserver = new ResizeObserver(() => checkMarquee());
    if (songTitleWrapperRef.value) {
      marqueeResizeObserver.observe(songTitleWrapperRef.value);
    }
    if (songTitleTextRef.value) {
      marqueeResizeObserver.observe(songTitleTextRef.value);
    }
    checkMarquee();
  };

  const disposeMarquee = () => {
    marqueeResizeObserver?.disconnect();
    marqueeResizeObserver = null;
    if (marqueeCheckFrame !== null) {
      cancelAnimationFrame(marqueeCheckFrame);
      marqueeCheckFrame = null;
    }
  };

  watch(songTitleText, () => checkMarquee());
  watch(isShowingDetail, () => checkMarquee());
  watch(footerLayout, () => checkMarquee(), { deep: true });
  watch(currentSong, () => nextTick(() => checkMarquee()), { deep: false });

  return {
    songTitleWrapperRef,
    songTitleTextRef,
    shouldMarquee,
    marqueeDuration,
    isMarqueePaused,
    songTitleText,
    checkMarquee,
    setupMarqueeObserver,
    disposeMarquee,
  };
};
