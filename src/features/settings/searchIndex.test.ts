import { describe, expect, it } from 'vitest';

import { SETTINGS_SEARCH_ITEMS, searchSettings } from './searchIndex';

describe('settings search index', () => {
  it('indexes settings from every settings category', () => {
    expect(SETTINGS_SEARCH_ITEMS.length).toBeGreaterThan(100);
    expect(new Set(SETTINGS_SEARCH_ITEMS.map(item => item.tab))).toEqual(new Set([
      'general',
      'theme',
      'desktopLyrics',
      'audioOutput',
      'download',
      'toolbox',
      'library',
      'plugins',
      'shortcuts',
      'account',
      'advanced',
      'about',
    ]));
  });

  it('finds a precise setting by its name or related keywords', () => {
    expect(searchSettings('音量平衡')[0]?.label).toBe('音量平衡');
    expect(searchSettings('ReplayGain').some(item => item.label === '音量平衡')).toBe(true);
    expect(searchSettings('缓存').some(item => item.label === '播放缓存上限')).toBe(true);
  });

  it('does not expand children when a complete category name is entered', () => {
    expect(searchSettings('外观')).toMatchObject([
      { kind: 'category', label: '外观', tab: 'theme' },
    ]);
  });

  it('does not expand children when a complete section name is entered', () => {
    expect(searchSettings('动态背景')).toMatchObject([
      { kind: 'section', label: '动态背景', tab: 'theme' },
    ]);
  });
});
