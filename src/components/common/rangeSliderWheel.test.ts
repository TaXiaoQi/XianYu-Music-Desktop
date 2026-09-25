import { describe, expect, it } from 'vitest';
import { resolveWheelValue } from './rangeSliderWheel';

const base = { min: 0, max: 100, step: 1, current: 50 };

describe('resolveWheelValue', () => {
  it('上滚加一个 step，下滚减一个 step', () => {
    expect(resolveWheelValue({ ...base, deltaY: -100 })).toBe(51);
    expect(resolveWheelValue({ ...base, deltaY: 100 })).toBe(49);
  });

  it('只看滚动方向，不按 deltaY 幅度决定步进量', () => {
    // 鼠标滚轮 100、触控板 3、极小幅 0.5 都只走一步
    for (const deltaY of [-100, -3, -0.5, 3, 100]) {
      const expected = deltaY < 0 ? 51 : 49;
      expect(resolveWheelValue({ ...base, deltaY })).toBe(expected);
    }
  });

  it('小数步长不产生浮点尾差', () => {
    expect(resolveWheelValue({ min: 0, max: 1, step: 0.05, current: 0.3, deltaY: -100 })).toBe(0.35);
    expect(resolveWheelValue({ min: 0, max: 1, step: 0.05, current: 0.3, deltaY: 100 })).toBe(0.25);
    // 连续多步也不漂移
    let value = 0;
    for (let i = 0; i < 7; i += 1) {
      value = resolveWheelValue({ min: 0, max: 1, step: 0.05, current: value, deltaY: -100 })!;
    }
    expect(value).toBe(0.35);
    expect(String(value)).toBe('0.35');
  });

  it('负量程（EQ 推子 -12~12）步进正确', () => {
    expect(resolveWheelValue({ min: -12, max: 12, step: 1, current: -3, deltaY: -100 })).toBe(-2);
    expect(resolveWheelValue({ min: -12, max: 12, step: 1, current: 3, deltaY: 100 })).toBe(2);
  });

  it('顶到边界时返回 null（交由外层滚动容器接管）', () => {
    expect(resolveWheelValue({ ...base, current: 100, deltaY: -100 })).toBeNull();
    expect(resolveWheelValue({ ...base, current: 0, deltaY: 100 })).toBeNull();
    // 边界上反方向仍然可动
    expect(resolveWheelValue({ ...base, current: 100, deltaY: 100 })).toBe(99);
  });

  it('接近边界时只钳到边界，不会越界', () => {
    expect(resolveWheelValue({ min: 0, max: 100, step: 5, current: 98, deltaY: -100 })).toBe(100);
    expect(resolveWheelValue({ min: 5, max: 1440, step: 5, current: 1438, deltaY: -100 })).toBe(1440);
    expect(resolveWheelValue({ min: 100, max: 2000, step: 100, current: 1990, deltaY: -100 })).toBe(2000);
  });

  it('当前值不在步长网格上时先对齐到网格', () => {
    // 0.33 在 step=0.05 下对齐到 0.35，再上滚一步到 0.4
    expect(resolveWheelValue({ min: 0, max: 1, step: 0.05, current: 0.33, deltaY: -100 })).toBe(0.4);
  });

  it('step 非法时按量程的 1% 兜底', () => {
    // step=0 / 'any' / 负数 / undefined 都视为非法
    for (const step of [0, 'any', -1, undefined as unknown as number]) {
      expect(resolveWheelValue({ min: 0, max: 100, step, current: 50, deltaY: -100 })).toBe(51);
    }
  });

  it('deltaY 为 0 时不消费滚轮', () => {
    expect(resolveWheelValue({ ...base, deltaY: 0 })).toBeNull();
  });

  it('触控板以横向滑动为主时不消费滚轮', () => {
    expect(resolveWheelValue({ ...base, deltaY: 10, deltaX: 40 })).toBeNull();
    // 纵向为主仍正常处理
    expect(resolveWheelValue({ ...base, deltaY: 40, deltaX: 10 })).toBe(49);
  });

  it('量程非法时返回 null', () => {
    expect(resolveWheelValue({ ...base, min: 100, max: 100 })).toBeNull();
    expect(resolveWheelValue({ ...base, min: 100, max: 0 })).toBeNull();
    expect(resolveWheelValue({ ...base, min: NaN, max: 100 })).toBeNull();
  });

  it('当前值非法时以 min 为起点', () => {
    expect(resolveWheelValue({ min: 0, max: 100, step: 1, current: NaN, deltaY: -100 })).toBe(1);
  });
});
