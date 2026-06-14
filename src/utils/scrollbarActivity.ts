export const DEFAULT_SCROLLBAR_HOT_ZONE_PX = 48;

export const isPointerNearVerticalScrollbar = (
  clientX: number,
  rect: Pick<DOMRect, 'left' | 'right'>,
  hotZonePx = DEFAULT_SCROLLBAR_HOT_ZONE_PX,
) => {
  return clientX >= rect.right - hotZonePx && clientX <= rect.right && clientX >= rect.left;
};
