import { computed, type Ref } from 'vue';
import { useScrollShrinkHeader } from '../../../composables/useScrollShrinkHeader';

// 头像列的完整尺寸基准（px），与滚动收缩阈值一致
const FULL_SIZE = 144;

/**
 * 头部随滚动收缩的尺寸指标（QQ 音乐桌面版风格）。
 * progress ∈ [0, 1]：0 为完全展开，1 为完全收缩。
 */
export function useHeroShrink(container: Ref<HTMLElement | null>) {
  const { scrollProgress } = useScrollShrinkHeader(container, FULL_SIZE);

  const avatarSize = computed(() => `${FULL_SIZE - 100 * scrollProgress.value}px`);
  const infoHeight = computed(() => `${FULL_SIZE - 80 * scrollProgress.value}px`);
  const nameSize = computed(() => `${32 - 16 * scrollProgress.value}px`);
  const nameLine = computed(() => `${40 - 20 * scrollProgress.value}px`);
  const nameGap = computed(() => `${16 - 12 * scrollProgress.value}px`);
  const btnGap = computed(() => `${8 - 8 * scrollProgress.value}px`);
  const bioOpacity = computed(() => Math.max(0, 1 - scrollProgress.value * 2));
  const bioMaxHeight = computed(() => `${Math.round(1000 * Math.max(0, 1 - scrollProgress.value * 2))}px`);

  return { avatarSize, infoHeight, nameSize, nameLine, nameGap, btnGap, bioOpacity, bioMaxHeight };
}
