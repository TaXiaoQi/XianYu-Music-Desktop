import { describe, expect, it } from 'vitest';
import { applyDesktopThemePackage, parseDesktopThemeJson } from './desktopThemePackage';

const validPackage = {
  version: 2,
  platform: 'desktop',
  name: '测试桌面主题',
  payload: {
    accentColor: '#123456',
    themeMode: 'dark',
    quickEntryShape: 'rounded',
    icons: {
      'nav.home': 'https://example.com/home.svg',
      'unknown.slot': 'C:\\secret.svg',
      'desktop.logo': 'C:\\secret-logo.svg',
    },
    stickers: {
      'sidebar.bottom': '/assets/sticker.png',
    },
    surfaces: {
      'search.box': { c: '#abcdef', o: 0.75 },
      'unknown.surface': { c: '#000000', o: 1 },
    },
  },
};

describe('desktop theme package', () => {
  it('accepts only desktop v2 slots and maps visual fields', () => {
    const result = applyDesktopThemePackage(validPackage);

    expect(result.settings.mode).toBe('dark');
    expect(result.settings.accentColor).toBe('#123456');
    expect(result.settings.desktopTheme.quickEntryShape).toBe('rounded');
    expect(result.settings.desktopTheme.icons).toEqual({ 'nav.home': 'https://example.com/home.svg' });
    expect(result.settings.desktopTheme.stickers).toEqual({ 'sidebar.bottom': '/assets/sticker.png' });
    expect(result.settings.desktopTheme.surfaces).toEqual({ 'search.box': { color: '#ABCDEF', opacity: 0.75 } });
  });

  it('rejects mobile packages and malformed JSON', () => {
    expect(() => applyDesktopThemePackage({ ...validPackage, platform: 'mobile' })).toThrow();
    expect(() => parseDesktopThemeJson('{')).toThrow('主题文件不是有效 JSON');
  });

  it('does not import custom media or personal behavior fields', () => {
    const result = applyDesktopThemePackage(validPackage);
    expect(result.settings.customBackground.imagePath).toBe('');
    expect(result.settings.customBgPath).toBe('');
    expect(result.settings.showLeaderboard).toBe(true);
    expect(result.settings.useCustomTrayMenu).toBe(true);
    expect(result.settings.windowMaterial).toBe('none');
    expect(result.settings.dynamicBgType).toBe('none');
  });
});
