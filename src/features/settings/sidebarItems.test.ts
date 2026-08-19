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

    // 榜单缺失时插到首页下方，其余缺失项按默认相对顺序追加到末尾
    expect(result.slice(0, 3)).toEqual(['topLists', 'account', 'favorites']);
    expect(result).toHaveLength(DEFAULT_SIDEBAR_ORDER.length);
    expect(result.slice(3)).toEqual(
      DEFAULT_SIDEBAR_ORDER.filter(key => key !== 'topLists' && key !== 'account' && key !== 'favorites'),
    );
  });

  it('inserts topLists below home when missing from a saved order', () => {
    const result = normalizeSidebarOrder(['localMusic', 'artists', 'albums']);

    expect(result[0]).toBe('topLists');
    expect(result.slice(1, 4)).toEqual(['localMusic', 'artists', 'albums']);
    expect(result).toHaveLength(DEFAULT_SIDEBAR_ORDER.length);
  });

  it('keeps a user-moved topLists position as-is', () => {
    const result = normalizeSidebarOrder(['localMusic', 'topLists', 'artists']);

    expect(result.slice(0, 3)).toEqual(['localMusic', 'topLists', 'artists']);
    expect(result).toHaveLength(DEFAULT_SIDEBAR_ORDER.length);
  });

  it('drops unknown or removed keys', () => {
    const result = normalizeSidebarOrder(['artists', 'statistics', 'nope', 'albums']);

    expect(result).not.toContain('statistics');
    expect(result).not.toContain('nope');
    expect(result.slice(1, 3)).toEqual(['artists', 'albums']);
    expect(result).toHaveLength(DEFAULT_SIDEBAR_ORDER.length);
  });

  it('removes duplicates while keeping the first occurrence', () => {
    const result = normalizeSidebarOrder(['recent', 'recent', 'artists', 'recent']);

    expect(result.slice(1, 3)).toEqual(['recent', 'artists']);
    expect(result.filter(key => key === 'recent')).toHaveLength(1);
    expect(result).toHaveLength(DEFAULT_SIDEBAR_ORDER.length);
  });

  it('ignores non-string entries', () => {
    const result = normalizeSidebarOrder(['folders', 42, {}, null, 'plugins']);

    expect(result.slice(1, 3)).toEqual(['folders', 'plugins']);
    expect(result).toHaveLength(DEFAULT_SIDEBAR_ORDER.length);
  });
});
