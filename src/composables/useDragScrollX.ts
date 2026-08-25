import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';

/**
 * 横向容器鼠标点击拖动滚动 & 鼠标滚轮横向滚动。
 *
 * - pointerdown 在容器任意位置（含按钮上）按下即开始跟踪
 * - 移动超过 DRAG_THRESHOLD 判定为拖拽：直接改 scrollLeft（临时关掉 scroll-smooth 保证跟手）
 * - pointermove/up 挂在 window 上：指针拖出容器仍能继续跟踪，不会中途失联
 * - 拖拽结束后在容器捕获阶段吞掉紧随的 click，避免松手位置的按钮被误触发；
 *   未超阈值的按下放行，正常点击不受影响
 * - 鼠标悬浮并滚动滚轮时（wheel），将垂直/横向滚动统一转换为容器横向 scrollLeft 驱动，并阻止默认页面垂直滚动
 */
const DRAG_THRESHOLD = 5;

export function useDragScrollX(containerRef: Ref<HTMLElement | null>) {
  const isDragging = ref(false);

  let startX = 0;
  let startScrollLeft = 0;
  let moved = 0;
  let tracking = false;

  const handlePointerMove = (e: PointerEvent) => {
    if (!tracking) return;
    const el = containerRef.value;
    if (!el) return;

    const dx = e.clientX - startX;
    moved = Math.max(moved, Math.abs(dx));
    if (moved < DRAG_THRESHOLD) return;

    if (!isDragging.value) {
      isDragging.value = true;
      // scroll-smooth 会让 scrollLeft 赋值变成动画，拖拽期间必须直接跳变才跟手
      el.style.scrollBehavior = 'auto';
    }
    el.scrollLeft = startScrollLeft - dx;
  };

  const handlePointerUp = () => {
    if (!tracking) return;
    tracking = false;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerUp);

    const el = containerRef.value;
    if (el) el.style.scrollBehavior = '';

    if (isDragging.value) {
      isDragging.value = false;
      // 拖拽期间在按钮上松手：吞掉这次 click（click 在 pointerup 之后同轮派发）
      if (el) {
        const swallow = (ev: Event) => {
          ev.preventDefault();
          ev.stopPropagation();
        };
        el.addEventListener('click', swallow, true);
        setTimeout(() => el.removeEventListener('click', swallow, true), 0);
      }
    }
  };

  const handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const el = containerRef.value;
    if (!el) return;

    tracking = true;
    startX = e.clientX;
    startScrollLeft = el.scrollLeft;
    moved = 0;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  let wheelResetTimer: ReturnType<typeof setTimeout> | undefined;

  const handleWheel = (e: WheelEvent) => {
    const el = containerRef.value;
    if (!el) return;

    // 若容器未产生横向可滚动溢出，不拦截默认行为
    if (el.scrollWidth <= el.clientWidth) return;

    let delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (delta !== 0) {
      e.preventDefault();

      // 行/页模式单位转换
      if (e.deltaMode === 1) {
        delta *= 40;
      } else if (e.deltaMode === 2) {
        delta *= el.clientWidth;
      }

      // 临时关掉 CSS scroll-smooth 导致的延迟缓冲，确保滚轮快速连续滚动时零延迟跟手
      el.style.scrollBehavior = 'auto';
      el.scrollLeft += delta;

      clearTimeout(wheelResetTimer);
      wheelResetTimer = setTimeout(() => {
        if (el) el.style.scrollBehavior = '';
      }, 150);
    }
  };

  const bindEvents = (el: HTMLElement | null) => {
    if (!el) return;
    el.addEventListener('pointerdown', handlePointerDown);
    el.addEventListener('wheel', handleWheel, { passive: false });
  };

  const unbindEvents = (el: HTMLElement | null) => {
    if (!el) return;
    el.removeEventListener('pointerdown', handlePointerDown);
    el.removeEventListener('wheel', handleWheel);
  };

  watch(containerRef, (newEl, oldEl) => {
    if (oldEl) unbindEvents(oldEl);
    if (newEl) bindEvents(newEl);
  }, { immediate: true });

  onMounted(() => {
    if (containerRef.value) {
      unbindEvents(containerRef.value);
      bindEvents(containerRef.value);
    }
  });

  onBeforeUnmount(() => {
    unbindEvents(containerRef.value);
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerUp);
  });

  return { isDragging };
}
