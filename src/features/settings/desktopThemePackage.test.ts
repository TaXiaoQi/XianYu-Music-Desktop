import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  applyDesktopThemePackage,
  materializeDesktopThemeWallpapers,
  parseDesktopThemeJson,
} from './desktopThemePackage';
import { mergeThemeSettings, createDefaultThemeSettings } from './store';

vi.mock('../../services/tauri/toolboxApi', () => ({
  toolboxApi: {
    saveThemeWallpaper: vi.fn(async (dataUrl: string, filename: string) => {
      const ext = dataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
      return `C:\\Users\\demo\\AppData\\Roaming\\XianYuMusic\\theme_assets\\${filename}.${ext}`;
    }),
    deleteThemeWallpaper: vi.fn(async () => undefined),
  },
}));

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

describe('desktop theme package v3 wallpapers', () => {
  const v3Package = {
    version: 3,
    platform: 'desktop',
    name: 'v3 桌面主题',
    payload: {
      ...validPackage.payload,
      wallpapers: {
        main: {
          ref: 'https://cdn.example.com/main.jpg',
          blur: 30, opacity: 80, maskAlpha: 50, scale: 150, translateX: -20, translateY: 10,
        },
        fav: { ref: 'data:image/png;base64,AAAA' },
        player: { ref: 'https://cdn.example.com/p.jpg', scale: 200, landscapeScale: 300 },
        settings: { ref: 'C:\\evil.png' },
        unknown_page: { ref: 'https://cdn.example.com/x.jpg' },
      },
    },
  };

  it('accepts v3 packages and converts wallpapers to 0-1 units', () => {
    const result = applyDesktopThemePackage(v3Package);
    expect(result.package.version).toBe(3);

    const walls = result.settings.perPageBackgrounds;
    expect(Object.keys(walls).sort()).toEqual(['fav', 'main', 'player']);
    expect(walls.main).toEqual({
      imagePath: 'https://cdn.example.com/main.jpg',
      blur: 30, opacity: 0.8,
      maskColor: '#000000', maskAlpha: 0.5,
      scale: 1.5, translateX: -0.2, translateY: 0.1,
      foregroundStyle: 'dark',
    });
    // 缺省值对齐编辑器 wpDefault：blur=20 / opacity=1 / maskAlpha=0.4 / scale=1 / 位移 0；遮罩 ≥25% 判定为深色前景
    expect(walls.fav).toEqual({
      imagePath: 'data:image/png;base64,AAAA',
      blur: 20, opacity: 1,
      maskColor: '#000000', maskAlpha: 0.4,
      scale: 1, translateX: 0, translateY: 0,
      foregroundStyle: 'dark',
    });
    // 横屏字段（landscapeScale）在桌面端忽略
    expect(walls.player?.scale).toBe(2);
  });

  it('treats v2 packages as an empty per-page wallpaper map', () => {
    const result = applyDesktopThemePackage(validPackage);
    expect(result.settings.perPageBackgrounds).toEqual({});
  });

  it('still rejects non v2/v3 versions and mobile packages', () => {
    expect(() => applyDesktopThemePackage({ ...v3Package, version: 4 })).toThrow('主题必须是 Desktop v2/v3 主题包');
    expect(() => applyDesktopThemePackage({ ...v3Package, platform: 'mobile' })).toThrow();
  });

  it('merges per-page wallpapers by full replacement and normalizes persisted values', () => {
    const base = createDefaultThemeSettings();
    const merged = mergeThemeSettings(base, {
      perPageBackgrounds: {
        main: {
          imagePath: '/assets/wall.png', blur: 999, opacity: 2, maskAlpha: -1,
          scale: 99, translateX: -5, translateY: 5, foregroundStyle: 'dark',
        },
        'bad key!': { imagePath: '/assets/x.png' },
        broken: { imagePath: '' },
      },
    });
    expect(Object.keys(merged.perPageBackgrounds)).toEqual(['main']);
    expect(merged.perPageBackgrounds.main).toMatchObject({
      blur: 100, opacity: 1, maskAlpha: 0, scale: 2.4, translateX: -1, translateY: 1,
    });

    // patch 不带 perPageBackgrounds 时保留基础值（整体替换语义）
    const kept = mergeThemeSettings(merged, { accentColor: '#654321' });
    expect(kept.perPageBackgrounds).toEqual(merged.perPageBackgrounds);
  });

  describe('materializeDesktopThemeWallpapers', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('saves data URLs to theme_assets and keeps remote refs untouched', async () => {
      const { toolboxApi } = await import('../../services/tauri/toolboxApi');
      const result = applyDesktopThemePackage(v3Package);

      const materialized = await materializeDesktopThemeWallpapers(result.settings, null);

      expect(toolboxApi.saveThemeWallpaper).toHaveBeenCalledTimes(1);
      expect(toolboxApi.saveThemeWallpaper).toHaveBeenCalledWith('data:image/png;base64,AAAA', expect.stringMatching(/^wp-fav-[0-9a-f]{16}$/));
      expect(materialized.perPageBackgrounds.fav?.imagePath).toContain('theme_assets');
      expect(materialized.perPageBackgrounds.fav?.imagePath).toMatch(/\.png$/);
      expect(materialized.perPageBackgrounds.main?.imagePath).toBe('https://cdn.example.com/main.jpg');
      expect(toolboxApi.deleteThemeWallpaper).not.toHaveBeenCalled();
    });

    it('drops pages whose data URL cannot be saved instead of failing the apply', async () => {
      const { toolboxApi } = await import('../../services/tauri/toolboxApi');
      vi.mocked(toolboxApi.saveThemeWallpaper).mockRejectedValueOnce(new Error('disk full'));
      const result = applyDesktopThemePackage(v3Package);

      const materialized = await materializeDesktopThemeWallpapers(result.settings, null);

      expect(materialized.perPageBackgrounds.fav).toBeUndefined();
      expect(materialized.perPageBackgrounds.main).toBeDefined();
    });

    it('deletes previous theme assets that are no longer referenced', async () => {
      const { toolboxApi } = await import('../../services/tauri/toolboxApi');
      const previous = applyDesktopThemePackage(v3Package).settings;
      const oldAsset = 'C:\\Users\\demo\\AppData\\Roaming\\XianYuMusic\\theme_assets\\wp-fav-deadbeef.png';
      previous.perPageBackgrounds = {
        fav: { ...previous.perPageBackgrounds.fav!, imagePath: oldAsset },
      };

      const next = applyDesktopThemePackage(validPackage).settings; // v2 包：无每页壁纸
      const materialized = await materializeDesktopThemeWallpapers(next, previous);

      expect(materialized.perPageBackgrounds).toEqual({});
      expect(toolboxApi.deleteThemeWallpaper).toHaveBeenCalledWith(oldAsset);
    });
  });
});
