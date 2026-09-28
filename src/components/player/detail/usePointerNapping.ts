import { onBeforeUnmount, ref } from 'vue';

/** 指针静止多久后视为闲置并隐藏光标（毫秒） */
const NAP_DELAY_MS = 2000;

/**
 * 沉浸式全屏下的光标自动隐藏哨兵。
 * 监听器的注册/注销与闲置计时全部收敛在此，
 * engage/release 由“进入全屏”“详情页开合”等时机调用。
 */
export function usePointerNapping() {
  const napping = ref(false);
  let napTimer: ReturnType<typeof setTimeout> | null = null;

  const dropNapTimer = () => {
    if (napTimer === null) return;
    clearTimeout(napTimer);
    napTimer = null;
  };

  const armNap = () => {
    dropNapTimer();
    napTimer = setTimeout(() => {
      napTimer = null;
      napping.value = true;
    }, NAP_DELAY_MS);
  };

  const wake = () => {
    napping.value = false;
    armNap();
  };

  const engage = () => {
    window.addEventListener('mousemove', wake);
    window.addEventListener('mousedown', wake);
    armNap();
  };

  const release = () => {
    window.removeEventListener('mousemove', wake);
    window.removeEventListener('mousedown', wake);
    dropNapTimer();
    napping.value = false;
  };

  onBeforeUnmount(release);

  return { napping, engage, release };
}
