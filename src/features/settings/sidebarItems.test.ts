import { describe, expect, it } from 'vitest';

import { DEFAULT_SIDEBAR_ORDER, normalizeSidebarOrder } from './sidebarItems';

describe('normalizeSidebarOrder', () => {
  it('falls back to the default order for non-array input', () => {
    expect(normalizeSidebarOrder(undefined)).toEqual(DEFAULT_SIDEBAR_ORDER);
    expect(normalizeSidebarOrder(null)).toEqual(DEFAULT_SIDEBAR_ORDER);
    expect(normalizeSidebarOrder('artists')).toEqual(DEFAULT_SIDEBAR_ORDER);
  });

  it('returns the default order for an empty array', () => {
    expect(normalizeSidebarOrder([])).toEqual(DEFAULT_SIDEBAR_ORDER);
  });

  it('keeps a valid custom order as-is', () => {
    const custom = [...DEFAULT_SIDEBAR_ORDER].reverse();
    expect(normalizeSidebarOrder(custom)).toEqual(custom);
  });

  it('appends missing keys so newly added items are never lost', () => {
    const result = normalizeSidebarOrder(['account', 'favorites']);

    expect(result.slice(0, 2)).toEqual(['account', 'favorites']);
    expect(result).toHaveLength(DEFAULT_SIDEBAR_ORDER.length);
    // 补齐的部分保持默认相对顺序
    expect(result.slice(2)).toEqual(
      DEFAULT_SIDEBAR_ORDER.filter(key => key !== 'account' && key !== 'favorites'),
    );
  });

  it('drops unknown or removed keys', () => {
    const result = normalizeSidebarOrder(['artists', 'statistics', 'nope', 'albums']);

    expect(result).not.toContain('statistics');
    expect(result).not.toContain('nope');
    expect(result.slice(0, 2)).toEqual(['artists', 'albums']);
    expect(result).toHaveLength(DEFAULT_SIDEBAR_ORDER.length);
  });

  it('removes duplicates while keeping the first occurrence', () => {
    const result = normalizeSidebarOrder(['recent', 'recent', 'artists', 'recent']);

    expect(result.slice(0, 2)).toEqual(['recent', 'artists']);
    expect(result.filter(key => key === 'recent')).toHaveLength(1);
    expect(result).toHaveLength(DEFAULT_SIDEBAR_ORDER.length);
  });

  it('ignores non-string entries', () => {
    const result = normalizeSidebarOrder(['folders', 42, {}, null, 'plugins']);

    expect(result.slice(0, 2)).toEqual(['folders', 'plugins']);
    expect(result).toHaveLength(DEFAULT_SIDEBAR_ORDER.length);
  });
});
