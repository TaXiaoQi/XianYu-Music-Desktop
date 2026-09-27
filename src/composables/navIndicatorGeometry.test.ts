import { describe, expect, it } from 'vitest';

import { computeNavIndicatorGeometry, type NavItemGeometry } from './navIndicatorGeometry';

const item = (offsetTop: number, offsetHeight: number): NavItemGeometry => ({ offsetTop, offsetHeight });

describe('computeNavIndicatorGeometry', () => {
  const items: NavItemGeometry[] = [item(0, 32), item(40, 32), item(80, 36)];

  it('首项激活时对齐首项', () => {
    expect(computeNavIndicatorGeometry(items, 0)).toEqual({ top: 0, height: 32, visible: true });
  });

  it('中间项激活时对齐中间项', () => {
    expect(computeNavIndicatorGeometry(items, 1)).toEqual({ top: 40, height: 32, visible: true });
  });

  it('末项激活时对齐末项', () => {
    expect(computeNavIndicatorGeometry(items, 2)).toEqual({ top: 80, height: 36, visible: true });
  });

  it('空列表回退为隐藏', () => {
    expect(computeNavIndicatorGeometry([], 0)).toEqual({ top: 0, height: 0, visible: false });
  });

  it('激活下标越界或为负时回退为隐藏', () => {
    expect(computeNavIndicatorGeometry(items, items.length).visible).toBe(false);
    expect(computeNavIndicatorGeometry(items, -1).visible).toBe(false);
  });

  it('窗口尺寸变化后重新测量得到新的偏移/高度', () => {
    const before = computeNavIndicatorGeometry([item(0, 32), item(40, 32)], 1);
    const after = computeNavIndicatorGeometry([item(0, 48), item(64, 48)], 1);

    expect(before).toEqual({ top: 40, height: 32, visible: true });
    expect(after).toEqual({ top: 64, height: 48, visible: true });
    expect(after).not.toEqual(before);
  });

  it('激活项高度为 0 时回退为隐藏', () => {
    expect(computeNavIndicatorGeometry([item(0, 32), item(40, 0)], 1).visible).toBe(false);
  });

  it('非整数下标回退为隐藏', () => {
    expect(computeNavIndicatorGeometry(items, 1.5).visible).toBe(false);
  });
});
