export interface PointerRect {
  left: number;
  width: number;
  bottom: number;
  height: number;
}

/**
 * 进度条命中换算：把指针横坐标映射为轨道时间（秒）。
 * 越界时钳制到轨道两端；轨道宽度为 0 时行为与原先一致（返回 NaN）。
 */
export const progressTimeFromPointer = (clientX: number, rect: PointerRect, duration: number): number => {
  const offsetX = Math.max(0, Math.min(clientX - rect.left, rect.width));
  return (offsetX / rect.width) * duration;
};

/**
 * 音量条命中换算：把指针纵坐标映射为 0–100 的整数音量。
 * 上端为满音量，越界时钳制。
 */
export const volumePercentFromPointer = (clientY: number, rect: PointerRect): number => {
  const distance = rect.bottom - clientY;
  const percent = Math.max(0, Math.min(1, distance / rect.height));
  return Math.round(percent * 100);
};
