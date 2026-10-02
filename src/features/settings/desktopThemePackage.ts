import type { DesktopThemeMode, DesktopThemeSurface, DesktopThemeVisuals, PerPageBackground, ThemeSettings } from '../../types';
import { createDefaultThemeSettings, mergeThemeSettings, type ThemeSettingsPatch } from './store';
import { toolboxApi } from '../../services/tauri/toolboxApi';

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

/** 主题包 v3 桌面页面清单（与服务端编辑器 SLOTS_JSON pages 对齐） */
export const DESKTOP_THEME_PAGE_IDS = ['main', 'playlist', 'player', 'local', 'fav', 'settings'] as const;

export interface DesktopThemePayload {
  accentColor: string;
  themeMode: DesktopThemeMode;
  quickEntryShape: DesktopThemeVisuals['quickEntryShape'];
  icons: Record<string, unknown>;
  stickers: Record<string, unknown>;
  surfaces: Record<string, unknown>;
  /** v3 每页壁纸原始条目（0-100 整数制），v2 包恒为空 map */
  wallpapers: Record<string, Record<string, unknown>>;
}

export interface DesktopThemePackage {
  version: 2 | 3;
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

/** 壁纸 ref 校验：远程 URL（≤512 字符）或内嵌 data URL（导入后由落盘步骤物化，避免 pinia persist 巨串） */
const isSafeWallpaperRef = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length > 0
  && !value.includes('\\')
  && (((value.startsWith('http://') || value.startsWith('https://')) && value.length <= 512)
    || (value.startsWith('data:image/') && value.length <= 16 * 1024 * 1024))
);

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

const readWallpapers = (value: unknown): Record<string, Record<string, unknown>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output: Record<string, Record<string, unknown>> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!isSlot(key, DESKTOP_THEME_PAGE_IDS) || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    output[key] = entry as Record<string, unknown>;
  }
  return output;
};

/* ------------------------------------------------------------------ */
/* v3 壁纸：0-100 整数制 → 桌面端 0-1 制                                */
/* ------------------------------------------------------------------ */

const readWpNumber = (wp: Record<string, unknown>, key: string, fallback: number): number => {
  const num = Number(wp[key]);
  return Number.isFinite(num) ? num : fallback;
};

const clampRange = (num: number, min: number, max: number): number => Math.max(min, Math.min(max, num));

const pageWallpaperToPerPageBackground = (wp: Record<string, unknown>): PerPageBackground | null => {
  if (!isSafeWallpaperRef(wp.ref)) return null;
  // 缺省值对齐服务端编辑器 wpDefault：scale=100、maskAlpha=40、blur=20、opacity=100、位移=0
  const maskAlpha = clampRange(readWpNumber(wp, 'maskAlpha', 40), 0, 100) / 100;
  return {
    imagePath: wp.ref,
    blur: clampRange(Math.round(readWpNumber(wp, 'blur', 20)), 0, 100),
    opacity: clampRange(readWpNumber(wp, 'opacity', 100), 0, 100) / 100,
    maskColor: '#000000',
    maskAlpha,
    scale: clampRange(readWpNumber(wp, 'scale', 100), 80, 240) / 100,
    translateX: clampRange(readWpNumber(wp, 'translateX', 0), -100, 100) / 100,
    translateY: clampRange(readWpNumber(wp, 'translateY', 0), -100, 100) / 100,
    foregroundStyle: maskAlpha >= 0.25 ? 'dark' : 'light',
  };
};

const wallpapersToPerPageBackgrounds = (
  wallpapers: Record<string, Record<string, unknown>>,
): Record<string, PerPageBackground> => {
  const output: Record<string, PerPageBackground> = {};
  for (const [pageId, wp] of Object.entries(wallpapers)) {
    const bg = pageWallpaperToPerPageBackground(wp);
    if (bg) output[pageId] = bg;
  }
  return output;
};

export function parseDesktopThemePackage(input: unknown): DesktopThemePackage {
  if (!input || typeof input !== 'object') throw new Error('主题 JSON 必须是对象');
  const source = input as Record<string, unknown>;
  if ((source.version !== 2 && source.version !== 3) || source.platform !== 'desktop') throw new Error('主题必须是 Desktop v2/v3 主题包');
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
    wallpapers: readWallpapers(payload.wallpapers),
  };
  return {
    version: source.version,
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
    perPageBackgrounds: wallpapersToPerPageBackgrounds(payload.wallpapers),
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

/* ---------------------------------------------------------------------- */
/* v3 壁纸物化：data URL 落盘 theme_assets，换包时清理不再引用的旧资产      */
/* ---------------------------------------------------------------------- */

/** 主题资产落盘目录标记（与 Rust save_theme_wallpaper 的 appData/theme_assets 对齐） */
const THEME_ASSET_DIR_MARKER = 'theme_assets';

const isThemeWallpaperAssetPath = (path: string): boolean => path.includes(THEME_ASSET_DIR_MARKER);

const dataUrlImageExt = (dataUrl: string): string | null => {
  const match = /^data:image\/(png|jpe?g|webp|gif)(;base64)?,/i.exec(dataUrl);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  return mime === 'jpeg' || mime === 'jpg' ? 'jpg' : mime;
};

const hashDataUrl = async (dataUrl: string): Promise<string> => {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataUrl));
      return Array.from(new Uint8Array(digest)).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // 哈希不可用时退化为随机名（仍可落盘，只是同一数据可能重复存文件）
  }
  return Math.random().toString(36).slice(2, 10);
};

/**
 * 应用主题包前的壁纸物化步骤：
 * - data URL ref → 解码落盘 appData/theme_assets（避免巨串进入 pinia persist）；
 * - 远程 URL ref 直接保留（GlobalBackground.isRemoteLike 已支持）；
 * - 落盘失败的页面丢弃该页壁纸（回落全局壁纸），不阻断整体应用。
 */
export async function materializeDesktopThemeWallpapers(
  next: ThemeSettings,
  previous?: ThemeSettings | null,
): Promise<ThemeSettings> {
  const keptPaths = new Set<string>();
  const materialized: Record<string, PerPageBackground> = {};
  for (const [pageId, bg] of Object.entries(next.perPageBackgrounds ?? {})) {
    const ref = bg.imagePath;
    if (ref.startsWith('data:image/')) {
      const ext = dataUrlImageExt(ref);
      if (!ext) continue;
      try {
        const hash = await hashDataUrl(ref);
        const localPath = await toolboxApi.saveThemeWallpaper(ref, `wp-${pageId}-${hash}`);
        materialized[pageId] = { ...bg, imagePath: localPath };
        keptPaths.add(localPath);
      } catch (error) {
        console.error('主题壁纸落盘失败，该页回落全局壁纸:', pageId, error);
      }
      continue;
    }
    materialized[pageId] = bg;
    if (isThemeWallpaperAssetPath(ref)) keptPaths.add(ref);
  }

  for (const bg of Object.values(previous?.perPageBackgrounds ?? {})) {
    if (isThemeWallpaperAssetPath(bg.imagePath) && !keptPaths.has(bg.imagePath)) {
      try {
        await toolboxApi.deleteThemeWallpaper(bg.imagePath);
      } catch {
        // 清理失败不影响应用流程（孤儿文件体量受包预算约束）
      }
    }
  }

  return { ...next, perPageBackgrounds: materialized };
}
