import { describe, expect, it, vi } from 'vitest';

import { signedRequest } from '../../services/auth/authService';
import {
  applyDesktopThemePackage,
} from './desktopThemePackage';
import {
  listThemeSquare,
  squareAbsoluteUrl,
  squareItemPackage,
  squareItemPreview,
  type ThemeSquareItem,
} from './themeSquare';

// 只 mock 网络通道；getAuthBaseUrl 走 authSession 真实默认值（离线确定性）。
vi.mock('../../services/auth/authService', () => ({
  signedRequest: vi.fn(),
}));

const signedRequestMock = vi.mocked(signedRequest);

const item: ThemeSquareItem = {
  id: 7,
  name: '夜航',
  theme: {
    version: 2,
    platform: 'desktop',
    name: '夜航',
    author: 'tester',
    preview: '/uploads/themes/theme_7/preview.jpg',
    payload: {
      accentColor: '#123456',
      themeMode: 'dark',
      quickEntryShape: 'rounded',
      icons: {
        'nav.home': '/uploads/themes/theme_7/nav_home.png',
        'nav.settings': 'https://cdn.example.com/settings.png',
      },
      stickers: { 'sidebar.bottom': '/uploads/themes/theme_7/bottom.png' },
      surfaces: { 'search.box': { c: '#abcdef', o: 0.75 } },
    },
  },
  previewUrl: '/uploads/themes/theme_7/preview.jpg',
  thumbnailUrl: '/uploads/themes/theme_7/thumb.jpg',
  uploaderNickname: '上传者',
};

describe('theme square', () => {
  it('补全相对资源路径为服务端绝对地址，绝对地址与 data: 原样保留', () => {
    // 默认 base = https://api.xianyumusic.cn/api → 站点根 https://api.xianyumusic.cn
    expect(squareAbsoluteUrl('/uploads/themes/a.png')).toBe('https://api.xianyumusic.cn/uploads/themes/a.png');
    expect(squareAbsoluteUrl('uploads/a.png')).toBe('https://api.xianyumusic.cn/uploads/a.png');
    expect(squareAbsoluteUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(squareAbsoluteUrl('data:image/png;base64,xxx')).toBe('data:image/png;base64,xxx');
    expect(squareAbsoluteUrl('')).toBe('');
  });

  it('squareItemPackage 只补全 icons/stickers/preview 的 URL，surfaces 原样', () => {
    const pkg = squareItemPackage(item) as {
      preview: string;
      payload: { icons: Record<string, string>; stickers: Record<string, string>; surfaces: Record<string, unknown> };
    };

    expect(pkg.preview).toBe('https://api.xianyumusic.cn/uploads/themes/theme_7/preview.jpg');
    expect(pkg.payload.icons['nav.home']).toBe('https://api.xianyumusic.cn/uploads/themes/theme_7/nav_home.png');
    expect(pkg.payload.icons['nav.settings']).toBe('https://cdn.example.com/settings.png');
    expect(pkg.payload.stickers['sidebar.bottom']).toBe('https://api.xianyumusic.cn/uploads/themes/theme_7/bottom.png');
    expect(pkg.payload.surfaces).toEqual({ 'search.box': { c: '#abcdef', o: 0.75 } });
  });

  it('展示图优先缩略图并补全', () => {
    expect(squareItemPreview(item)).toBe('https://api.xianyumusic.cn/uploads/themes/theme_7/thumb.jpg');
    expect(squareItemPreview({ ...item, thumbnailUrl: '' })).toBe('https://api.xianyumusic.cn/uploads/themes/theme_7/preview.jpg');
  });

  it('补全后的包能通过 applyDesktopThemePackage 校验并应用', () => {
    const result = applyDesktopThemePackage(squareItemPackage(item));

    expect(result.package.name).toBe('夜航');
    expect(result.settings.accentColor).toBe('#123456');
    expect(result.settings.desktopTheme.icons['nav.home']).toBe('https://api.xianyumusic.cn/uploads/themes/theme_7/nav_home.png');
  });

  it('listThemeSquare 透传数组、对非数组 data 回落空列表', async () => {
    signedRequestMock.mockResolvedValueOnce([item] as unknown as ThemeSquareItem[]);
    await expect(listThemeSquare()).resolves.toHaveLength(1);

    signedRequestMock.mockResolvedValueOnce({ unexpected: true } as unknown as ThemeSquareItem[]);
    await expect(listThemeSquare()).resolves.toEqual([]);
  });
});
