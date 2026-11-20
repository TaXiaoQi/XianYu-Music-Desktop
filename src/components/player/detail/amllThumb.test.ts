import { describe, expect, it } from 'vitest';

import {
  AMLL_THUMB_DRAG_THRESHOLD,
  resolveThumbDrag,
  resolveThumbTap,
} from './amllThumb';

describe('resolveThumbDrag', () => {
  it('向下拖拽达到阈值触发收起', () => {
    expect(resolveThumbDrag(AMLL_THUMB_DRAG_THRESHOLD)).toBe('collapse');
    expect(resolveThumbDrag(AMLL_THUMB_DRAG_THRESHOLD + 40)).toBe('collapse');
  });

  it('未达阈值或向上拖拽不触发', () => {
    expect(resolveThumbDrag(AMLL_THUMB_DRAG_THRESHOLD - 1)).toBe('none');
    expect(resolveThumbDrag(0)).toBe('none');
    expect(resolveThumbDrag(-120)).toBe('none');
  });

  it('支持自定义阈值', () => {
    expect(resolveThumbDrag(20, 10)).toBe('collapse');
    expect(resolveThumbDrag(20, 30)).toBe('none');
  });
});

describe('resolveThumbTap', () => {
  it('位移在阈值内视为轻点', () => {
    expect(resolveThumbTap(0)).toBe(true);
    expect(resolveThumbTap(AMLL_THUMB_DRAG_THRESHOLD - 1)).toBe(true);
    expect(resolveThumbTap(-10)).toBe(true);
  });

  it('超过阈值视为拖拽收尾，不再按轻点处理', () => {
    expect(resolveThumbTap(AMLL_THUMB_DRAG_THRESHOLD)).toBe(false);
    expect(resolveThumbTap(-AMLL_THUMB_DRAG_THRESHOLD)).toBe(false);
  });
});
