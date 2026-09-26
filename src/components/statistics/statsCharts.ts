/**
 * 统计页图表的纯几何计算。
 * 本仓没有组件渲染测试，图表里所有「数据 → 几何」的换算都集中到这里，由 statsCharts.test.ts 覆盖，
 * 组件只负责把结果画出来。
 */

/** 只接受有限的正数，其余（负数 / NaN / Infinity / 未定义）统一按 0 处理。 */
function positiveOrZero(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 把数值序列归一化成 0..1 的柱高比例（相对最大值）。
 * 全 0 / 空数组 / 非法输入都返回等长的全 0 数组，调用方据此显示空状态而不是空图表。
 */
export function normalizeBars(values: number[]): number[] {
  const safe = values.map(positiveOrZero);
  const max = safe.reduce((peak, value) => (value > peak ? value : peak), 0);
  if (max <= 0) return safe.map(() => 0);
  return safe.map(value => value / max);
}

/**
 * 在归一化比例之上叠加最小可见高度，返回可直接写进 SVG 的柱高（与 maxHeight 同一坐标系）。
 * 有数据但比例极小的柱子会被抬到 minVisible，避免「有值却看不见」。
 */
export function barHeights(values: number[], maxHeight: number, minVisible = 0): number[] {
  const cap = Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : 0;
  const floor = Number.isFinite(minVisible) && minVisible > 0 ? minVisible : 0;
  return normalizeBars(values).map(ratio => {
    const height = ratio * cap;
    return ratio > 0 && height < floor ? floor : height;
  });
}

/**
 * 返回最大值的下标，用于高亮峰值。
 * 全 0 / 空数组返回 -1；并列最大值时取最小下标（第一个出现的）。
 */
export function computePeakIndex(values: number[]): number {
  let peakIndex = -1;
  let peakValue = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = positiveOrZero(values[index]);
    if (value > peakValue) {
      peakValue = value;
      peakIndex = index;
    }
  }
  return peakIndex;
}

/**
 * 计算各分量的百分比占比（0..100）。
 * 传入 totalOverride 时以它为分母（例如曲库占比以 total_songs 为分母），否则用数值之和。
 * 分母无效（<= 0）时返回全 0。
 */
export function sharePercentages(values: number[], totalOverride?: number): number[] {
  const safe = values.map(positiveOrZero);
  const sum = safe.reduce((acc, value) => acc + value, 0);
  const override = Number.isFinite(totalOverride) && (totalOverride as number) > 0
    ? (totalOverride as number)
    : 0;
  const total = override > 0 ? override : sum;
  if (total <= 0) return safe.map(() => 0);
  return safe.map(value => (value / total) * 100);
}

/** 环形图的一段弧。 */
export interface RingSegment {
  /** 该段占比（0..100）。 */
  percent: number;
  /** 该段的弧长（与 radius 同一坐标系，供 stroke-dasharray 使用）。 */
  dash: number;
  /** stroke-dashoffset：本段在圆周上的起点偏移（相对圆周起点为负值）。 */
  offset: number;
}

/**
 * 把占比数值换算成环形图各段的 stroke-dasharray / stroke-dashoffset。
 * 返回段的顺序与入参一致；全 0 / 半径非法时每段弧长与占比都是 0（画成空环）。
 */
export function ringSegments(values: number[], radius: number): RingSegment[] {
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 0;
  const circumference = 2 * Math.PI * safeRadius;
  const total = values.reduce((acc, value) => acc + positiveOrZero(value), 0);
  if (total <= 0 || circumference <= 0) {
    return values.map(() => ({ percent: 0, dash: 0, offset: 0 }));
  }
  let cumulative = 0;
  return values.map(raw => {
    const percent = (positiveOrZero(raw) / total) * 100;
    const dash = (percent / 100) * circumference;
    const segment: RingSegment = { percent, dash, offset: -cumulative };
    cumulative += dash;
    return segment;
  });
}

/**
 * 近 count 天的「日」序号（1..31），index 越大越接近今天，末位即今天。
 * 用作趋势图横轴标签，避免在模板里写死静态文案（staticCoverage 会拦静态中文）。
 */
export function recentDayOfMonth(count: number, today: Date = new Date()): number[] {
  const size = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const base = today instanceof Date && !Number.isNaN(today.getTime()) ? today : new Date();
  const days: number[] = [];
  for (let offset = size - 1; offset >= 0; offset -= 1) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() - offset);
    days.push(day.getDate());
  }
  return days;
}
