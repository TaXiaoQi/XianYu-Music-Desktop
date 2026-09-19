const DEFAULT_AUTO_SCROLL_EDGE_SIZE = 80;
const DEFAULT_AUTO_SCROLL_MAX_SPEED = 8;

export const findVerticalScrollContainer = (element: HTMLElement): HTMLElement | null => {
  let current = element.parentElement;
  while (current) {
    const { overflowY } = window.getComputedStyle(current);
    if ((overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
};

export const resolveDragTargetIndex = (
  listEl: HTMLElement | null,
  rowSelector: string,
  clientY: number,
  currentIndex: number,
): number | null => {
  if (!listEl) return null;

  const rows = Array.from(listEl.querySelectorAll<HTMLElement>(rowSelector));
  if (rows.length === 0) return null;

  let target = currentIndex;

  for (let i = currentIndex - 1; i >= 0; i--) {
    const rect = rows[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) target = i;
    else break;
  }

  if (target !== currentIndex) return target;

  for (let i = currentIndex + 1; i < rows.length; i++) {
    const rect = rows[i].getBoundingClientRect();
    if (clientY > rect.top + rect.height / 2) target = i;
    else break;
  }

  return target;
};

export const getEdgeAutoScrollSpeed = (
  container: HTMLElement,
  pointerY: number,
  edgeSize = DEFAULT_AUTO_SCROLL_EDGE_SIZE,
  maxSpeed = DEFAULT_AUTO_SCROLL_MAX_SPEED,
): number => {
  const rect = container.getBoundingClientRect();

  if (pointerY < rect.top + edgeSize) {
    const intensity = Math.min(1, (rect.top + edgeSize - pointerY) / edgeSize);
    return -maxSpeed * intensity;
  }

  if (pointerY > rect.bottom - edgeSize) {
    const intensity = Math.min(1, (pointerY - (rect.bottom - edgeSize)) / edgeSize);
    return maxSpeed * intensity;
  }

  return 0;
};
