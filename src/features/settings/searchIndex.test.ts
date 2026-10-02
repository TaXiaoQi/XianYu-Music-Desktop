import { describe, expect, it } from 'vitest'; // 实现

import { SETTINGS_SEARCH_ITEMS, searchSettings } from './searchIndex'; // 实现

describe('settings search index', () => { // 实现
  it('indexes settings from every settings category', () => { // 实现
    expect(SETTINGS_SEARCH_ITEMS.length).toBeGreaterThan(100); // 实现
    expect(new Set(SETTINGS_SEARCH_ITEMS.map(item => item.tab))).toEqual(new Set([ // 实现
      'general',
      'theme',
      'desktopLyrics', // 实现
      'sleepTimer',
      'audioOutput', // 实现
      'download',
      'toolbox',
      'library',
      'linkage',
      'plugins',
      'shortcuts', // 实现
      'account',
      'network',
      'advanced',
      'feedback',
      'about',
    ]));
  });

  it('finds a precise setting by its name or related keywords', () => { // 实现
    expect(searchSettings('音量平衡')[0]?.label).toBe('音量平衡'); // 实现
    expect(searchSettings('ReplayGain').some(item => item.label === '音量平衡')).toBe(true); // 实现
    expect(searchSettings('缓存').some(item => item.label === '播放缓存上限')).toBe(true); // 实现
    expect(searchSettings('单声道').some(item => item.label === '单声道合并')).toBe(true);
  });

  it('does not expand children when a complete category name is entered', () => { // 实现
    expect(searchSettings('外观')).toMatchObject([ // 实现
      { kind: 'category', label: '外观', tab: 'theme' }, // 实现
    ]);
  });

  it('does not expand children when a complete section name is entered', () => { // 实现
    expect(searchSettings('动态背景')).toMatchObject([ // 实现
      { kind: 'section', label: '动态背景', tab: 'theme' }, // 实现
    ]);
  });

  it('indexes the accent color setting on the appearance page', () => { // 实现
    expect(searchSettings('\u4e3b\u9898\u8272')).toMatchObject([ // 实现
      { kind: 'section', label: '\u4e3b\u9898\u8272', tab: 'theme' }, // 实现
    ]);
  });

  it('indexes the player detail cover preference on the appearance page', () => { // 实现
    expect(searchSettings('\u6b4c\u8bcd\u9875\u5c01\u9762')).toMatchObject([ // 实现
      { kind: 'section', label: '\u6b4c\u8bcd\u9875\u5c01\u9762', tab: 'theme' }, // 实现
    ]);
  });
  it('indexes the network proxy settings on the network page', () => {
    expect(searchSettings('代理').some(item => item.label === '启用网络代理')).toBe(true);
  });
});
