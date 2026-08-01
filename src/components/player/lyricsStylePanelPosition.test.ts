import { describe, expect, it } from 'vitest';

import { getLyricsStylePanelPosition } from './lyricsStylePanelPosition';

describe('getLyricsStylePanelPosition', () => {
  it('keeps the panel outside the lyrics when the cover column leaves enough room', () => {
    expect(getLyricsStylePanelPosition({ left: 464, right: 1064, width: 600 }, 1600)).toEqual({
      marginRight: '128px',
    });
  });

  it('overlays the panel inside the expanded lyrics area when both outside edges are too narrow', () => {
    expect(getLyricsStylePanelPosition({ left: 120, right: 1480, width: 1360 }, 1600)).toEqual({
      right: 'auto',
      left: '0',
      marginLeft: '0',
      marginRight: '0',
      width: '320px',
      minWidth: '260px',
    });
  });

  it('allows the overlay to shrink below its usual minimum on a narrow lyrics container', () => {
    expect(getLyricsStylePanelPosition({ left: 12, right: 212, width: 200 }, 240)).toMatchObject({
      left: '0',
      width: '200px',
      minWidth: '200px',
    });
  });
});
