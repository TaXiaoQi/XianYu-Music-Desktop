import { describe, expect, it } from 'vitest';

import { getLyricsStylePanelPosition } from './lyricsStylePanelPosition';

describe('getLyricsStylePanelPosition', () => {
  it('anchors the panel to the same viewport position with the cover visible', () => {
    expect(getLyricsStylePanelPosition({ left: 464, right: 1064, width: 600 }, 1600)).toEqual({
      right: 'auto',
      left: '-448px',
      marginLeft: '0',
      marginRight: '0',
    });
  });

  it('keeps that viewport position after the cover is hidden and lyrics expand', () => {
    expect(getLyricsStylePanelPosition({ left: 120, right: 1480, width: 1360 }, 1600)).toEqual({
      right: 'auto',
      left: '-104px',
      marginLeft: '0',
      marginRight: '0',
    });
  });

  it('allows the panel to shrink below its usual minimum on a narrow viewport', () => {
    expect(getLyricsStylePanelPosition({ left: 12, right: 212, width: 200 }, 240)).toMatchObject({
      left: '12px',
      width: '200px',
      minWidth: '200px',
    });
  });
});
