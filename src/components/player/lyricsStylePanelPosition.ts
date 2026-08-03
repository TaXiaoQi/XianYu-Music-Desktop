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
  const renderedPanelWidth = Math.min(
    panelWidth,
    Math.max(1, containerRect.width),
    Math.max(1, viewportWidth - safeMargin * 2),
  );

  // Use the cover-visible layout as the canonical viewport anchor. The lyrics
  // container expands and moves left when the cover is hidden, so positioning
  // relative to that container would otherwise move the panel as well.
  const coverColumnWidth = Math.max(300, viewportWidth * 0.4);
  const coverModeLyricsLeft = 32 + coverColumnWidth + 8;
  const preferredViewportLeft = coverModeLyricsLeft - defaultMarginRight - renderedPanelWidth;
  const maximumViewportLeft = Math.max(safeMargin, viewportWidth - safeMargin - renderedPanelWidth);
  const viewportLeft = Math.min(
    maximumViewportLeft,
    Math.max(safeMargin, preferredViewportLeft),
  );

  const position: Record<string, string> = {
    right: 'auto',
    left: `${Math.round(viewportLeft - containerRect.left)}px`,
    marginLeft: '0',
    marginRight: '0',
  };

  if (renderedPanelWidth < panelWidth) {
    position.width = `${Math.round(renderedPanelWidth)}px`;
    position.minWidth = `${Math.round(Math.min(260, renderedPanelWidth))}px`;
  }

  return position;
}
