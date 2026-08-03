import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FOOTER_LAYOUT,
  computeCollapsedItems,
  getFooterPreviewSlotItems,
  moveFooterItemToPreviewSlot,
  normalizeFooterLayout,
  setFooterItemVisibility,
} from './footerItems';

describe('footer layout visual editor helpers', () => {
  it('migrates legacy layouts with every button visible', () => {
    const layout = normalizeFooterLayout({
      left: ['favorite', 'download'],
      middleLeft: 'playMode',
      middleRight: 'desktopLyrics',
      right: ['quality', 'volume', 'equalizer', 'playlist'],
    });

    expect(layout.hidden).toEqual([]);
    expect(computeCollapsedItems(layout)).toEqual([]);
  });

  it('really hides a button instead of moving it into more tools', () => {
    const hidden = setFooterItemVisibility(DEFAULT_FOOTER_LAYOUT, 'equalizer', false);

    expect(hidden.hidden).toContain('equalizer');
    expect(hidden.right).toContain('equalizer');
    expect(computeCollapsedItems(hidden)).not.toContain('equalizer');

    const visibleAgain = setFooterItemVisibility(hidden, 'equalizer', true);
    expect(visibleAgain.hidden).not.toContain('equalizer');
    expect(visibleAgain.right).toContain('equalizer');
  });

  it('keeps the right-side buttons compacted against the right edge', () => {
    const hidden = setFooterItemVisibility(DEFAULT_FOOTER_LAYOUT, 'equalizer', false);
    const slots = getFooterPreviewSlotItems(hidden);

    expect(slots['right-0']).toBeNull();
    expect(slots['right-1']).toBe('quality');
    expect(slots['right-2']).toBe('volume');
    expect(slots['right-3']).toBe('playlist');
    expect(slots['right-4']).toBeNull();
  });

  it('does not move buttons across the fixed footer regions when hiding one', () => {
    const hidden = setFooterItemVisibility(DEFAULT_FOOTER_LAYOUT, 'playMode', false);
    const slots = getFooterPreviewSlotItems(hidden);

    expect(slots['middle-left']).toBeNull();
    expect(slots['middle-right']).toBe('desktopLyrics');
    expect(slots['right-0']).toBe('quality');
  });

  it('lets another button take a hidden slot and moves the vacancy to its source', () => {
    const hidden = setFooterItemVisibility(DEFAULT_FOOTER_LAYOUT, 'equalizer', false);
    const moved = moveFooterItemToPreviewSlot(hidden, 'playlist', 'right-0');
    const slots = getFooterPreviewSlotItems(moved);

    expect(slots['right-0']).toBe('playlist');
    expect(slots['right-4']).toBeNull();
    expect(moved.hidden).toContain('equalizer');
  });

  it('swaps two buttons by their positions in the preview', () => {
    const moved = moveFooterItemToPreviewSlot(DEFAULT_FOOTER_LAYOUT, 'favorite', 'right-0');
    const slots = getFooterPreviewSlotItems(moved);

    expect(slots['right-0']).toBe('favorite');
    expect(slots['left-0']).toBe('quality');
  });
});
