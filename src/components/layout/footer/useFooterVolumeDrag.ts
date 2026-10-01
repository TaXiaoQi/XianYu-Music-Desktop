import { ref } from 'vue';

import { volumePercentFromPointer } from './footerDragMath';

interface VolumeDragDeps {
  /** 以 0–100 的整数音量回写播放器。 */
  setVolume: (volume: number) => void;
  /** 指针进入音量区（用于重置底栏 idle）。 */
  onPointerEnter: () => void;
  /** 音量区收起后恢复 idle 计时。 */
  onResumeIdle: () => void;
}

/**
 * 底栏音量拖拽与滑块显隐：垂直命中换算 + 300ms 延迟收起。
 */
export const useFooterVolumeDrag = ({
  setVolume,
  onPointerEnter,
  onResumeIdle,
}: VolumeDragDeps) => {
  const isDraggingVolume = ref(false);
  const volumeBarRef = ref<HTMLElement | null>(null);
  const showVolumeSlider = ref(false);
  let volumeTimer: ReturnType<typeof setTimeout> | null = null;

  const updateVolume = (clientY: number) => {
    if (!volumeBarRef.value) return;
    setVolume(volumePercentFromPointer(clientY, volumeBarRef.value.getBoundingClientRect()));
  };

  const startDrag = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
    isDraggingVolume.value = true;
    updateVolume(e.clientY);
  };

  const endDrag = () => {
    isDraggingVolume.value = false;
  };

  const handleVolumeEnter = () => {
    if (volumeTimer) clearTimeout(volumeTimer);
    showVolumeSlider.value = true;
    onPointerEnter();
  };

  const handleVolumeLeave = () => {
    volumeTimer = setTimeout(() => {
      if (!isDraggingVolume.value) {
        showVolumeSlider.value = false;
        onResumeIdle();
      }
    }, 300);
  };

  return {
    isDraggingVolume,
    volumeBarRef,
    showVolumeSlider,
    updateVolume,
    startDrag,
    endDrag,
    handleVolumeEnter,
    handleVolumeLeave,
  };
};
