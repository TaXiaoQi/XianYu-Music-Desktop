import { defineStore } from 'pinia'; // 实现
import { computed, ref } from 'vue';

import type { // 实现
  ThemeSettings, SidebarSettings, FooterLayoutSettings, TopBarLayoutSettings,
  AudioSettings, LyricsSettings, DesktopLyricsSettings,
  DownloadSettings, UploadSettings, PluginSettings, AutoSyncConfig, LogSettings,
  ImportedLyricsFont, EqualizerPreset, MvQualityKey, AppSettings, DesktopThemeSurface, DesktopThemeVisuals,
  PerPageBackground,
} from '../../types'; // 实现
import { MV_QUALITY_KEYS, ALL_QUALITY_KEYS } from '../../types';
import { AUDIO_FILE_ASSOCIATION_EXTENSIONS } from './audioFileAssociations';
import { normalizeThemeColor, DEFAULT_THEME_COLOR } from '../../utils/themeColor';
import {
  normalizeImportedLyricsFonts,
  mergeDesktopLyricsSettings, // 实现
  mergeLyricsSettings, // 实现
  createDefaultDesktopLyricsSettings,
  createDefaultLyricsSettings,
} from '../../composables/lyrics/constants';
import {
  type ShortcutSettingsPatch,
  createDefaultShortcutSettings, // 实现
  mergeShortcutSettings, // 实现
} from './shortcuts'; // 实现
import { normalizeSidebarOrder, DEFAULT_SIDEBAR_ORDER } from './sidebarItems';
import { normalizeFooterLayout, DEFAULT_FOOTER_LAYOUT } from './footerItems';
import { normalizeTopBarLayout, DEFAULT_TOPBAR_LAYOUT } from './topBarItems';
import { normalizeLyricsSyncOffsetSeconds } from './lyricsSyncOffset'; // 实现
import { playerStorage } from '../../services/storage/playerStorage';

/**
 * 设置域合并的核心约定：patch 中值为 undefined 视为「不覆盖」，其余值需通过
 * 各自的合法性校验后才会写入结果。以下辅助原语统一表达这些语义。
 */
type OptionalFields<T> = { [K in keyof T]?: T[K] };

const withFallback = <V>(candidate: V | null | undefined, fallback: V): V => candidate ?? fallback;

const definedOr = <V>(candidate: V | undefined, fallback: V): V =>
  (candidate !== undefined ? candidate : fallback);

const chooseBoolean = (candidate: unknown, fallback: boolean): boolean =>
  (typeof candidate === 'boolean' ? candidate : fallback);

const pickString = (candidate: unknown, fallback: string): string =>
  (typeof candidate === 'string' ? candidate : fallback);

const pickOption = <T extends string>(candidate: unknown, fallback: T, allowed: readonly T[]): T =>
  (allowed.includes(candidate as T) ? (candidate as T) : fallback);

const roundPositive = (candidate: number | undefined, fallback: number): number => {
  if (candidate === undefined || !Number.isFinite(candidate) || candidate <= 0) {
    return fallback;
  }
  return Math.round(candidate);
};

const clampFadeDuration = (candidate: number | undefined, fallback: number): number => {
  if (candidate === undefined || !Number.isFinite(candidate) || candidate <= 0) {
    return fallback;
  }
  return Math.min(2000, Math.max(100, Math.round(candidate)));
};

const resolveMvQuality = (
  candidate: MvQualityKey | undefined,
  fallback: MvQualityKey | undefined,
): MvQualityKey => (MV_QUALITY_KEYS.includes(candidate as MvQualityKey) ? (candidate as MvQualityKey) : fallback ?? '720P');

const createUserPresetId = (): string => {
  const canUseUuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto;
  const uniqueToken = canUseUuid
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `user_${uniqueToken}`;
};

/* ---------------------------------------------------------------------- */
/* 各设置域的 Patch 类型                                                    */
/* ---------------------------------------------------------------------- */

export type DesktopThemeVisualsPatch = Partial<Pick<DesktopThemeVisuals, 'quickEntryShape'>> & {
  icons?: Record<string, string>;
  stickers?: Record<string, string>;
  surfaces?: Record<string, Partial<DesktopThemeSurface>>;
};

export type ThemeSettingsPatch = OptionalFields<Omit<ThemeSettings, 'customBackground' | 'desktopTheme' | 'perPageBackgrounds'>> & {
  customBackground?: OptionalFields<ThemeSettings['customBackground']>;
  desktopTheme?: DesktopThemeVisualsPatch;
  /** 主题包每页壁纸：整体替换语义（应用/换包时随包写入，重置时清空），不走逐字段合并 */
  perPageBackgrounds?: Record<string, PerPageBackground>;
};

export type SidebarSettingsPatch = OptionalFields<SidebarSettings>;
export type FooterLayoutSettingsPatch = OptionalFields<FooterLayoutSettings>;
export type TopBarLayoutSettingsPatch = OptionalFields<TopBarLayoutSettings>;

export type LyricsSettingsPatch = OptionalFields<LyricsSettings>;
export type DesktopLyricsSettingsPatch = OptionalFields<DesktopLyricsSettings>;

type LegacyVolumeBalanceSettingsPatch = OptionalFields<AudioSettings['volumeBalance']> & { targetLufs?: number };

type AudioBalancePatch = LegacyVolumeBalanceSettingsPatch | boolean;
export type AudioSettingsPatch = OptionalFields<Omit<AudioSettings, 'volumeBalance'>> & { volumeBalance?: AudioBalancePatch };

export type ImportedLyricsFontsPatch = Array<ImportedLyricsFont>;
export type DownloadSettingsPatch = OptionalFields<DownloadSettings>;
export type UploadSettingsPatch = OptionalFields<UploadSettings>;
export type PluginSettingsPatch = OptionalFields<PluginSettings>;
export type AutoSyncConfigPatch = OptionalFields<AutoSyncConfig>;
export type LogSettingsPatch = OptionalFields<LogSettings>;

export interface AppSettingsPatch // 实现
  extends OptionalFields<Omit<AppSettings, 'logging' | 'autoSync' | 'plugins' | 'upload' | 'download' | 'customLyricsFonts' | 'audio' | 'desktopLyrics' | 'lyrics' | 'shortcuts' | 'topBarLayout' | 'footerLayout' | 'sidebar' | 'theme'>> {
  theme?: ThemeSettingsPatch; sidebar?: SidebarSettingsPatch;
  footerLayout?: FooterLayoutSettingsPatch; topBarLayout?: TopBarLayoutSettingsPatch;
  shortcuts?: ShortcutSettingsPatch; // 实现
  lyrics?: LyricsSettingsPatch; desktopLyrics?: DesktopLyricsSettingsPatch;
  audio?: AudioSettingsPatch; customLyricsFonts?: ImportedLyricsFontsPatch;
  download?: DownloadSettingsPatch; upload?: UploadSettingsPatch;
  plugins?: PluginSettingsPatch; autoSync?: AutoSyncConfigPatch; logging?: LogSettingsPatch;
}

export type DeprecatedAppSettingsPatch = AppSettingsPatch & {
  /** 旧版「关闭即最小化到托盘」开关，仅存在于历史持久化数据中，合并时直接忽略。 */
  minimizeToTray?: boolean; // 实现
};

/* ---------------------------------------------------------------------- */
/* 归一化函数                                                               */
/* ---------------------------------------------------------------------- */

const FOREGROUND_STYLE_BY_VALUE: Record<string, ThemeSettings['customBackground']['foregroundStyle']> = {
  dark: 'dark',
};

export function normalizeForegroundStyle(
  foregroundStyle: string | null | undefined, // 实现
): ThemeSettings['customBackground']['foregroundStyle'] {
  return FOREGROUND_STYLE_BY_VALUE[foregroundStyle ?? ''] ?? 'light';
}

export function normalizeLibraryMinDurationSeconds(value: number | null | undefined): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return numeric > 0 ? Math.round(numeric) : 0;
}

/* ---------------------------------------------------------------------- */
/* 各设置域默认值                                                           */
/* ---------------------------------------------------------------------- */

const defaultDesktopTheme: DesktopThemeVisuals = {
  quickEntryShape: 'circle',
  icons: {},
  stickers: {},
  surfaces: {},
};

export const defaultThemeSettings: ThemeSettings = { // 实现
  mode: 'system', accentColor: DEFAULT_THEME_COLOR,
  desktopTheme: defaultDesktopTheme,
  playerDetailCoverBehavior: 'remember', lastPlayerDetailCoverVisible: true,
  playerDetailStyle: 'classic', playerDetailMeshBackground: true, playerDetailMeshAntiAlias: true,
  playerDetailMeshSpeed: 1, playerDetailVinylMaterial: 'light', playerDetailVinylPlatterStyle: 'metal',
  dynamicBgType: 'none', windowMaterial: 'none', keepWindowMaterialOnBlur: true,
  useCustomTrayMenu: true, useGlassSwitch: false, showLeaderboard: true,
  flowColorBoost: 25, flowDepth: 30, flowSpeed: 52, flowTexture: 34, windowBlurTint: 50,
  customBgPath: '', opacity: 0.8, blur: 20,
  customBackground: { // 实现
    imagePath: '', mediaType: 'image', blur: 20, opacity: 1,
    maskColor: '#000000', maskAlpha: 0.4, scale: 1, foregroundStyle: 'light',
    translateX: 0, translateY: 0,
  },
  perPageBackgrounds: {},
};

export const defaultSidebarSettings: SidebarSettings = { // 实现
  showLocalMusic: true, showArtists: true, showAlbums: true, showFavorites: true,
  showRecent: true, showFolders: true, showStatistics: true, showPlugins: true,
  showAccount: true,
  order: DEFAULT_SIDEBAR_ORDER.slice(),
};

export const defaultFooterLayoutSettings: FooterLayoutSettings = {
  left: DEFAULT_FOOTER_LAYOUT.left.slice(),
  middleLeft: DEFAULT_FOOTER_LAYOUT.middleLeft,
  middleRight: DEFAULT_FOOTER_LAYOUT.middleRight,
  right: DEFAULT_FOOTER_LAYOUT.right.slice(),
  hidden: DEFAULT_FOOTER_LAYOUT.hidden.slice(),
};

export const defaultTopBarLayoutSettings: TopBarLayoutSettings = {
  left: DEFAULT_TOPBAR_LAYOUT.left.slice(),
  right: DEFAULT_TOPBAR_LAYOUT.right.slice(),
  hidden: DEFAULT_TOPBAR_LAYOUT.hidden.slice(),
};

export const defaultAudioSettings: AudioSettings = { // 实现
  outputMode: 'shared', outputBitPerfect: false, dsdNativePassthrough: false,
  volumeBalance: { // 实现
    enabled: false, gainOffsetDb: 0, preventClipping: true,
  },
  equalizer: { // 实现
    enabled: false, preamp: 0.0, gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  showEqualizerInFooter: true, onlineDefaultQuality: 'flac',
  onlineFailureBehavior: 'stop', onlineQualityFallbackBehavior: 'lower',
  streamCacheSizeMB: 512, streamCacheDir: '',
  fadeInOutEnabled: true, fadeInOutDurationMs: 500, mvDefaultQuality: '720P',
};

export const defaultDownloadSettings: DownloadSettings = { // 实现
  downloadPath: '', behavior: 'default', batchDownloadLimit: 2,
  format: 'mp3', quality: 'flac', downloadLyrics: false,
  lyricsFormat: 'lrc', lyricsStyle: 'word-by-word',
  overwriteExisting: false, keepSourceFilename: false,
  fileNameStyle: 'title-artist', rememberDownloadPath: false,
  qualityFallbackBehavior: 'lower',
  embedMetadata: true, embedLyrics: true, embedCover: true,
  mvDefaultQuality: '720P',
};

export const defaultUploadSettings: UploadSettings = { // 实现
  playlists: true, history: true, favorites: true, plugins: true, settings: true,
};

export const defaultPluginSettings: PluginSettings = {
  autoUpdateOnStartup: false, lazyLoad: true, skipVersionCheck: false,
};

export const defaultAutoSyncConfig: AutoSyncConfig = { // 自动同步默认配置
  enabled: true, syncIntervalSeconds: 3600, maxDelayMinutes: 5,
  delayedCount: 0, lastSyncAttemptAt: 0, lastSyncSuccessAt: 0, nextSyncAt: 0,
}; // 默认值结束
export const defaultLogSettings: LogSettings = { // 实现
  minimumLevel: 'info', retentionDays: 1, autoAnalyze: true,
};

export const defaultAppSettings: AppSettings = { // 实现
  language: 'system', closeToTray: true, launchOnStartup: false,
  launchOnStartupMinimized: false, preventSleepWhilePlaying: true,
  audioFileAssociations: [...AUDIO_FILE_ASSOCIATION_EXTENSIONS],
  showDesktopLyrics: false, showQualityBadges: true, showSongComments: true,
  enableScrollToTopButton: true, libraryMinDurationSeconds: 0,
  linkFoldersToLibrary: false, lyricsSyncOffset: 0,
  organizeRoot: 'D:\\Music', enableAutoOrganize: true, organizeRule: '{Artist}/{Album}/{Title}',
  audio: defaultAudioSettings, customLyricsFonts: [],
  lyrics: createDefaultLyricsSettings(), desktopLyrics: createDefaultDesktopLyricsSettings(),
  theme: defaultThemeSettings, sidebar: defaultSidebarSettings,
  footerLayout: defaultFooterLayoutSettings, topBarLayout: defaultTopBarLayoutSettings,
  shortcuts: createDefaultShortcutSettings(), // 实现
  showTaskbarPlayer: false, taskbarPlayerCanDrag: false,
  gpuAcceleration: true, performanceMode: 'auto',
  checkUpdateOnStartup: true, showWelcomeToastOnStartup: true, writeArtistAvatarToTags: false,
  dlnaRendererEnabled: false, dlnaRendererName: '',
  download: defaultDownloadSettings, upload: defaultUploadSettings,
  plugins: defaultPluginSettings, autoSync: defaultAutoSyncConfig, logging: defaultLogSettings,
  songClickAction: 'double', shareLinkValidityMinutes: 120,
  sharePlaybackFailureBehavior: 'pause',
};

/* ---------------------------------------------------------------------- */
/* 默认值工厂（生成全新副本，避免共享可变嵌套结构）                           */
/* ---------------------------------------------------------------------- */

export function createDefaultThemeSettings(): ThemeSettings {
  const snapshot = { ...defaultThemeSettings };
  snapshot.customBackground = { ...snapshot.customBackground };
  snapshot.perPageBackgrounds = {};
  snapshot.desktopTheme = {
    ...defaultDesktopTheme,
    icons: { ...defaultDesktopTheme.icons },
    stickers: { ...defaultDesktopTheme.stickers },
    surfaces: { ...defaultDesktopTheme.surfaces },
  };
  return snapshot;
}

export function createDefaultSidebarSettings(): SidebarSettings {
  return { ...defaultSidebarSettings, order: defaultSidebarSettings.order.slice() };
}

export function createDefaultFooterLayoutSettings(): FooterLayoutSettings {
  return {
    ...defaultFooterLayoutSettings,
    left: defaultFooterLayoutSettings.left.slice(),
    right: defaultFooterLayoutSettings.right.slice(),
    hidden: defaultFooterLayoutSettings.hidden.slice(),
  };
}

export function createDefaultTopBarLayoutSettings(): TopBarLayoutSettings {
  return {
    ...defaultTopBarLayoutSettings,
    left: defaultTopBarLayoutSettings.left.slice(),
    right: defaultTopBarLayoutSettings.right.slice(),
    hidden: defaultTopBarLayoutSettings.hidden.slice(),
  };
}

export function createDefaultAudioSettings(): AudioSettings {
  const snapshot = { ...defaultAudioSettings };
  snapshot.volumeBalance = { ...defaultAudioSettings.volumeBalance };
  snapshot.equalizer = {
    ...defaultAudioSettings.equalizer, // 实现
    gains: defaultAudioSettings.equalizer.gains.slice(),
  };
  return snapshot;
}

export function createDefaultDownloadSettings(): DownloadSettings {
  return { ...defaultDownloadSettings };
}

export function createDefaultUploadSettings(): UploadSettings {
  return { ...defaultUploadSettings };
}

export function createDefaultAutoSyncConfig(): AutoSyncConfig {
  return { ...defaultAutoSyncConfig };
}
export function createDefaultLogSettings(): LogSettings {
  return { ...defaultLogSettings };
}

export function createDefaultAppSettings(): AppSettings {
  const snapshot = { ...defaultAppSettings };
  snapshot.customLyricsFonts = [];
  snapshot.audioFileAssociations = [...AUDIO_FILE_ASSOCIATION_EXTENSIONS];
  snapshot.lyrics = createDefaultLyricsSettings();
  snapshot.desktopLyrics = createDefaultDesktopLyricsSettings();
  snapshot.audio = createDefaultAudioSettings();
  snapshot.theme = createDefaultThemeSettings();
  snapshot.sidebar = createDefaultSidebarSettings();
  snapshot.footerLayout = createDefaultFooterLayoutSettings();
  snapshot.shortcuts = createDefaultShortcutSettings();
  snapshot.download = createDefaultDownloadSettings();
  snapshot.upload = createDefaultUploadSettings();
  snapshot.autoSync = createDefaultAutoSyncConfig();
  snapshot.logging = createDefaultLogSettings();
  return snapshot;
}

/* ---------------------------------------------------------------------- */
/* 上传设置合并                                                             */
/* ---------------------------------------------------------------------- */

export const mergeUploadSettings = (base: UploadSettings, patch: UploadSettingsPatch): UploadSettings => ({
  playlists: chooseBoolean(patch.playlists, base.playlists),
  history: chooseBoolean(patch.history, base.history),
  favorites: chooseBoolean(patch.favorites, base.favorites),
  plugins: chooseBoolean(patch.plugins, base.plugins),
  settings: chooseBoolean(patch.settings, base.settings),
});

/* ---------------------------------------------------------------------- */
/* 下载设置合并（枚举字段统一走选项表校验）                                   */
/* ---------------------------------------------------------------------- */

type DownloadEnumField = 'format' | 'behavior' | 'quality' | 'lyricsFormat' | 'lyricsStyle' | 'fileNameStyle';

const DOWNLOAD_ENUM_OPTIONS: Record<DownloadEnumField, readonly string[]> = {
  format: ['aac', 'wav', 'mp3', 'flac'],
  behavior: ['ask', 'default'],
  quality: ALL_QUALITY_KEYS,
  lyricsFormat: ['txt', 'lrc'],
  lyricsStyle: ['line-by-line', 'word-by-word'],
  fileNameStyle: ['title-artist-album', 'artist-title', 'title-artist'],
};

const QUALITY_FALLBACK_DIRECTIONS: readonly DownloadSettings['qualityFallbackBehavior'][] = ['higher', 'lower'];

const resolveDownloadEnumField = <K extends DownloadEnumField>(
  field: K,
  base: DownloadSettings,
  patch: DownloadSettingsPatch,
): DownloadSettings[K] => {
  const candidate: unknown = patch[field];
  const allowed = DOWNLOAD_ENUM_OPTIONS[field];
  if (typeof candidate !== 'string' || !allowed.includes(candidate)) {
    return base[field];
  }
  return candidate as DownloadSettings[K];
};

const clampBatchLimit = (candidate: number | undefined, fallback: number): number => {
  const parsed = Number(candidate);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(5, Math.round(parsed)));
};

export const mergeDownloadSettings = (base: DownloadSettings, patch: DownloadSettingsPatch): DownloadSettings => ({
  downloadPath: pickString(patch.downloadPath, base.downloadPath),
  behavior: resolveDownloadEnumField('behavior', base, patch),
  batchDownloadLimit: clampBatchLimit(patch.batchDownloadLimit, base.batchDownloadLimit ?? 2),
  format: resolveDownloadEnumField('format', base, patch),
  quality: resolveDownloadEnumField('quality', base, patch),
  downloadLyrics: chooseBoolean(patch.downloadLyrics, base.downloadLyrics),
  lyricsFormat: resolveDownloadEnumField('lyricsFormat', base, patch),
  lyricsStyle: resolveDownloadEnumField('lyricsStyle', base, patch),
  overwriteExisting: chooseBoolean(patch.overwriteExisting, base.overwriteExisting),
  keepSourceFilename: chooseBoolean(patch.keepSourceFilename, base.keepSourceFilename),
  fileNameStyle: resolveDownloadEnumField('fileNameStyle', base, patch),
  rememberDownloadPath: chooseBoolean(patch.rememberDownloadPath, base.rememberDownloadPath),
  qualityFallbackBehavior: pickOption(patch.qualityFallbackBehavior, base.qualityFallbackBehavior, QUALITY_FALLBACK_DIRECTIONS),
  embedMetadata: chooseBoolean(patch.embedMetadata, base.embedMetadata),
  embedLyrics: chooseBoolean(patch.embedLyrics, base.embedLyrics),
  embedCover: chooseBoolean(patch.embedCover, base.embedCover),
  mvDefaultQuality: resolveMvQuality(patch.mvDefaultQuality, base.mvDefaultQuality),
});

/* ---------------------------------------------------------------------- */
/* 主题设置合并                                                             */
/* ---------------------------------------------------------------------- */

const COVER_BEHAVIOR_OPTIONS: readonly ThemeSettings['playerDetailCoverBehavior'][] = ['remember', 'hide', 'show'];
const DETAIL_STYLE_OPTIONS: readonly ThemeSettings['playerDetailStyle'][] = ['vinyl', 'classic'];
const VINYL_MATERIAL_OPTIONS: readonly ThemeSettings['playerDetailVinylMaterial'][] = ['marble', 'oak', 'matte', 'light'];
const VINYL_PLATTER_STYLE_OPTIONS: readonly ThemeSettings['playerDetailVinylPlatterStyle'][] = ['metal', 'vinyl'];

const legacyCoverFlagToMode = (flag: unknown): 'show' | 'hide' | undefined => {
  if (typeof flag !== 'boolean') {
    return undefined;
  }
  return flag ? 'show' : 'hide';
};

const isThemeAssetReference = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length <= 512
  && !value.includes('\\')
  && (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/') || value.startsWith('data:image/'))
);

/** 每页壁纸 pageId 形态：字母开头，允许数字/下划线/中划线（对齐主题包契约） */
const PER_PAGE_BG_KEY_RE = /^[a-z][a-z0-9_-]{0,30}$/i;

const clampRatio = (candidate: unknown, fallback: number): number => {
  const num = Number(candidate);
  return Number.isFinite(num) ? Math.max(0, Math.min(1, num)) : fallback;
};

/** 每页壁纸归一化：入口为包解析与持久化回读，非法页/非法值直接丢弃或回落默认 */
export const normalizePerPageBackgrounds = (
  candidate: Record<string, PerPageBackground> | undefined,
): Record<string, PerPageBackground> => {
  const output: Record<string, PerPageBackground> = {};
  if (!candidate) return output;
  for (const [key, value] of Object.entries(candidate)) {
    if (!PER_PAGE_BG_KEY_RE.test(key) || !value || typeof value !== 'object') continue;
    const imagePath = typeof value.imagePath === 'string' ? value.imagePath : '';
    if (!imagePath || imagePath.length > 1024) continue;
    const blur = Number(value.blur);
    const scale = Number(value.scale);
    const translateX = Number(value.translateX);
    const translateY = Number(value.translateY);
    output[key] = {
      imagePath,
      blur: Number.isFinite(blur) ? Math.max(0, Math.min(100, Math.round(blur))) : 20,
      opacity: clampRatio(value.opacity, 1),
      maskColor: /^#[0-9a-f]{6}$/i.test(String(value.maskColor ?? '')) ? String(value.maskColor).toUpperCase() : '#000000',
      maskAlpha: clampRatio(value.maskAlpha, 0.4),
      scale: Number.isFinite(scale) && scale > 0 ? Math.max(0.8, Math.min(2.4, scale)) : 1,
      translateX: Number.isFinite(translateX) ? Math.max(-1, Math.min(1, translateX)) : 0,
      translateY: Number.isFinite(translateY) ? Math.max(-1, Math.min(1, translateY)) : 0,
      foregroundStyle: value.foregroundStyle === 'dark' ? 'dark' : 'light',
    };
  }
  return output;
};

const mergeDesktopTheme = (
  base: DesktopThemeVisuals,
  patch: ThemeSettingsPatch['desktopTheme'] | undefined,
): DesktopThemeVisuals => {
  const mergeAssets = (current: Record<string, string>, incoming: Record<string, string> | undefined) => {
    const next = { ...current };
    if (!incoming) return next;
    for (const [key, value] of Object.entries(incoming)) {
      if (/^[a-z][a-z0-9_.-]{0,80}$/i.test(key) && isThemeAssetReference(value)) next[key] = value;
    }
    return next;
  };
  const surfaces = { ...base.surfaces };
  for (const [key, value] of Object.entries(patch?.surfaces ?? {})) {
    if (!/^[a-z][a-z0-9_.-]{0,80}$/i.test(key)) continue;
    if (!value || typeof value.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.color)) continue;
    const opacity = Number(value.opacity);
    if (Number.isFinite(opacity)) surfaces[key] = { color: value.color.toUpperCase(), opacity: Math.max(0, Math.min(1, opacity)) };
  }

  return {
    quickEntryShape: pickOption(patch?.quickEntryShape, base.quickEntryShape, ['circle', 'rounded', 'square'] as const),
    icons: mergeAssets(base.icons, patch?.icons),
    stickers: mergeAssets(base.stickers, patch?.stickers),
    surfaces,
  };
};

export const mergeThemeSettings = (base: ThemeSettings, patch: ThemeSettingsPatch): ThemeSettings => {
  const { showPlayerDetailCoverByDefault: legacyCoverVisible, ...usablePatch } = patch as ThemeSettingsPatch & {
    showPlayerDetailCoverByDefault?: unknown; // 实现
  };
  const mergedBackground = { ...base.customBackground, ...(patch.customBackground ?? {}) };
  const coverBehavior = pickOption(
    patch.playerDetailCoverBehavior,
    legacyCoverFlagToMode(legacyCoverVisible) ?? base.playerDetailCoverBehavior,
    COVER_BEHAVIOR_OPTIONS,
  );

  return {
    ...base,
    ...usablePatch,
    desktopTheme: mergeDesktopTheme(base.desktopTheme, usablePatch.desktopTheme),
    accentColor: normalizeThemeColor(usablePatch.accentColor, base.accentColor),
    playerDetailCoverBehavior: coverBehavior,
    playerDetailStyle: pickOption(patch.playerDetailStyle, base.playerDetailStyle, DETAIL_STYLE_OPTIONS),
    playerDetailMeshBackground: chooseBoolean(patch.playerDetailMeshBackground, base.playerDetailMeshBackground),
    playerDetailMeshAntiAlias: chooseBoolean(patch.playerDetailMeshAntiAlias, base.playerDetailMeshAntiAlias),
    playerDetailVinylMaterial: pickOption(patch.playerDetailVinylMaterial, base.playerDetailVinylMaterial, VINYL_MATERIAL_OPTIONS),
    playerDetailVinylPlatterStyle: pickOption(patch.playerDetailVinylPlatterStyle, base.playerDetailVinylPlatterStyle, VINYL_PLATTER_STYLE_OPTIONS),
    lastPlayerDetailCoverVisible: chooseBoolean(patch.lastPlayerDetailCoverVisible, base.lastPlayerDetailCoverVisible),
    perPageBackgrounds: patch.perPageBackgrounds !== undefined
      ? normalizePerPageBackgrounds(patch.perPageBackgrounds)
      : base.perPageBackgrounds,
    customBackground: { // 实现
      ...mergedBackground,
      foregroundStyle: normalizeForegroundStyle(mergedBackground.foregroundStyle),
    },
  };
};

/* ---------------------------------------------------------------------- */
/* 侧栏 / 布局设置合并                                                      */
/* ---------------------------------------------------------------------- */

export const mergeSidebarSettings = (base: SidebarSettings, patch: SidebarSettingsPatch): SidebarSettings => {
  const orderSource = patch.order === undefined || patch.order === null ? base.order : patch.order;
  return { ...base, ...patch, order: normalizeSidebarOrder(orderSource) };
};

export const mergeFooterLayoutSettings = (base: FooterLayoutSettings, patch: FooterLayoutSettingsPatch): FooterLayoutSettings => {
  const combined: FooterLayoutSettings = {
    ...base,
    left: withFallback(patch.left, base.left),
    middleLeft: definedOr(patch.middleLeft, base.middleLeft),
    middleRight: definedOr(patch.middleRight, base.middleRight),
    right: withFallback(patch.right, base.right),
    hidden: withFallback(patch.hidden, base.hidden),
    collapsed: withFallback(patch.collapsed, base.collapsed),
  };
  return normalizeFooterLayout(combined);
};

export const mergeTopBarLayoutSettings = (base: TopBarLayoutSettings, patch: TopBarLayoutSettingsPatch): TopBarLayoutSettings => normalizeTopBarLayout({
  ...base,
  left: withFallback(patch.left, base.left),
  right: withFallback(patch.right, base.right),
  hidden: withFallback(patch.hidden, base.hidden),
});

/* ---------------------------------------------------------------------- */
/* 音频设置合并                                                             */
/* ---------------------------------------------------------------------- */

const OUTPUT_MODE_OPTIONS: readonly AudioSettings['outputMode'][] = ['wasapiExclusive', 'shared'];
const ONLINE_FAILURE_OPTIONS: readonly AudioSettings['onlineFailureBehavior'][] = ['stop', 'autoswitch', 'skip'];
const ONLINE_QUALITY_FALLBACK_OPTIONS: readonly AudioSettings['onlineQualityFallbackBehavior'][] = ['higher', 'pause', 'lower'];

const LEGACY_TARGET_LUFS_DB = -18;
const NEUTRAL_EQ_GAINS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

const resolveVolumeBalance = (
  current: AudioSettings['volumeBalance'] | undefined,
  incoming: AudioSettingsPatch['volumeBalance'],
): AudioSettings['volumeBalance'] => {
  const state = {
    enabled: current?.enabled ?? false,
    gainOffsetDb: current?.gainOffsetDb ?? 0,
    preventClipping: current?.preventClipping ?? true,
  };
  if (typeof incoming === 'boolean') {
    return { ...state, enabled: incoming };
  }
  if (!incoming || typeof incoming !== 'object') {
    return state;
  }
  const legacyOffset = incoming.targetLufs !== undefined
    ? incoming.targetLufs - LEGACY_TARGET_LUFS_DB
    : state.gainOffsetDb;
  return {
    enabled: incoming.enabled ?? state.enabled,
    gainOffsetDb: incoming.gainOffsetDb ?? legacyOffset,
    preventClipping: incoming.preventClipping ?? state.preventClipping,
  };
};

const resolveEqualizer = (
  current: AudioSettings['equalizer'] | undefined,
  incoming: AudioSettingsPatch['equalizer'],
): AudioSettings['equalizer'] => {
  const state: AudioSettings['equalizer'] = {
    enabled: current?.enabled ?? false,
    preamp: current?.preamp ?? 0.0,
    gains: current?.gains ?? [...NEUTRAL_EQ_GAINS],
    currentPresetId: current?.currentPresetId ?? null,
  };
  if (!incoming || typeof incoming !== 'object') {
    return state;
  }
  if (incoming.gains) {
    state.gains = [...incoming.gains];
  }
  if ('currentPresetId' in incoming) {
    state.currentPresetId = incoming.currentPresetId ?? null;
  }
  return {
    enabled: incoming.enabled ?? state.enabled,
    preamp: incoming.preamp ?? state.preamp,
    gains: state.gains,
    currentPresetId: state.currentPresetId,
  };
};

const resolveOnlineFailureBehavior = (
  current: AudioSettings,
  incoming: AudioSettingsPatch['onlineFailureBehavior'],
): AudioSettings['onlineFailureBehavior'] => {
  if (ONLINE_FAILURE_OPTIONS.includes(incoming as AudioSettings['onlineFailureBehavior'])) {
    return incoming as AudioSettings['onlineFailureBehavior'];
  }
  const legacyAutoSwitch = (current as unknown as Record<string, unknown>).autoSwitchSourceOnFailure;
  return legacyAutoSwitch === true ? 'autoswitch' : current.onlineFailureBehavior ?? 'skip';
};

export const mergeAudioSettings = (base: AudioSettings, patch: AudioSettingsPatch): AudioSettings => {
  const balance = resolveVolumeBalance(base.volumeBalance, patch.volumeBalance);
  const equalizer = resolveEqualizer(base.equalizer, patch.equalizer);

  return {
    ...base,
    outputMode: pickOption(patch.outputMode, base.outputMode ?? 'shared', OUTPUT_MODE_OPTIONS),
    outputBitPerfect: chooseBoolean(patch.outputBitPerfect, base.outputBitPerfect ?? false),
    dsdNativePassthrough: chooseBoolean(patch.dsdNativePassthrough, base.dsdNativePassthrough ?? true),
    volumeBalance: balance,
    equalizer,
    showEqualizerInFooter: withFallback(patch.showEqualizerInFooter, base.showEqualizerInFooter ?? true),
    onlineDefaultQuality: pickOption(patch.onlineDefaultQuality, base.onlineDefaultQuality ?? '320k', ALL_QUALITY_KEYS),
    onlineFailureBehavior: resolveOnlineFailureBehavior(base, patch.onlineFailureBehavior),
    onlineQualityFallbackBehavior: pickOption(
      patch.onlineQualityFallbackBehavior,
      base.onlineQualityFallbackBehavior ?? 'lower',
      ONLINE_QUALITY_FALLBACK_OPTIONS,
    ),
    streamCacheSizeMB: roundPositive(patch.streamCacheSizeMB, base.streamCacheSizeMB ?? 512),
    streamCacheDir: pickString(patch.streamCacheDir, base.streamCacheDir ?? ''),
    fadeInOutEnabled: chooseBoolean(patch.fadeInOutEnabled, base.fadeInOutEnabled ?? false),
    fadeInOutDurationMs: clampFadeDuration(patch.fadeInOutDurationMs, base.fadeInOutDurationMs ?? 1000),
    mvDefaultQuality: resolveMvQuality(patch.mvDefaultQuality, base.mvDefaultQuality),
  };
};

/* ---------------------------------------------------------------------- */
/* 插件 / 自动同步 / 日志设置合并                                            */
/* ---------------------------------------------------------------------- */

const mergePluginSettings = (base: PluginSettings, patch: PluginSettingsPatch): PluginSettings => ({
  autoUpdateOnStartup: chooseBoolean(patch.autoUpdateOnStartup, base.autoUpdateOnStartup),
  lazyLoad: chooseBoolean(patch.lazyLoad, base.lazyLoad),
  skipVersionCheck: chooseBoolean(patch.skipVersionCheck, base.skipVersionCheck),
});

const mergeAutoSyncConfig = (base: AutoSyncConfig, patch: AutoSyncConfigPatch): AutoSyncConfig => {
  const nonNegativeOr = (candidate: number | undefined, fallback: number): number =>
    (typeof candidate === 'number' && candidate >= 0 ? candidate : fallback);
  const numberOr = (candidate: number | undefined, fallback: number): number =>
    (typeof candidate === 'number' ? candidate : fallback);
  return {
    enabled: chooseBoolean(patch.enabled, base.enabled),
    syncIntervalSeconds: nonNegativeOr(patch.syncIntervalSeconds, base.syncIntervalSeconds),
    maxDelayMinutes: nonNegativeOr(patch.maxDelayMinutes, base.maxDelayMinutes),
    delayedCount: numberOr(patch.delayedCount, base.delayedCount),
    lastSyncAttemptAt: numberOr(patch.lastSyncAttemptAt, base.lastSyncAttemptAt),
    lastSyncSuccessAt: numberOr(patch.lastSyncSuccessAt, base.lastSyncSuccessAt),
    nextSyncAt: numberOr(patch.nextSyncAt, base.nextSyncAt),
  };
};

const LOG_LEVEL_OPTIONS: readonly LogSettings['minimumLevel'][] = ['error', 'warn', 'info', 'debug'];

export const mergeLogSettings = (base: LogSettings, patch: LogSettingsPatch): LogSettings => ({
  minimumLevel: pickOption(patch.minimumLevel, base.minimumLevel, LOG_LEVEL_OPTIONS),
  retentionDays: 1, autoAnalyze: chooseBoolean(patch.autoAnalyze, base.autoAnalyze),
});

/* ---------------------------------------------------------------------- */
/* 应用级设置合并                                                           */
/* ---------------------------------------------------------------------- */

const APP_LANGUAGE_OPTIONS: readonly AppSettings['language'][] = ['en-US', 'zh-TW', 'zh-CN', 'system'];

/**
 * 子域合并的统一入口：patch 中该子域缺省时直接沿用 base（base 亦缺省时才落到
 * 默认值工厂），存在时先补齐 base 缺口再执行域内合并。
 */
const mergeSectionField = <S, P>(
  baseSection: S | undefined,
  patchSection: P | undefined,
  makeDefaults: () => S,
  mergeFn: (current: S, incoming: P) => S,
): S => (patchSection
  ? mergeFn(baseSection ?? makeDefaults(), patchSection)
  : baseSection ?? makeDefaults());

export const mergeAppSettings = (base: AppSettings, patch: DeprecatedAppSettingsPatch): AppSettings => {
  const patchRest: DeprecatedAppSettingsPatch = { ...patch };
  const languagePatch = patchRest.language;
  const preventSleepPatch = patchRest.preventSleepWhilePlaying;
  const showWelcomeToastPatch = patchRest.showWelcomeToastOnStartup;
  const libraryMinPatch = patchRest.libraryMinDurationSeconds;
  const lyricsPatch = patchRest.lyrics;
  const desktopLyricsPatch = patchRest.desktopLyrics;
  const fontsPatch = patchRest.customLyricsFonts;
  const themePatch = patchRest.theme;
  const sidebarPatch = patchRest.sidebar;
  const shortcutsPatch = patchRest.shortcuts;
  delete patchRest.minimizeToTray;
  delete patchRest.language;
  delete patchRest.preventSleepWhilePlaying;
  delete patchRest.showWelcomeToastOnStartup;
  delete patchRest.libraryMinDurationSeconds;

  return {
    ...base,
    ...patchRest,
    language: pickOption(languagePatch, base.language, APP_LANGUAGE_OPTIONS),
    preventSleepWhilePlaying: chooseBoolean(preventSleepPatch, base.preventSleepWhilePlaying),
    showWelcomeToastOnStartup: chooseBoolean(showWelcomeToastPatch, base.showWelcomeToastOnStartup),
    lyricsSyncOffset: normalizeLyricsSyncOffsetSeconds( // 实现
      withFallback(patch.lyricsSyncOffset, base.lyricsSyncOffset),
    ),
    libraryMinDurationSeconds: normalizeLibraryMinDurationSeconds( // 实现
      withFallback(libraryMinPatch, base.libraryMinDurationSeconds),
    ),
    lyrics: lyricsPatch ? mergeLyricsSettings(base.lyrics, lyricsPatch) : base.lyrics,
    desktopLyrics: desktopLyricsPatch
      ? mergeDesktopLyricsSettings(base.desktopLyrics, desktopLyricsPatch)
      : base.desktopLyrics,
    audio: mergeSectionField(base.audio, patch.audio, createDefaultAudioSettings, mergeAudioSettings),
    customLyricsFonts: fontsPatch ? normalizeImportedLyricsFonts(fontsPatch) : base.customLyricsFonts,
    theme: themePatch ? mergeThemeSettings(base.theme, themePatch) : base.theme,
    sidebar: sidebarPatch ? mergeSidebarSettings(base.sidebar, sidebarPatch) : base.sidebar,
    footerLayout: mergeSectionField(base.footerLayout, patch.footerLayout, createDefaultFooterLayoutSettings, mergeFooterLayoutSettings),
    topBarLayout: mergeSectionField(base.topBarLayout, patch.topBarLayout, createDefaultTopBarLayoutSettings, mergeTopBarLayoutSettings),
    shortcuts: shortcutsPatch ? mergeShortcutSettings(base.shortcuts, shortcutsPatch) : base.shortcuts,
    download: mergeSectionField(base.download, patch.download, createDefaultDownloadSettings, mergeDownloadSettings),
    upload: mergeSectionField(base.upload, patch.upload, createDefaultUploadSettings, mergeUploadSettings),
    plugins: mergeSectionField(base.plugins, patch.plugins, () => defaultPluginSettings, mergePluginSettings),
    autoSync: mergeSectionField(base.autoSync, patch.autoSync, createDefaultAutoSyncConfig, mergeAutoSyncConfig),
    logging: mergeSectionField(base.logging, patch.logging, createDefaultLogSettings, mergeLogSettings),
  };
};

/* ---------------------------------------------------------------------- */
/* Settings Store                                                           */
/* ---------------------------------------------------------------------- */

export const useSettingsStore = defineStore(
  'settings',
  () => {
    const settingsState = ref<AppSettings>(createDefaultAppSettings());
    const setThemeState = (next: ThemeSettings) => {
      settingsState.value = { ...settingsState.value, theme: next };
    };
    const setSidebarState = (next: SidebarSettings) => {
      settingsState.value = { ...settingsState.value, sidebar: next };
    };
    const setFooterLayoutState = (next: FooterLayoutSettings) => {
      settingsState.value = { ...settingsState.value, footerLayout: next };
    };
    const setTopBarLayoutState = (next: TopBarLayoutSettings) => {
      settingsState.value = { ...settingsState.value, topBarLayout: next };
    };

    const audioDelay = computed(() => settingsState.value.lyricsSyncOffset);

    const theme = computed<ThemeSettings>({
      get: () => settingsState.value.theme,
      set: incoming => setThemeState(mergeThemeSettings(createDefaultThemeSettings(), incoming)),
    });
    const sidebar = computed<SidebarSettings>({
      get: () => settingsState.value.sidebar,
      set: incoming => setSidebarState(mergeSidebarSettings(createDefaultSidebarSettings(), incoming)),
    });
    const footerLayout = computed<FooterLayoutSettings>({
      get: () => settingsState.value.footerLayout,
      set: incoming => setFooterLayoutState(mergeFooterLayoutSettings(createDefaultFooterLayoutSettings(), incoming)),
    });
    const topBarLayout = computed<TopBarLayoutSettings>({
      get: () => settingsState.value.topBarLayout,
      set: incoming => setTopBarLayoutState(mergeTopBarLayoutSettings(createDefaultTopBarLayoutSettings(), incoming)),
    });

    const replaceSettings = (incoming: AppSettings) => {
      settingsState.value = mergeAppSettings(createDefaultAppSettings(), incoming);
    };

    const patchSettings = (partial: AppSettingsPatch) => {
      settingsState.value = mergeAppSettings(settingsState.value, partial);
    };

    function resetSettings() {
      settingsState.value = createDefaultAppSettings();
    }

    const replaceTheme = (incoming: ThemeSettings) => {
      theme.value = incoming;
    };

    const patchTheme = (partial: ThemeSettingsPatch) => {
      setThemeState(mergeThemeSettings(settingsState.value.theme, partial));
    };

    const replaceSidebar = (incoming: SidebarSettings) => {
      sidebar.value = incoming;
    };

    const patchSidebar = (partial: SidebarSettingsPatch) => {
      setSidebarState(mergeSidebarSettings(settingsState.value.sidebar, partial));
    };

    const patchFooterLayout = (partial: FooterLayoutSettingsPatch) => {
      setFooterLayoutState(mergeFooterLayoutSettings(settingsState.value.footerLayout, partial));
    };

    const patchTopBarLayout = (partial: TopBarLayoutSettingsPatch) => {
      setTopBarLayoutState(mergeTopBarLayoutSettings(settingsState.value.topBarLayout, partial));
    };

    // 均衡器预设独立存放于播放器存储，这里维护其与 audio.equalizer 的联动。
    const equalizerPresets = ref<EqualizerPreset[]>(playerStorage.readEqualizerPresets());
    const userPresets = computed(() => equalizerPresets.value.filter(preset => !preset.isBuiltin));

    const persistUserPresets = () => {
      playerStorage.writeEqualizerPresets(userPresets.value); // 实现
    };
    const snapshotEqualizer = () => settingsState.value.audio.equalizer;
    const applyEqualizerState = (next: AudioSettings['equalizer']) => {
      patchSettings({ audio: { equalizer: next } });
    };

    const saveEqualizerPreset = (name: string) => {
      const stamp = Date.now();
      const created: EqualizerPreset = {
        id: createUserPresetId(),
        name,
        preamp: snapshotEqualizer().preamp,
        gains: [...snapshotEqualizer().gains],
        isBuiltin: false,
        createdAt: stamp,
        updatedAt: stamp,
      };
      equalizerPresets.value.push(created);
      persistUserPresets();
      applyEqualizerState({ ...snapshotEqualizer(), currentPresetId: created.id });
      return created;
    };

    const updateEqualizerPreset = (presetId: string, name: string) => {
      const target = equalizerPresets.value.find(preset => preset.id === presetId);
      if (!target || target.isBuiltin) {
        return;
      }
      target.name = name;
      target.preamp = snapshotEqualizer().preamp;
      target.gains = [...snapshotEqualizer().gains];
      target.updatedAt = Date.now();
      persistUserPresets();
    };

    const deleteEqualizerPreset = (presetId: string) => {
      const targetIndex = equalizerPresets.value.findIndex(preset => preset.id === presetId);
      if (targetIndex === -1 || equalizerPresets.value[targetIndex].isBuiltin) {
        return;
      }
      equalizerPresets.value.splice(targetIndex, 1);
      persistUserPresets();
      if (snapshotEqualizer().currentPresetId === presetId) {
        applyEqualizerState({ ...snapshotEqualizer(), currentPresetId: null });
      }
    };

    const loadEqualizerPreset = (presetId: string) => {
      const preset = equalizerPresets.value.find(item => item.id === presetId);
      if (!preset) {
        return;
      }
      applyEqualizerState({
        enabled: true,
        preamp: preset.preamp,
        gains: [...preset.gains],
        currentPresetId: presetId,
      });
    };

    return {
      settings: settingsState,
      audioDelay,
      theme,
      sidebar,
      footerLayout,
      topBarLayout,
      equalizerPresets,
      userPresets,
      replaceSettings,
      patchSettings,
      resetSettings,
      replaceTheme,
      patchTheme,
      replaceSidebar,
      patchSidebar,
      patchFooterLayout,
      patchTopBarLayout,
      saveEqualizerPreset,
      updateEqualizerPreset,
      deleteEqualizerPreset,
      loadEqualizerPreset,
    };
  },
);
