import { describe, expect, it } from 'vitest';

import { isPointerNearVerticalScrollbar } from './scrollbarActivity';

describe('scrollbar activity helpers', () => {
  const rect = {
    left: 100,
    right: 500,
  } as DOMRect;

  it('treats pointer positions inside the right edge zone as near the vertical scrollbar', () => {
    expect(isPointerNearVerticalScrollbar(452, rect, 48)).toBe(true);
    expect(isPointerNearVerticalScrollbar(500, rect, 48)).toBe(true);
  });

  it('ignores pointer positions outside the right edge zone or outside the container', () => {
    expect(isPointerNearVerticalScrollbar(451, rect, 48)).toBe(false);
    expect(isPointerNearVerticalScrollbar(520, rect, 48)).toBe(false);
    expect(isPointerNearVerticalScrollbar(99, rect, 48)).toBe(false);
  });
});
