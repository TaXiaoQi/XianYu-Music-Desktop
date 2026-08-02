export interface LyricsStylePanelContainerRect {
  left: number;
  right: number;
  width: number;
}

export function getLyricsStylePanelPosition(
  containerRect: LyricsStylePanelContainerRect,
  viewportWidth: number,
): Record<string, string> {
  const safeMargin = 16;
  const naturalWidth = Math.min(320, viewportWidth * 0.34 - 24);
  const panelWidth = Math.max(260, naturalWidth);
  const defaultMarginRight = viewportWidth >= 1536 ? viewportWidth * 0.22 : viewportWidth * 0.14;
  const availableSpaceLeft = containerRect.left - safeMargin;
  const availableSpaceRight = viewportWidth - containerRect.right - safeMargin;
  const maxMarginRight = availableSpaceLeft - panelWidth;

  if (maxMarginRight >= 0) {
    return defaultMarginRight > maxMarginRight
      ? { marginRight: `${Math.round(maxMarginRight)}px` }
      : {};
  }

  if (availableSpaceRight >= panelWidth) {
    return {
      right: 'auto',
      left: '100%',
      marginLeft: `${safeMargin}px`,
      marginRight: '0',
    };
  }

  // Pure-lyrics mode expands the lyrics container across the viewport, leaving
  // no room on either outside edge. Keep the editor inside that container.
  const overlayWidth = Math.min(panelWidth, Math.max(1, containerRect.width));
  const overlayMinWidth = Math.min(260, overlayWidth);

  return {
    right: 'auto',
    left: '0',
    marginLeft: '0',
    marginRight: '0',
    width: `${Math.round(overlayWidth)}px`,
    minWidth: `${Math.round(overlayMinWidth)}px`,
  };
}
