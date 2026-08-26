import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FOOTER_LAYOUT,
  computeCollapsedItems,
  dropFooterItemToPalette,
  dropFooterItemToSlot,
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
    // 旧布局未包含 mv、share：不在任何容器，默认进入折叠收纳菜单
    // 歌词页专属项（可视化/进度条/页面样式/固定）默认也留在折叠菜单
    expect(computeCollapsedItems(layout)).toEqual(['mv', 'share', 'visualizer', 'progress', 'pageStyle', 'pin']);
  });

  it('moves a disabled main-bar button into more tools', () => {
    const hidden = setFooterItemVisibility(DEFAULT_FOOTER_LAYOUT, 'equalizer', false);

    expect(hidden.hidden).toContain('equalizer');
    expect(hidden.right).toContain('equalizer');
    expect(computeCollapsedItems(hidden)).toContain('equalizer');

    const visibleAgain = setFooterItemVisibility(hidden, 'equalizer', true);
    expect(visibleAgain.hidden).not.toContain('equalizer');
    expect(visibleAgain.right).toContain('equalizer');
    expect(computeCollapsedItems(visibleAgain)).not.toContain('equalizer');
  });

  it('keeps the right-side buttons compacted against the right edge', () => {
    const hidden = setFooterItemVisibility(DEFAULT_FOOTER_LAYOUT, 'equalizer', false);
    const slots = getFooterPreviewSlotItems(hidden);

    // 隐藏 equalizer 时，equalizer 留在 right-0 槽位但被标记为 hidden（因此 visible 为 null）；
    // 其余可见项保持相对顺序靠右紧凑，playlist 作为默认第 5 项占据 right-4。
    expect(slots['right-0']).toBeNull();
    expect(slots['right-1']).toBe('quality');
    expect(slots['right-2']).toBe('comment');
    expect(slots['right-3']).toBe('volume');
    expect(slots['right-4']).toBe('playlist');
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

    // playlist 占据 right-0；equalizer 被置换到原 playlist 的 right-4 槽位（hidden → visible 为 null）；
    // comment 仍在 right-2，不与 hidden 项的空槽位重叠。
    expect(slots['right-0']).toBe('playlist');
    expect(slots['right-1']).toBe('quality');
    expect(slots['right-2']).toBe('comment');
    expect(slots['right-3']).toBe('volume');
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

describe('unified drag helpers (bar ⇄ more tools)', () => {
  it('drops a palette item into a bar slot, pushing the occupant back to the palette', () => {
    const next = dropFooterItemToSlot(DEFAULT_FOOTER_LAYOUT, 'visualizer', 'right-0');
    const slots = getFooterPreviewSlotItems(next);

    expect(slots['right-0']).toBe('visualizer');
    // 原 right-0（quality）被推到收纳区
    expect(computeCollapsedItems(next)).toContain('quality');
    expect(next.hidden).not.toContain('visualizer');
  });

  it('clears an item from the bar when collapsed into the more tools', () => {
    const next = dropFooterItemToPalette(DEFAULT_FOOTER_LAYOUT, 'volume', -1);
    const slots = getFooterPreviewSlotItems(next);

    expect(Object.values(slots)).not.toContain('volume');
    expect(computeCollapsedItems(next)).toContain('volume');
  });

  it('drops a palette item at a specific collapsed position', () => {
    const ordered = dropFooterItemToPalette(DEFAULT_FOOTER_LAYOUT, 'mv', 0);
    const collapsed = computeCollapsedItems(ordered);

    expect(collapsed[0]).toBe('mv');
  });

  it('reorders palette items by moving to a lower index', () => {
    const base = dropFooterItemToPalette(DEFAULT_FOOTER_LAYOUT, 'share', 0);
    const reordered = dropFooterItemToPalette(base, 'share', 2);
    const collapsed = computeCollapsedItems(reordered);

    expect(collapsed[2]).toBe('share');
  });
});
