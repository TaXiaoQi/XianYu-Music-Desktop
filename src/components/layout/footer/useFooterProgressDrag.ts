import { computed, ref, type Ref } from 'vue';

import type { Song } from '../../../types';
import { getProgressVisualState } from '../playerFooterProgress';
import { progressTimeFromPointer } from './footerDragMath';

interface ProgressDragDeps {
  getCurrentSong: () => Song | null;
  getCurrentTime: () => number;
  seekTo: (time: number) => Promise<unknown>;
  formatDuration: (seconds: number) => string;
  isProgressHidden: Ref<boolean>;
  isShowingDetail: Ref<boolean>;
}

/**
 * 底栏进度条拖拽：拖拽期间用 dragTime 接管显示进度，松手时按提交与否决定是否 seek。
 */
export const useFooterProgressDrag = ({
  getCurrentSong,
  getCurrentTime,
  seekTo,
  formatDuration,
  isProgressHidden,
  isShowingDetail,
}: ProgressDragDeps) => {
  const isDraggingProgress = ref(false);
  const progressBarRef = ref<HTMLElement | null>(null);
  const dragTime = ref(0);

  const displayProgress = computed(() => {
    const song = getCurrentSong();
    if (!song || song.duration <= 0) return 0;
    const time = isDraggingProgress.value ? dragTime.value : getCurrentTime();
    return Math.max(0, Math.min(100, (time / song.duration) * 100));
  });

  const progressFillClass = computed(() => 'bg-zinc-300/30');

  const progressTrackClass = computed(() => 'bg-transparent');

  const progressThumbClass = computed(() => (
    isShowingDetail.value
      ? 'border-white/45 bg-white'
      : 'border-black/10 dark:border-white/20 bg-white'
  ));

  const progressVisualState = computed(() => getProgressVisualState(isProgressHidden.value, isDraggingProgress.value));

  const startProgressDrag = (e: PointerEvent) => {
    const song = getCurrentSong();
    if (!song || song.duration <= 0) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
    isDraggingProgress.value = true;
    updateProgressFromEvent(e);
  };

  const stopProgressDrag = async (commit = true) => {
    if (isDraggingProgress.value) {
      const targetTime = dragTime.value;
      isDraggingProgress.value = false;
      if (commit) {
        await seekTo(targetTime);
      }
    }
  };

  const updateProgressFromEvent = (e: PointerEvent) => {
    const song = getCurrentSong();
    if (!progressBarRef.value || !song || song.duration <= 0) return;
    dragTime.value = progressTimeFromPointer(
      e.clientX,
      progressBarRef.value.getBoundingClientRect(),
      song.duration,
    );
  };

  const currentTimeStr = computed(() => {
    return formatDuration(isDraggingProgress.value ? dragTime.value : getCurrentTime());
  });

  const totalTimeStr = computed(() => {
    const song = getCurrentSong();
    return song ? formatDuration(song.duration) : '0:00';
  });

  return {
    isDraggingProgress,
    progressBarRef,
    dragTime,
    displayProgress,
    progressFillClass,
    progressTrackClass,
    progressThumbClass,
    progressVisualState,
    startProgressDrag,
    stopProgressDrag,
    updateProgressFromEvent,
    currentTimeStr,
    totalTimeStr,
  };
};
