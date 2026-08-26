import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOPBAR_LAYOUT,
  normalizeTopBarLayout,
  setTopBarItemVisibility,
} from './topBarItems';

describe('topBarItems layout normalization and visibility', () => {
  it('correctly removes hidden items from left and right control lists', () => {
    const layout = normalizeTopBarLayout({
      left: ['back'],
      right: ['theme', 'colorScheme', 'settings', 'account'],
      hidden: ['theme'],
    });

    expect(layout.hidden).toContain('theme');
    expect(layout.right).not.toContain('theme');
    expect(layout.left).not.toContain('theme');
  });

  it('updates topBar layout when toggling visibility to false', () => {
    const initial = DEFAULT_TOPBAR_LAYOUT; // left: ['back'], right: ['theme', 'colorScheme', 'settings', 'account'], hidden: ['announcement']
    const updated = setTopBarItemVisibility(initial, 'theme', false);

    expect(updated.hidden).toContain('theme');
    expect(updated.right).not.toContain('theme');
    expect(updated.left).not.toContain('theme');
  });

  it('restores hidden items back to layout when toggling visibility to true', () => {
    const hiddenLayout = normalizeTopBarLayout({
      left: ['back'],
      right: ['settings', 'account'],
      hidden: ['theme', 'announcement', 'colorScheme'],
    });

    const restored = setTopBarItemVisibility(hiddenLayout, 'theme', true);
    expect(restored.hidden).not.toContain('theme');
    expect(restored.right.includes('theme') || restored.left.includes('theme')).toBe(true);
  });
});
