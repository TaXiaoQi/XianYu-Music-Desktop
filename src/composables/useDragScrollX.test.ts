import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useDragScrollX } from './useDragScrollX';

describe('useDragScrollX composable', () => {
  it('handles wheel listener registration and scrollLeft updates with animation', () => {
    let wheelHandler: ((e: any) => void) | null = null;
    const mockStyle = { scrollBehavior: '', transform: '' };
    const mockEl = {
      scrollWidth: 1000,
      clientWidth: 500,
      scrollLeft: 100,
      style: mockStyle,
      addEventListener: vi.fn((event, handler) => {
        if (event === 'wheel') wheelHandler = handler;
      }),
      removeEventListener: vi.fn(),
    } as unknown as HTMLElement;

    const containerRef = ref<HTMLElement | null>(mockEl);
    useDragScrollX(containerRef);

    expect(mockEl.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });

    const preventDefaultSpy = vi.fn();
    wheelHandler?.({
      deltaX: 0,
      deltaY: 40,
      deltaMode: 0,
      preventDefault: preventDefaultSpy,
    });

    expect(preventDefaultSpy).toHaveBeenCalled();
    // 单元测试环境中无 requestAnimationFrame 时进行直接跳变
    expect(mockEl.scrollLeft).toBeGreaterThan(100);
  });

  it('does not intercept wheel event when container does not overflow', () => {
    let wheelHandler: ((e: any) => void) | null = null;
    const mockEl = {
      scrollWidth: 500,
      clientWidth: 500,
      scrollLeft: 0,
      style: { scrollBehavior: '', transform: '' },
      addEventListener: vi.fn((event, handler) => {
        if (event === 'wheel') wheelHandler = handler;
      }),
      removeEventListener: vi.fn(),
    } as unknown as HTMLElement;

    const containerRef = ref<HTMLElement | null>(mockEl);
    useDragScrollX(containerRef);

    const preventDefaultSpy = vi.fn();
    wheelHandler?.({
      deltaX: 0,
      deltaY: 40,
      deltaMode: 0,
      preventDefault: preventDefaultSpy,
    });

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(mockEl.scrollLeft).toBe(0);
  });
});
