/**
 * 数学通用工具
 */

/** 将数值钳制在 [min, max] 范围内 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
