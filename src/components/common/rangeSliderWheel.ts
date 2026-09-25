/**
 * 滑块滚轮调值的纯计算部分。
 *
 * 与 DOM 解耦，便于单测覆盖边界情况：到界、非网格值、小数步长、负量程等。
 * 组件侧只负责取当前值、拦截默认滚动、派发 input 事件。
 */

export interface RangeSliderWheelInput {
  min: number;
  max: number;
  /** 沿用原生 input 的写法，允许字符串；非法时按量程 1% 兜底 */
  step: number | string;
  /** 变化前的当前值 */
  current: number;
  /** WheelEvent.deltaY，负数表示上滚 */
  deltaY: number;
  /** WheelEvent.deltaX，用于识别触控板横向手势 */
  deltaX?: number;
}

function toFinite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** step 非法（NaN / 0 / 负数 / 'any'）时，退化为量程的 1% */
function resolveStep(step: number | string, min: number, max: number): number {
  const raw = Number(step);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return (max - min) / 100;
}

/** 取一个数的小数位数，用于抹掉浮点误差（step=0.05 时保留两位） */
function decimalsOf(value: number): number {
  const text = String(value);
  if (text.includes('e') || text.includes('E')) return 6;
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : Math.min(text.length - dot - 1, 10);
}

function clampToStep(min: number, max: number, value: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  const rounded = Number(clamped.toFixed(decimalsOf(step)));
  // toFixed 之后仍可能越界（例如 max 本身位数更少），再夹一次
  return Math.min(max, Math.max(min, rounded));
}

/**
 * 计算滚轮一次滚动后的目标值。
 *
 * 返回 null 表示「这次滚轮不该由滑块消费」，调用方据此放行给外层滚动容器：
 * 已到边界、量程非法、deltaY 为 0、或触控板以横向滑动为主。
 */
export function resolveWheelValue(input: RangeSliderWheelInput): number | null {
  const { deltaY } = input;
  if (!Number.isFinite(deltaY) || deltaY === 0) return null;

  const deltaX = input.deltaX ?? 0;
  if (Math.abs(deltaX) > Math.abs(deltaY)) return null;

  const min = toFinite(input.min, 0);
  const max = toFinite(input.max, 100);
  if (!(max > min)) return null;

  const step = resolveStep(input.step, min, max);
  const current = toFinite(input.current, min);
  const direction = deltaY < 0 ? 1 : -1;

  // 以 min 为基准做整数倍步进，避免「当前值 ± step」逐次累加带来的浮点漂移
  const stepsFromMin = Math.round((current - min) / step) + direction;
  const next = clampToStep(min, max, min + stepsFromMin * step, step);

  return next === current ? null : next;
}
