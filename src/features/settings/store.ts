import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import type {
  AppSettings,
  AudioSettings,
  AutoSyncConfig,
  DesktopLyricsSettings,
  DownloadLyricsStyle,
  DownloadSettings,
  EqualizerPreset,
  FooterLayoutSettings,
  ImportedLyricsFont,
  LyricsSettings,
  LogSettings,
  PluginSettings,
  SidebarSettings,
  ThemeSettings,
  UploadSettings,
} from '../../types';
import { ALL_QUALITY_KEYS } from '../../types';
// 直接从 constants.ts 叶子模块导入，避免经由 index → state → settings/store 形成循环依赖
import {
  createDefaultDesktopLyricsSettings,
  createDefaultLyricsSettings,
  mergeDesktopLyricsSettings,
  mergeLyricsSettings,
  normalizeImportedLyricsFonts,
} from '../../composables/lyrics/constants';
import {
  createDefaultShortcutSettings,
  mergeShortcutSettings,
  type ShortcutSettingsPatch,
} from './shortcuts';
import { DEFAULT_SIDEBAR_ORDER, normalizeSidebarOrder } from './sidebarItems';
import { DEFAULT_FOOTER_LAYOUT, normalizeFooterLayout } from './footerItems';
import { playerStorage } from '../../services/storage/playerStorage';
import { normalizeLyricsSyncOffsetSeconds } from './lyricsSyncOffset';

const createUserPresetId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `user_${crypto.randomUUID()}`
    : `user_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export type ThemeSettingsPatch = Partial<Omit<ThemeSettings, 'customBackground'>> & {
  customBackground?: Partial<ThemeSettings['customBackground']>;
};

export type SidebarSettingsPatch = Partial<SidebarSettings>;
export type FooterLayoutSettingsPatch = Partial<FooterLayoutSettings>;

export type LyricsSettingsPatch = Partial<LyricsSettings>;
export type DesktopLyricsSettingsPatch = Partial<DesktopLyricsSettings>;
type LegacyVolumeBalanceSettingsPatch = Partial<AudioSettings['volumeBalance']> & {
  targetLufs?: number;
};
export type AudioSettingsPatch = Partial<Omit<AudioSettings, 'volumeBalance'>> & {
  volumeBalance?: LegacyVolumeBalanceSettingsPatch | boolean;
};
export type ImportedLyricsFontsPatch = ImportedLyricsFont[];
export type DownloadSettingsPatch = Partial<DownloadSettings>;
export type UploadSettingsPatch = Partial<UploadSettings>;
export type PluginSettingsPatch = Partial<PluginSettings>;
export type AutoSyncConfigPatch = Partial<AutoSyncConfig>;
export type LogSettingsPatch = Partial<LogSettings>;

export interface AppSettingsPatch
  extends Partial<Omit<AppSettings, 'theme' | 'sidebar' | 'footerLayout' | 'shortcuts' | 'lyrics' | 'desktopLyrics' | 'audio' | 'customLyricsFonts' | 'download' | 'upload' | 'plugins' | 'autoSync' | 'logging'>> {
  theme?: ThemeSettingsPatch;
  sidebar?: SidebarSettingsPatch;
  footerLayout?: FooterLayoutSettingsPatch;
  shortcuts?: ShortcutSettingsPatch;
  lyrics?: LyricsSettingsPatch;
  desktopLyrics?: DesktopLyricsSettingsPatch;
  audio?: AudioSettingsPatch;
  customLyricsFonts?: ImportedLyricsFontsPatch;
  download?: DownloadSettingsPatch;
  upload?: UploadSettingsPatch;
  plugins?: PluginSettingsPatch;
  autoSync?: AutoSyncConfigPatch;
  logging?: LogSettingsPatch;
}

export interface DeprecatedAppSettingsPatch extends AppSettingsPatch {
  minimizeToTray?: boolean;
}

export const normalizeForegroundStyle = (
  foregroundStyle: string | null | undefined,
): ThemeSettings['customBackground']['foregroundStyle'] => (foregroundStyle === 'dark' ? 'dark' : 'light');

export const defaultThemeSettings: ThemeSettings = {
  mode: 'light',
  dynamicBgType: 'none',
  windowMaterial: 'none',
  keepWindowMaterialOnBlur: false,
  useCustomTrayMenu: true,
  flowColorBoost: 25,
  flowDepth: 30,
  flowSpeed: 52,
  flowTexture: 34,
  windowBlurTint: 50,
  customBgPath: '',
  opacity: 0.8,
  blur: 20,
  customBackground: {
    imagePath: '',
    blur: 20,
    opacity: 1,
    maskColor: '#000000',
    maskAlpha: 0.4,
    scale: 1,
    foregroundStyle: 'light',
    translateX: 0,
    translateY: 0,
  },
};

export const defaultSidebarSettings: SidebarSettings = {
  showLocalMusic: true,
  showArtists: false,
  showAlbums: false,
  showFavorites: true,
  showRecent: true,
  showFolders: true,
  showStatistics: true,
  showPlugins: true,
  showAccount: true,
  order: [...DEFAULT_SIDEBAR_ORDER],
};

export const defaultFooterLayoutSettings: FooterLayoutSettings = {
  left: [...DEFAULT_FOOTER_LAYOUT.left],
  middleLeft: DEFAULT_FOOTER_LAYOUT.middleLeft,
  middleRight: DEFAULT_FOOTER_LAYOUT.middleRight,
  right: [...DEFAULT_FOOTER_LAYOUT.right],
  hidden: [...DEFAULT_FOOTER_LAYOUT.hidden],
};

export const defaultAudioSettings: AudioSettings = {
  outputMode: 'shared',
  volumeBalance: {
    enabled: false,
    gainOffsetDb: 0,
    preventClipping: true,
  },
  equalizer: {
    enabled: false,
    preamp: 0.0,
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  showEqualizerInFooter: true,
  onlineDefaultQuality: '320k',
  onlineFailureBehavior: 'skip',
  onlineQualityFallbackBehavior: 'lower',
  streamCacheSizeMB: 512,
  fadeInOutEnabled: false,
  fadeInOutDurationMs: 1000,
  autoSwitchSourceOnFailure: true,
};

export const defaultDownloadSettings: DownloadSettings = {
  downloadPath: '',
  format: 'mp3',
  quality: '320k',
  downloadLyrics: true,
  lyricsFormat: 'lrc',
  lyricsStyle: 'word-by-word',
  overwriteExisting: false,
  keepSourceFilename: false,
  fileNameStyle: 'artist-title',
  rememberDownloadPath: false,
  qualityFallbackBehavior: 'lower',
  embedMetadata: true,
  embedLyrics: true,
  embedCover: true,
};

export const defaultUploadSettings: UploadSettings = {
  playlists: true,
  history: true,
  favorites: true,
  plugins: true,
  settings: false,
};

export const defaultPluginSettings: PluginSettings = {
  autoUpdateOnStartup: false,
  lazyLoad: false,
  skipVersionCheck: false,
};

export const defaultAutoSyncConfig: AutoSyncConfig = {
  enabled: false,
  syncIntervalSeconds: 3600,
  maxDelayMinutes: 30,
  delayedCount: 0,
  lastSyncAttemptAt: 0,
  lastSyncSuccessAt: 0,
  nextSyncAt: 0,
};

export const defaultLogSettings: LogSettings = {
  minimumLevel: 'info',
  retentionDays: 1,
  autoAnalyze: true,
};

export const defaultAppSettings: AppSettings = {
  closeToTray: true,
  showDesktopLyrics: false,
  showQualityBadges: true,
  showSongComments: true,
  enableScrollToTopButton: true,
  libraryMinDurationSeconds: 0,
  // Deprecated compat field. Main folder-source behavior no longer depends on it.
  linkFoldersToLibrary: false,
  lyricsSyncOffset: 0,
  organizeRoot: 'D:\\Music',
  enableAutoOrganize: true,
  organizeRule: '{Artist}/{Album}/{Title}',
  audio: defaultAudioSettings,
  customLyricsFonts: [],
  lyrics: createDefaultLyricsSettings(),
  desktopLyrics: createDefaultDesktopLyricsSettings(),
  theme: defaultThemeSettings,
  sidebar: defaultSidebarSettings,
  footerLayout: defaultFooterLayoutSettings,
  shortcuts: createDefaultShortcutSettings(),
  showTaskbarPlayer: false,
  taskbarPlayerCanDrag: false,
  gpuAcceleration: true,
  checkUpdateOnStartup: true,
  writeArtistAvatarToTags: false,
  download: defaultDownloadSettings,
  upload: defaultUploadSettings,
  plugins: defaultPluginSettings,
  autoSync: defaultAutoSyncConfig,
  logging: defaultLogSettings,
  songClickAction: 'double',
};

export const createDefaultThemeSettings = (): ThemeSettings => ({
  ...defaultThemeSettings,
  customBackground: {
    ...defaultThemeSettings.customBackground,
  },
});

export const createDefaultSidebarSettings = (): SidebarSettings => ({
  ...defaultSidebarSettings,
  // order 必须深拷贝，避免多处共享同一数组引用被就地修改
  order: [...defaultSidebarSettings.order],
});

export const createDefaultFooterLayoutSettings = (): FooterLayoutSettings => ({
  left: [...defaultFooterLayoutSettings.left],
  middleLeft: defaultFooterLayoutSettings.middleLeft,
  middleRight: defaultFooterLayoutSettings.middleRight,
  right: [...defaultFooterLayoutSettings.right],
  hidden: [...defaultFooterLayoutSettings.hidden],
});

export const createDefaultAudioSettings = (): AudioSettings => ({
  ...defaultAudioSettings,
  volumeBalance: {
    ...defaultAudioSettings.volumeBalance,
  },
  equalizer: {
    ...defaultAudioSettings.equalizer,
    gains: [...defaultAudioSettings.equalizer.gains],
  },
});

export const createDefaultDownloadSettings = (): DownloadSettings => ({
  ...defaultDownloadSettings,
});

export const createDefaultUploadSettings = (): UploadSettings => ({
  ...defaultUploadSettings,
});

export const createDefaultAutoSyncConfig = (): AutoSyncConfig => ({
  ...defaultAutoSyncConfig,
});

export const createDefaultLogSettings = (): LogSettings => ({
  ...defaultLogSettings,
});

export const mergeUploadSettings = (
  base: UploadSettings,
  patch: UploadSettingsPatch,
): UploadSettings => ({
  playlists: typeof patch.playlists === 'boolean' ? patch.playlists : base.playlists,
  history: typeof patch.history === 'boolean' ? patch.history : base.history,
  favorites: typeof patch.favorites === 'boolean' ? patch.favorites : base.favorites,
  plugins: typeof patch.plugins === 'boolean' ? patch.plugins : base.plugins,
  settings: typeof patch.settings === 'boolean' ? patch.settings : base.settings,
});

const VALID_DOWNLOAD_FORMATS: DownloadSettings['format'][] = ['flac', 'mp3', 'wav', 'aac'];
const VALID_DOWNLOAD_QUALITIES = ALL_QUALITY_KEYS;
const VALID_LYRICS_FORMATS: DownloadSettings['lyricsFormat'][] = ['lrc', 'txt'];
const VALID_LYRICS_STYLES: DownloadLyricsStyle[] = ['word-by-word', 'line-by-line'];
const VALID_FILE_NAME_STYLES: DownloadSettings['fileNameStyle'][] = [
  'artist-title',
  'title-artist',
  'title-artist-album',
];

export const mergeDownloadSettings = (
  base: DownloadSettings,
  patch: DownloadSettingsPatch,
): DownloadSettings => {
  const format = patch.format && VALID_DOWNLOAD_FORMATS.includes(patch.format)
    ? patch.format
    : base.format;
  const quality = patch.quality && VALID_DOWNLOAD_QUALITIES.includes(patch.quality)
    ? patch.quality
    : base.quality;
  const lyricsFormat = patch.lyricsFormat && VALID_LYRICS_FORMATS.includes(patch.lyricsFormat)
    ? patch.lyricsFormat
    : base.lyricsFormat;
  const lyricsStyle = patch.lyricsStyle && VALID_LYRICS_STYLES.includes(patch.lyricsStyle)
    ? patch.lyricsStyle
    : base.lyricsStyle;
  const fileNameStyle = patch.fileNameStyle && VALID_FILE_NAME_STYLES.includes(patch.fileNameStyle)
    ? patch.fileNameStyle
    : base.fileNameStyle;
  const qualityFallbackBehavior = patch.qualityFallbackBehavior && ['lower', 'higher'].includes(patch.qualityFallbackBehavior)
    ? patch.qualityFallbackBehavior
    : base.qualityFallbackBehavior;

  return {
    downloadPath: typeof patch.downloadPath === 'string' ? patch.downloadPath : base.downloadPath,
    format,
    quality,
    downloadLyrics: typeof patch.downloadLyrics === 'boolean' ? patch.downloadLyrics : base.downloadLyrics,
    lyricsFormat,
    lyricsStyle,
    overwriteExisting: typeof patch.overwriteExisting === 'boolean' ? patch.overwriteExisting : base.overwriteExisting,
    keepSourceFilename: typeof patch.keepSourceFilename === 'boolean' ? patch.keepSourceFilename : base.keepSourceFilename,
    fileNameStyle,
    rememberDownloadPath: typeof patch.rememberDownloadPath === 'boolean' ? patch.rememberDownloadPath : base.rememberDownloadPath,
    qualityFallbackBehavior,
    embedMetadata: typeof patch.embedMetadata === 'boolean' ? patch.embedMetadata : base.embedMetadata,
    embedLyrics: typeof patch.embedLyrics === 'boolean' ? patch.embedLyrics : base.embedLyrics,
    embedCover: typeof patch.embedCover === 'boolean' ? patch.embedCover : base.embedCover,
  };
};

export const normalizeLibraryMinDurationSeconds = (
  value: number | null | undefined,
): number => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }

  return Math.round(numericValue);
};

export const createDefaultAppSettings = (): AppSettings => ({
  ...defaultAppSettings,
  customLyricsFonts: [],
  lyrics: createDefaultLyricsSettings(),
  desktopLyrics: createDefaultDesktopLyricsSettings(),
  audio: createDefaultAudioSettings(),
  theme: createDefaultThemeSettings(),
  sidebar: createDefaultSidebarSettings(),
  footerLayout: createDefaultFooterLayoutSettings(),
  shortcuts: createDefaultShortcutSettings(),
  download: createDefaultDownloadSettings(),
  upload: createDefaultUploadSettings(),
  autoSync: createDefaultAutoSyncConfig(),
  logging: createDefaultLogSettings(),
});

export const mergeThemeSettings = (
  base: ThemeSettings,
  patch: ThemeSettingsPatch,
): ThemeSettings => {
  const mergedCustomBackground = {
    ...base.customBackground,
    ...(patch.customBackground ?? {}),
  };

  return {
    ...base,
    ...patch,
    customBackground: {
      ...mergedCustomBackground,
      foregroundStyle: normalizeForegroundStyle(mergedCustomBackground.foregroundStyle),
    },
  };
};

export const mergeSidebarSettings = (
  base: SidebarSettings,
  patch: SidebarSettingsPatch,
): SidebarSettings => ({
  ...base,
  ...patch,
  // 归一化顺序：剔除非法项、去重、补齐缺失项，兼容旧配置（无 order 字段）
  order: normalizeSidebarOrder(patch.order ?? base.order),
});

/**
 * 合并底部栏布局：把 patch 与 base 合并后整体归一化。
 * 直接用 normalizeFooterLayout 处理合并结果，确保任何路径写入的布局都合法。
 */
export const mergeFooterLayoutSettings = (
  base: FooterLayoutSettings,
  patch: FooterLayoutSettingsPatch,
): FooterLayoutSettings => normalizeFooterLayout({
  left: patch.left ?? base.left,
  middleLeft: patch.middleLeft !== undefined ? patch.middleLeft : base.middleLeft,
  middleRight: patch.middleRight !== undefined ? patch.middleRight : base.middleRight,
  right: patch.right ?? base.right,
  hidden: patch.hidden ?? base.hidden,
});

export const mergeAudioSettings = (
  base: AudioSettings,
  patch: AudioSettingsPatch,
): AudioSettings => {
  const volumeBalancePatch = patch.volumeBalance;
  let enabled = base.volumeBalance?.enabled ?? false;
  let gainOffsetDb = base.volumeBalance?.gainOffsetDb ?? 0;
  let preventClipping = base.volumeBalance?.preventClipping ?? true;

  if (typeof volumeBalancePatch === 'boolean') {
    enabled = volumeBalancePatch;
  } else if (volumeBalancePatch && typeof volumeBalancePatch === 'object') {
    enabled = volumeBalancePatch.enabled ?? enabled;
    gainOffsetDb = volumeBalancePatch.gainOffsetDb
      ?? (volumeBalancePatch.targetLufs !== undefined ? volumeBalancePatch.targetLufs - (-18) : gainOffsetDb);
    preventClipping = volumeBalancePatch.preventClipping ?? preventClipping;
  }

  const equalizerPatch = patch.equalizer;
  let eqEnabled = base.equalizer?.enabled ?? false;
  let eqPreamp = base.equalizer?.preamp ?? 0.0;
  let eqGains = base.equalizer?.gains ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let eqCurrentPresetId = base.equalizer?.currentPresetId ?? null;

  if (equalizerPatch && typeof equalizerPatch === 'object') {
    eqEnabled = equalizerPatch.enabled ?? eqEnabled;
    eqPreamp = equalizerPatch.preamp ?? eqPreamp;
    eqGains = equalizerPatch.gains ? [...equalizerPatch.gains] : eqGains;
    if ('currentPresetId' in equalizerPatch) {
      eqCurrentPresetId = equalizerPatch.currentPresetId ?? null;
    }
  }

  const nextOutputMode =
    patch.outputMode === 'wasapiExclusive' || patch.outputMode === 'shared'
      ? patch.outputMode
      : base.outputMode ?? 'shared';

  const VALID_ONLINE_QUALITIES = ALL_QUALITY_KEYS;
  const VALID_FAILURE_BEHAVIORS = ['skip', 'stop'];
  const VALID_QUALITY_FALLBACK_BEHAVIORS = ['pause', 'lower', 'higher'];

  return {
    ...base,
    outputMode: nextOutputMode,
    volumeBalance: {
      enabled,
      gainOffsetDb,
      preventClipping,
    },
    equalizer: {
      enabled: eqEnabled,
      preamp: eqPreamp,
      gains: eqGains,
      currentPresetId: eqCurrentPresetId,
    },
    showEqualizerInFooter: patch.showEqualizerInFooter ?? base.showEqualizerInFooter ?? true,
    onlineDefaultQuality: VALID_ONLINE_QUALITIES.includes(patch.onlineDefaultQuality as any)
      ? (patch.onlineDefaultQuality as AudioSettings['onlineDefaultQuality'])
      : base.onlineDefaultQuality ?? '320k',
    onlineFailureBehavior: VALID_FAILURE_BEHAVIORS.includes(patch.onlineFailureBehavior as string)
      ? (patch.onlineFailureBehavior as AudioSettings['onlineFailureBehavior'])
      : base.onlineFailureBehavior ?? 'skip',
    onlineQualityFallbackBehavior: VALID_QUALITY_FALLBACK_BEHAVIORS.includes(patch.onlineQualityFallbackBehavior as string)
      ? (patch.onlineQualityFallbackBehavior as AudioSettings['onlineQualityFallbackBehavior'])
      : base.onlineQualityFallbackBehavior ?? 'lower',
    streamCacheSizeMB: Number.isFinite(patch.streamCacheSizeMB) && patch.streamCacheSizeMB! > 0
      ? Math.round(patch.streamCacheSizeMB!)
      : base.streamCacheSizeMB ?? 512,
    fadeInOutEnabled: typeof patch.fadeInOutEnabled === 'boolean'
      ? patch.fadeInOutEnabled
      : base.fadeInOutEnabled ?? false,
    fadeInOutDurationMs: Number.isFinite(patch.fadeInOutDurationMs) && patch.fadeInOutDurationMs! > 0
      ? Math.max(100, Math.min(2000, Math.round(patch.fadeInOutDurationMs!)))
      : base.fadeInOutDurationMs ?? 1000,
    autoSwitchSourceOnFailure: typeof patch.autoSwitchSourceOnFailure === 'boolean'
      ? patch.autoSwitchSourceOnFailure
      : base.autoSwitchSourceOnFailure ?? true,
  };
};

export const mergeAppSettings = (
  base: AppSettings,
  patch: DeprecatedAppSettingsPatch,
): AppSettings => {
  const {
    minimizeToTray: _deprecated,
    libraryMinDurationSeconds,
    ...rest
  } = patch;

  return {
    // Ignore removed legacy fields that may still exist in persisted settings.
    ...base,
    ...rest,
    lyricsSyncOffset: normalizeLyricsSyncOffsetSeconds(
      patch.lyricsSyncOffset ?? base.lyricsSyncOffset,
    ),
    libraryMinDurationSeconds: normalizeLibraryMinDurationSeconds(
      libraryMinDurationSeconds ?? base.libraryMinDurationSeconds,
    ),
    // 仅在 patch 含对应子对象时才 merge，避免无谓重建引用触发下游 computed 重算
    lyrics: patch.lyrics ? mergeLyricsSettings(base.lyrics, patch.lyrics) : base.lyrics,
    desktopLyrics: patch.desktopLyrics ? mergeDesktopLyricsSettings(base.desktopLyrics, patch.desktopLyrics) : base.desktopLyrics,
    audio: patch.audio ? mergeAudioSettings(base.audio ?? createDefaultAudioSettings(), patch.audio) : (base.audio ?? createDefaultAudioSettings()),
    customLyricsFonts: patch.customLyricsFonts ? normalizeImportedLyricsFonts(patch.customLyricsFonts) : base.customLyricsFonts,
    theme: patch.theme ? mergeThemeSettings(base.theme, patch.theme) : base.theme,
    sidebar: patch.sidebar ? mergeSidebarSettings(base.sidebar, patch.sidebar) : base.sidebar,
    footerLayout: patch.footerLayout ? mergeFooterLayoutSettings(base.footerLayout ?? createDefaultFooterLayoutSettings(), patch.footerLayout) : (base.footerLayout ?? createDefaultFooterLayoutSettings()),
    shortcuts: patch.shortcuts ? mergeShortcutSettings(base.shortcuts, patch.shortcuts) : base.shortcuts,
    download: patch.download ? mergeDownloadSettings(base.download ?? createDefaultDownloadSettings(), patch.download) : (base.download ?? createDefaultDownloadSettings()),
    upload: patch.upload ? mergeUploadSettings(base.upload ?? createDefaultUploadSettings(), patch.upload) : (base.upload ?? createDefaultUploadSettings()),
    plugins: patch.plugins ? mergePluginSettings(base.plugins ?? defaultPluginSettings, patch.plugins) : (base.plugins ?? defaultPluginSettings),
    autoSync: patch.autoSync ? mergeAutoSyncConfig(base.autoSync ?? createDefaultAutoSyncConfig(), patch.autoSync) : (base.autoSync ?? createDefaultAutoSyncConfig()),
    logging: patch.logging ? mergeLogSettings(base.logging ?? createDefaultLogSettings(), patch.logging) : (base.logging ?? createDefaultLogSettings()),
  };
};

const mergePluginSettings = (base: PluginSettings, patch: Partial<PluginSettings>): PluginSettings => ({
  autoUpdateOnStartup: typeof patch.autoUpdateOnStartup === 'boolean' ? patch.autoUpdateOnStartup : base.autoUpdateOnStartup,
  lazyLoad: typeof patch.lazyLoad === 'boolean' ? patch.lazyLoad : base.lazyLoad,
  skipVersionCheck: typeof patch.skipVersionCheck === 'boolean' ? patch.skipVersionCheck : base.skipVersionCheck,
});

const mergeAutoSyncConfig = (base: AutoSyncConfig, patch: Partial<AutoSyncConfig>): AutoSyncConfig => ({
  enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
  syncIntervalSeconds: typeof patch.syncIntervalSeconds === 'number' && patch.syncIntervalSeconds >= 0 ? patch.syncIntervalSeconds : base.syncIntervalSeconds,
  maxDelayMinutes: typeof patch.maxDelayMinutes === 'number' && patch.maxDelayMinutes >= 0 ? patch.maxDelayMinutes : base.maxDelayMinutes,
  delayedCount: typeof patch.delayedCount === 'number' ? patch.delayedCount : base.delayedCount,
  lastSyncAttemptAt: typeof patch.lastSyncAttemptAt === 'number' ? patch.lastSyncAttemptAt : base.lastSyncAttemptAt,
  lastSyncSuccessAt: typeof patch.lastSyncSuccessAt === 'number' ? patch.lastSyncSuccessAt : base.lastSyncSuccessAt,
  nextSyncAt: typeof patch.nextSyncAt === 'number' ? patch.nextSyncAt : base.nextSyncAt,
});

const LOG_LEVELS: LogSettings['minimumLevel'][] = ['debug', 'info', 'warn', 'error'];

export const mergeLogSettings = (
  base: LogSettings,
  patch: Partial<LogSettings>,
): LogSettings => ({
  minimumLevel: patch.minimumLevel && LOG_LEVELS.includes(patch.minimumLevel)
    ? patch.minimumLevel
    : base.minimumLevel,
  retentionDays: 1,
  autoAnalyze: typeof patch.autoAnalyze === 'boolean' ? patch.autoAnalyze : base.autoAnalyze,
});

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>(createDefaultAppSettings());
  const audioDelay = computed(() => settings.value.lyricsSyncOffset);
  const theme = computed<ThemeSettings>({
    get: () => settings.value.theme,
    set: nextTheme => {
      settings.value = {
        ...settings.value,
        theme: mergeThemeSettings(createDefaultThemeSettings(), nextTheme),
      };
    },
  });
  const sidebar = computed<SidebarSettings>({
    get: () => settings.value.sidebar,
    set: nextSidebar => {
      settings.value = {
        ...settings.value,
        sidebar: mergeSidebarSettings(createDefaultSidebarSettings(), nextSidebar),
      };
    },
  });
  const footerLayout = computed<FooterLayoutSettings>({
    get: () => settings.value.footerLayout,
    set: nextFooterLayout => {
      settings.value = {
        ...settings.value,
        footerLayout: mergeFooterLayoutSettings(createDefaultFooterLayoutSettings(), nextFooterLayout),
      };
    },
  });

  const replaceSettings = (nextSettings: AppSettings) => {
    settings.value = mergeAppSettings(createDefaultAppSettings(), nextSettings);
  };

  const patchSettings = (partialSettings: AppSettingsPatch) => {
    settings.value = mergeAppSettings(settings.value, partialSettings);
  };

  const resetSettings = () => {
    settings.value = createDefaultAppSettings();
  };

  const replaceTheme = (nextTheme: ThemeSettings) => {
    theme.value = nextTheme;
  };

  const patchTheme = (partialTheme: ThemeSettingsPatch) => {
    settings.value = {
      ...settings.value,
      theme: mergeThemeSettings(settings.value.theme, partialTheme),
    };
  };

  const replaceSidebar = (nextSidebar: SidebarSettings) => {
    sidebar.value = nextSidebar;
  };

  const patchSidebar = (partialSidebar: SidebarSettingsPatch) => {
    settings.value = {
      ...settings.value,
      sidebar: mergeSidebarSettings(settings.value.sidebar, partialSidebar),
    };
  };

  const patchFooterLayout = (partialFooterLayout: FooterLayoutSettingsPatch) => {
    settings.value = {
      ...settings.value,
      footerLayout: mergeFooterLayoutSettings(settings.value.footerLayout, partialFooterLayout),
    };
  };

  // 均衡器预设管理
  const equalizerPresets = ref<EqualizerPreset[]>(
    playerStorage.readEqualizerPresets()
  );
  
  const userPresets = computed(() => 
    equalizerPresets.value.filter(p => !p.isBuiltin)
  );
  
  const saveEqualizerPreset = (name: string) => {
    const newPreset: EqualizerPreset = {
      id: createUserPresetId(),
      name,
      preamp: settings.value.audio.equalizer.preamp,
      gains: [...settings.value.audio.equalizer.gains],
      isBuiltin: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    equalizerPresets.value.push(newPreset);
    playerStorage.writeEqualizerPresets(userPresets.value);
    
    // 使用patchSettings替换整个equalizer对象
    patchSettings({
      audio: {
        equalizer: {
          ...settings.value.audio.equalizer,
          currentPresetId: newPreset.id,
        },
      },
    });
    
    return newPreset;
  };
  
  const updateEqualizerPreset = (presetId: string, name: string) => {
    const preset = equalizerPresets.value.find(p => p.id === presetId);
    if (preset && !preset.isBuiltin) {
      preset.name = name;
      preset.preamp = settings.value.audio.equalizer.preamp;
      preset.gains = [...settings.value.audio.equalizer.gains];
      preset.updatedAt = Date.now();
      playerStorage.writeEqualizerPresets(userPresets.value);
    }
  };
  
  const deleteEqualizerPreset = (presetId: string) => {
    const index = equalizerPresets.value.findIndex(p => p.id === presetId);
    if (index !== -1 && !equalizerPresets.value[index].isBuiltin) {
      equalizerPresets.value.splice(index, 1);
      playerStorage.writeEqualizerPresets(userPresets.value);
      
      // 如果删除的是当前预设，清除当前预设ID
      if (settings.value.audio.equalizer.currentPresetId === presetId) {
        patchSettings({
          audio: {
            equalizer: {
              ...settings.value.audio.equalizer,
              currentPresetId: null,
            },
          },
        });
      }
    }
  };
  
  const loadEqualizerPreset = (presetId: string) => {
    const preset = equalizerPresets.value.find(p => p.id === presetId);
    if (preset) {
      patchSettings({
        audio: {
          equalizer: {
            enabled: true,
            preamp: preset.preamp,
            gains: [...preset.gains],
            currentPresetId: presetId,
          },
        },
      });
    }
  };

  return {
    settings,
    audioDelay,
    theme,
    sidebar,
    footerLayout,
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
    saveEqualizerPreset,
    updateEqualizerPreset,
    deleteEqualizerPreset,
    loadEqualizerPreset,
  };
});
