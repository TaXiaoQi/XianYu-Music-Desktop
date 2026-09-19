import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';

const DRAG_THRESHOLD = 5;

export function useDragScrollX(containerRef: Ref<HTMLElement | null>) {
  const isDragging = ref(false);

  let startX = 0;
  let startScrollLeft = 0;
  let moved = 0;
  let tracking = false;

  let lastDragX = 0;
  let dragVelocity = 0;

  let targetScrollLeft = 0;
  let currentScrollLeft = 0;
  let animFrameId: number | null = null;
  let lastScrollLeft = 0;

  const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));

  const updateTransformAnimation = (el: HTMLElement, velocity: number) => {
    const skewAngle = clamp(-velocity * 0.12, -3.5, 3.5);
    const scaleX = 1 + Math.min(0.025, Math.abs(velocity) * 0.0006);

    if (Math.abs(skewAngle) > 0.05) {
      el.style.transform = `skewX(${skewAngle.toFixed(2)}deg) scaleX(${scaleX.toFixed(3)})`;
      el.style.transformOrigin = 'center center';
      el.style.willChange = 'transform, scroll-position';
    } else {
      el.style.transform = '';
      el.style.transformOrigin = '';
      el.style.willChange = '';
    }
  };

  const stopAnimation = () => {
    if (animFrameId !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(animFrameId);
      }
      animFrameId = null;
    }
  };

  const startWheelAnimation = (el: HTMLElement) => {
    stopAnimation();

    const animate = () => {
      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);

      if (targetScrollLeft < 0) {
        targetScrollLeft += (0 - targetScrollLeft) * 0.2;
      } else if (targetScrollLeft > maxScroll) {
        targetScrollLeft += (maxScroll - targetScrollLeft) * 0.2;
      }

      const diff = targetScrollLeft - currentScrollLeft;
      currentScrollLeft += diff * 0.22;

      const velocity = currentScrollLeft - lastScrollLeft;
      lastScrollLeft = currentScrollLeft;

      el.scrollLeft = currentScrollLeft;
      updateTransformAnimation(el, velocity);

      if (Math.abs(diff) < 0.25 && Math.abs(velocity) < 0.25) {
        currentScrollLeft = clamp(currentScrollLeft, 0, maxScroll);
        el.scrollLeft = currentScrollLeft;
        el.style.transform = '';
        el.style.transformOrigin = '';
        el.style.willChange = '';
        animFrameId = null;
        return;
      }

      if (typeof requestAnimationFrame === 'function') {
        animFrameId = requestAnimationFrame(animate);
      } else {
        animFrameId = null;
      }
    };

    if (typeof requestAnimationFrame === 'function') {
      animFrameId = requestAnimationFrame(animate);
    } else {
      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      el.scrollLeft = clamp(targetScrollLeft, 0, maxScroll);
    }
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!tracking) return;
    const el = containerRef.value;
    if (!el) return;

    const dx = e.clientX - startX;
    moved = Math.max(moved, Math.abs(dx));
    if (moved < DRAG_THRESHOLD) return;

    if (!isDragging.value) {
      isDragging.value = true;
      el.style.scrollBehavior = 'auto';
    }

    dragVelocity = (lastDragX - e.clientX) * 0.8;
    lastDragX = e.clientX;

    el.scrollLeft = startScrollLeft - dx;
    currentScrollLeft = el.scrollLeft;
    targetScrollLeft = el.scrollLeft;
    updateTransformAnimation(el, dragVelocity);
  };

  const handlePointerUp = () => {
    if (!tracking) return;
    tracking = false;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerUp);

    const el = containerRef.value;
    if (el) {
      el.style.scrollBehavior = '';
      targetScrollLeft = el.scrollLeft + dragVelocity * 6;
      currentScrollLeft = el.scrollLeft;
      lastScrollLeft = el.scrollLeft;
      startWheelAnimation(el);
    }

    if (isDragging.value) {
      isDragging.value = false;
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

    stopAnimation();
    tracking = true;
    startX = e.clientX;
    lastDragX = e.clientX;
    startScrollLeft = el.scrollLeft;
    currentScrollLeft = el.scrollLeft;
    targetScrollLeft = el.scrollLeft;
    dragVelocity = 0;
    moved = 0;

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  const handleWheel = (e: WheelEvent) => {
    const el = containerRef.value;
    if (!el) return;

    if (el.scrollWidth <= el.clientWidth) return;

    let delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (delta !== 0) {
      e.preventDefault();

      if (e.deltaMode === 1) {
        delta *= 36;
      } else if (e.deltaMode === 2) {
        delta *= el.clientWidth;
      }

      if (animFrameId === null) {
        currentScrollLeft = el.scrollLeft;
        targetScrollLeft = el.scrollLeft;
        lastScrollLeft = el.scrollLeft;
      }

      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      targetScrollLeft = clamp(targetScrollLeft + delta * 1.15, -30, maxScroll + 30);

      el.style.scrollBehavior = 'auto';
      startWheelAnimation(el);
    }
  };

  const bindEvents = (el: HTMLElement | null) => {
    if (!el) return;
    el.addEventListener('pointerdown', handlePointerDown);
    el.addEventListener('wheel', handleWheel, { passive: false });
  };

  const unbindEvents = (el: HTMLElement | null) => {
    if (!el) return;
    stopAnimation();
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
    if (containerRef.value) unbindEvents(containerRef.value);
    stopAnimation();
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerUp);
  });

  return { isDragging };
}
