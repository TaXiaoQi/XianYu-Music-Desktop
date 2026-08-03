import { describe, expect, it } from 'vitest';

import source from './SettingsDesktopLyrics.vue?raw';

describe('SettingsDesktopLyrics preview copy', () => {
  it('uses the requested coastline lyric and translation', () => {
    expect(source).toContain('>I\'m leaving&nbsp;</span>');
    expect(source).toContain('>home&nbsp;</span>');
    expect(source).toContain('>for the coastline</span>');
    expect(source).toContain('我要离开家去往海岸线');
    expect(source).not.toContain('第一次参观卢浮宫');
  });

  it('shows color schemes as a labeled dropdown', () => {
    expect(source).toContain('@click="toggleColorSchemeMenu"');
    expect(source).toContain('{{ selectedColorScheme.label }}');
    expect(source).toContain('{{ option.label }}');
    expect(source).toContain('{{ option.hint }}');
    expect(source).toContain('@click="selectColorSchemeFromMenu(option.value)"');
    expect(source).not.toContain('desktop-compact-selector-scheme');
  });

  it('pairs typography controls without leaving an empty grid cell', () => {
    expect(source).toContain('<!-- 行三：描边阴影 & 阴影颜色 -->');
    expect(source).toContain('<!-- 行四：对齐方式 & 双行显示 -->');
    expect(source).toContain('<!-- 行六：字体方案 & 配色方案 -->');
    expect(source).not.toContain('desktop-compact-row-full');
  });
});
