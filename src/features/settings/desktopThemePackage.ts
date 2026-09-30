import type { DesktopThemeMode, DesktopThemeSurface, DesktopThemeVisuals } from '../../types';
import { createDefaultThemeSettings, mergeThemeSettings, type ThemeSettingsPatch } from './store';

export const DESKTOP_THEME_ICON_SLOTS = [
  'desktop.logo', 'nav.home', 'nav.settings',
  'player.prev', 'player.play', 'player.next', 'player.queue', 'player.mode', 'player.lyric',
  'player.comment', 'player.volume', 'player.sound', 'player.mv', 'player.visualizer', 'player.progress',
  'player.style', 'player.pin', 'action.search', 'action.mic', 'desktop.wallpaper', 'desktop.settings',
  'page.playall', 'page.sort', 'page.more', 'page.fav', 'action.favorite', 'action.download',
  'action.share', 'action.more', 'action.new_playlist',
] as const;

export const DESKTOP_THEME_STICKER_SLOTS = ['player.corner', 'sidebar.bottom'] as const;
export const DESKTOP_THEME_SURFACE_SLOTS = [
  'nav.bar', 'mini.bar', 'search.box', 'home.stat', 'home.song', 'mine.user', 'mine.stats', 'mine.grid',
  'mine.sheet', 'recognize.hint', 'recognize.btn', 'search.panel', 'search.item', 'sr.chips', 'sr.pill',
  'sr.item', 'ls-home.daily', 'ls-home.most', 'ls-lib.row', 'ls-sheets.card', 'settings.topbar',
  'settings.group', 'ls-settings.nav', 'ls-settings.detail', 'ls-mine.count',
] as const;

export interface DesktopThemePayload {
  accentColor: string;
  themeMode: DesktopThemeMode;
  quickEntryShape: DesktopThemeVisuals['quickEntryShape'];
  icons: Record<string, unknown>;
  stickers: Record<string, unknown>;
  surfaces: Record<string, unknown>;
}

export interface DesktopThemePackage {
  version: 2;
  platform: 'desktop';
  name?: string;
  author?: string;
  preview?: string;
  payload: DesktopThemePayload;
}

export interface DesktopThemeImportResult {
  package: DesktopThemePackage;
  patch: ThemeSettingsPatch;
  settings: ReturnType<typeof createDefaultThemeSettings>;
}

const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const isSafeAsset = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= 512
  && !value.includes('\\')
  && (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/') || value.startsWith('data:image/'))
);
const isSlot = (value: string, slots: readonly string[]) => slots.includes(value);

const readAssets = (input: Record<string, unknown>, slots: readonly string[]) => {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (isSlot(key, slots) && isSafeAsset(value)) output[key] = value;
  }
  return output;
};

const readSurfaces = (input: Record<string, unknown>): Record<string, DesktopThemeSurface> => {
  const output: Record<string, DesktopThemeSurface> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isSlot(key, DESKTOP_THEME_SURFACE_SLOTS) || !value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    const opacity = Number(record.o);
    if (!isHexColor(record.c) || !Number.isFinite(opacity)) continue;
    output[key] = { color: record.c.toUpperCase(), opacity: Math.max(0, Math.min(1, opacity)) };
  }
  return output;
};

export function parseDesktopThemePackage(input: unknown): DesktopThemePackage {
  if (!input || typeof input !== 'object') throw new Error('主题 JSON 必须是对象');
  const source = input as Record<string, unknown>;
  if (source.version !== 2 || source.platform !== 'desktop') throw new Error('主题必须是 Desktop v2 主题包');
  if (!source.payload || typeof source.payload !== 'object') throw new Error('主题缺少 payload');
  const payload = source.payload as Record<string, unknown>;
  if (!isHexColor(payload.accentColor)) throw new Error('主题强调色无效');
  if (payload.themeMode !== 'light' && payload.themeMode !== 'dark') throw new Error('主题模式无效');
  if (payload.quickEntryShape !== 'circle' && payload.quickEntryShape !== 'rounded' && payload.quickEntryShape !== 'square') {
    throw new Error('快捷入口形状无效');
  }
  const readObject = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const normalizedPayload: DesktopThemePayload = {
    accentColor: payload.accentColor.toUpperCase(),
    themeMode: payload.themeMode,
    quickEntryShape: payload.quickEntryShape,
    icons: readObject(payload.icons),
    stickers: readObject(payload.stickers),
    surfaces: readObject(payload.surfaces),
  };
  return {
    version: 2,
    platform: 'desktop',
    name: typeof source.name === 'string' ? source.name : undefined,
    author: typeof source.author === 'string' ? source.author : undefined,
    preview: typeof source.preview === 'string' && isSafeAsset(source.preview) ? source.preview : undefined,
    payload: normalizedPayload,
  };
}

export function desktopThemeToPatch(themePackage: DesktopThemePackage): ThemeSettingsPatch {
  const payload = themePackage.payload;
  return {
    mode: payload.themeMode,
    accentColor: payload.accentColor,
    desktopTheme: {
      quickEntryShape: payload.quickEntryShape,
      icons: readAssets(payload.icons, DESKTOP_THEME_ICON_SLOTS),
      stickers: readAssets(payload.stickers, DESKTOP_THEME_STICKER_SLOTS),
      surfaces: readSurfaces(payload.surfaces),
    },
  };
}

export function applyDesktopThemePackage(input: unknown): DesktopThemeImportResult {
  const themePackage = parseDesktopThemePackage(input);
  const patch = desktopThemeToPatch(themePackage);
  const settings = mergeThemeSettings(createDefaultThemeSettings(), patch);
  return { package: themePackage, patch, settings };
}

export function parseDesktopThemeJson(text: string): DesktopThemeImportResult {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error('主题文件不是有效 JSON');
  }
  return applyDesktopThemePackage(input);
}
