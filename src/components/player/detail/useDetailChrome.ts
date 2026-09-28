import { onBeforeUnmount, ref } from 'vue';

/** 顶栏失去悬停后停留多久再收起（毫秒） */
const REVEAL_HOLD_MS = 2500;

/**
 * 播放详情页顶栏的“悬停显现 / 延时收起”状态机。
 * - peek：悬停时立即显现并清掉收起倒计时
 * - relax：指针离开后进入倒计时收起
 * - flashReveal：详情页展开瞬间显现一次并自动倒计时
 * - conceal：详情页收起时立即隐藏
 */
export function useDetailChrome() {
  const revealed = ref(false);
  let holdTimer: ReturnType<typeof setTimeout> | null = null;

  const dropHoldTimer = () => {
    if (holdTimer === null) return;
    clearTimeout(holdTimer);
    holdTimer = null;
  };

  const peek = () => {
    dropHoldTimer();
    revealed.value = true;
  };

  const relax = () => {
    dropHoldTimer();
    holdTimer = setTimeout(() => {
      holdTimer = null;
      revealed.value = false;
    }, REVEAL_HOLD_MS);
  };

  const flashReveal = () => {
    peek();
    relax();
  };

  const conceal = () => {
    dropHoldTimer();
    revealed.value = false;
  };

  onBeforeUnmount(dropHoldTimer);

  return { revealed, peek, relax, flashReveal, conceal };
}
