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
    // 行三/行四/行六的成对控件锚点：控件本体必须都在（网格不留空位）。
    // 此前断言依赖分组注释，注释清理后改用控件文本锚点。
    expect(source).toContain('>描边阴影<');
    expect(source).toContain('>双行显示<');
    expect(source).toContain('>字体方案<');
    expect(source).toContain('>配色方案<');
    expect(source).not.toContain('desktop-compact-row-full');
  });
});
