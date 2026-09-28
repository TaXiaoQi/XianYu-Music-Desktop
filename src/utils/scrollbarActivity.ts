// 纵向滚动条「热区」判定工具。
// 当指针横向坐标落入容器右缘一段固定宽度内时，视为正在与滚动条交互，
// 供列表组件决定是否点亮 / 加粗滚动条等 UI 反馈。

/** 热区默认宽度（像素）：从容器右缘向内计算。 */
export const DEFAULT_SCROLLBAR_HOT_ZONE_PX = 48;

/**
 * 判断指针是否处于纵向滚动条热区。
 * 需同时满足两个条件：
 * 1. 横坐标在 [right - hotZonePx, right] 区间内（贴近右缘）；
 * 2. 横坐标未越过容器左边界。
 */
export function isPointerNearVerticalScrollbar(
  clientX: number,
  rect: Pick<DOMRect, 'left' | 'right'>,
  hotZonePx: number = DEFAULT_SCROLLBAR_HOT_ZONE_PX,
): boolean {
  const zoneLeftEdge = rect.right - hotZonePx;

  return clientX >= zoneLeftEdge && clientX <= rect.right && clientX >= rect.left;
}
