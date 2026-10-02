export interface SongCore {
  id?: number;
  name: string;
  title?: string;
  path: string;
  artist: string;
  artist_names: string[];
  effective_artist_names: string[];
  album: string;
  album_artist: string;
  album_key: string;
  is_various_artists_album: boolean;
  collapse_artist_credits: boolean;
  duration: number;
  cover_thumb_path?: string;
  genre?: string;
  year?: string;
  bitrate?: number;
  sample_rate?: number;
  bit_depth?: number;
  format?: string;
  container?: string;
  codec?: string;
  file_size?: number;
  track_number?: string;
  disc_number?: string;
  added_at?: number;
  file_modified_at?: number;
  source_type?: 'local' | 'remote' | 'plugin';
  /** 本软件内手动添加（导入歌单从源端更新时跳过删除） */
  addedInApp?: boolean;
  remote_source_id?: string;
  remote_requested_quality?: QualityKey;
  remote_fallback_behavior?: OnlineQualityFallbackBehavior;
  remote_actual_quality?: QualityKey;
  plugin_id?: string;
  cue_source_path?: string;
  cue_start_offset?: number;
  cue_end_offset?: number;
  comment?: string;
  lyrics_raw?: string;
  rawData?: any;
  remote_headers?: Record<string, string>;
  remote_ekey?: string;
  remote_cek?: string;
}

export interface Song extends SongCore {}

export type LibrarySong = Omit<Song, 'container' | 'codec' | 'file_size' | 'genre' | 'year'>;

export interface SongDetail {
  path: string;
  genre?: string;
  year?: string;
  track_number?: string;
  disc_number?: string;
  comment?: string;
  container?: string;
  codec?: string;
  file_size?: number;
}

export interface ArtistCatalogItem {
  id: number;
  name: string;
  count: number;
  firstSongPath: string;
  avatarPath: string | null;
}

export interface AlbumCatalogItem {
  key: string;
  name: string;
  count: number;
  artist: string;
  firstSongPath: string;
}

export interface RecentAlbumCatalogItem {
  key: string;
  name: string;
  artist: string;
  playedAt: number;
  firstSongPath: string;
}

export interface RecentPlaylistCatalogItem {
  id: string;
  name: string;
  count: number;
  playedAt: number;
  firstSongPath: string;
}

export interface HistoryItem {
  path: string;
  playedAt: number;
}

export interface Playlist {
  id: string;
  name: string;
  songPaths: string[];
  createdAt?: string;
  coverPath?: string;
  songs?: Song[]; // 实现
  cloudId?: string;
  isCloud?: boolean;
  cloudCoverUrl?: string; // 实现
  isFavorite?: boolean; // 实现
  /** 来源插件 id（MusicFree 插件 id 或 wy|tx|kw|kg 平台），用于从源端更新 */
  sourcePluginId?: string;
  /** 来源链接或 ID（平台歌单链接/ID、收藏夹链接或 ID） */
  sourceUrl?: string;
  /** 来源歌单原始数据（插件搜索结果的 rawData），用于从源端更新 */
  sourceRaw?: any;
}

export interface LibraryFolder {
  path: string;
  song_count: number;
}

export type RemoteSourceProvider = 'webdav';

export interface RemoteSource {
  id: string;
  name: string;
  provider: RemoteSourceProvider;
  baseUrl: string;
  username: string | null;
  rootPath: string;
  enabled: boolean;
  lastSyncAt: number | null;
  lastSyncError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RemoteSourceInput {
  id?: string;
  name: string;
  provider: RemoteSourceProvider;
  baseUrl: string;
  username?: string | null;
  password?: string | null;
  rootPath?: string | null;
}

export interface RemoteConnectionResult {
  ok: boolean;
  message: string;
}

export interface RemoteSyncResult {
  sourceId: string;
  indexedFiles: number;
  audioFiles: number;
  parsedSongs: number;
}

export interface RemoteFileEntry {
  remotePath: string;
  name: string;
  size: number;
  etag: string | null;
  modifiedAt: string | null;
  isDir: boolean;
}

export interface RemoteCacheUsage {
  bytes: number;
  files: number;
  limitBytes: number;
}

export type RemoteSyncPhase = 'scanning' | 'parsing' | 'writing' | 'complete' | 'error';

export interface RemoteSyncProgress {
  sourceId: string;
  phase: RemoteSyncPhase;
  current: number;
  total: number;
  message: string;
  done: boolean;
  failed: boolean;
}

export interface RemoteDownloadProgress {
  uri: string;
  downloaded: number;
  total: number | null;
  percent: number | null;
  done: boolean;
  failed: boolean;
  message: string | null;
}

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  child_count: number;
  children_loaded: boolean;
  song_count: number;
  cover_song_path: string | null;
  is_expanded: boolean;
  is_loading?: boolean;
}

export type LibraryScanPhase = 'collecting' | 'parsing' | 'writing' | 'complete' | 'error';
export type LibraryScanTrigger = 'bootstrap' | 'first-import' | 'manual-rescan' | 'folder-add';
export type LibraryScanVisibility = 'silent' | 'hero' | 'inline';

export interface LibraryScanProgress {
  phase: LibraryScanPhase;
  current: number;
  total: number;
  folder_path: string;
  folder_index: number;
  folder_total: number;
  message: string | null;
  done: boolean;
  failed: boolean;
}

export interface LibraryScanSession {
  trigger: LibraryScanTrigger;
  visibility: LibraryScanVisibility;
  startedAt: number;
  hadLibraryFoldersAtStart: boolean;
  hadSongsAtStart: boolean;
  sourcePath?: string;
}

/** 写实唱机底座材质：浅灰（默认）/ 哑光深灰 / 橡木 / 大理石 */
export type VinylPlinthMaterial = 'light' | 'matte' | 'oak' | 'marble';

/** 黑胶模式外圈转盘样式：金属光泽（默认）/ 经典黑胶 */
export type VinylPlatterStyle = 'metal' | 'vinyl';

/** 睡眠定时器到点后执行的动作（与 src-tauri/src/sleep_timer.rs 的 serde snake_case 对齐） */
export type SleepTimerAction = 'pause' | 'exit' | 'hide_to_tray';

/** 睡眠定时器当前状态（Rust 侧 get_sleep_timer 回传） */
export interface SleepTimerSnapshot {
  action: SleepTimerAction;
  /** 剩余秒数；后端为墙钟计时，这里只用于显示 */
  remaining_seconds: number;
}

export type DesktopThemeMode = 'light' | 'dark';
export type DesktopQuickEntryShape = 'circle' | 'rounded' | 'square';

export interface DesktopThemeSurface {
  color: string;
  opacity: number;
}

export interface DesktopThemeVisuals {
  quickEntryShape: DesktopQuickEntryShape;
  icons: Record<string, string>;
  stickers: Record<string, string>;
  surfaces: Record<string, DesktopThemeSurface>;
}

export interface ThemeSettings {
  mode: 'light' | 'dark' | 'custom' | 'system';
  accentColor: string;
  desktopTheme: DesktopThemeVisuals;
  playerDetailCoverBehavior: 'show' | 'hide' | 'remember';
  lastPlayerDetailCoverVisible: boolean;
  /** 播放详情页皮肤：classic=经典方形封面，vinyl=黑胶唱片（UI 移植自 mozarta-nexus/music-web-player） */
  playerDetailStyle: 'classic' | 'vinyl';
  /** 播放详情页多边形流光背景（Voronoi 网格：随机边数多边形缓慢漂移） */
  playerDetailMeshBackground: boolean;
  /** 多边形流光背景的边缘抗锯齿：片元内做屏幕空间平滑，并提高渲染分辨率 */
  playerDetailMeshAntiAlias: boolean;
  /** 多边形流光背景的流动速度倍率（0 为静止，1 为默认） */
  playerDetailMeshSpeed: number;
  /** 写实唱机底座材质（浅灰 / 哑光深灰 / 橡木 / 大理石） */
  playerDetailVinylMaterial: VinylPlinthMaterial;
  /** 黑胶模式外圈转盘样式（金属光泽 / 经典黑胶） */
  playerDetailVinylPlatterStyle: VinylPlatterStyle;
  dynamicBgType: 'none' | 'flow' | 'blur';
  windowMaterial: 'none' | 'mica' | 'acrylic' | 'blur';
  keepWindowMaterialOnBlur: boolean;
  useCustomTrayMenu: boolean;
  useGlassSwitch: boolean;
  showLeaderboard: boolean;
  flowColorBoost: number;
  flowDepth: number;
  flowSpeed: number;
  flowTexture: number;
  windowBlurTint: number;
  customBgPath: string;
  opacity: number;
  blur: number;
  customBackground: {
    imagePath: string;
    mediaType?: 'image' | 'video';
    blur: number;
    opacity: number;
    maskColor: string;
    maskAlpha: number;
    scale: number;
    foregroundStyle: 'light' | 'dark';
    translateX?: number;
    translateY?: number;
    imageWidth?: number;
    imageHeight?: number;
  }
}

export type SidebarItemKey =
  | 'localMusic'
  | 'artists'
  | 'albums'
  | 'favorites'
  | 'recent'
  | 'folders'
  | 'plugins'
  | 'account';

export interface SidebarSettings {
  showLocalMusic: boolean;
  showArtists: boolean;
  showAlbums: boolean;
  showFavorites: boolean;
  showRecent: boolean;
  showFolders: boolean;
  showStatistics: boolean;
  showPlugins: boolean;
  showAccount: boolean;
  order: SidebarItemKey[];
}

export type FooterItemKey =
  | 'download'
  | 'favorite'
  | 'playMode'
  | 'desktopLyrics'
  | 'quality'
  | 'volume'
  | 'equalizer'
  | 'playlist'
  | 'comment'
  | 'mv'
  | 'share'
  | 'visualizer'
  | 'progress'
  | 'pageStyle'
  | 'pin';

export type FooterContainerKey = 'left' | 'middleLeft' | 'middleRight' | 'right';

export interface FooterLayoutSettings {
  left: FooterItemKey[];
  middleLeft: FooterItemKey | null;
  middleRight: FooterItemKey | null;
  right: FooterItemKey[];
  hidden: FooterItemKey[];
  collapsed?: FooterItemKey[];
}

export type TopBarItemKey =
  | 'back'
  | 'search'
  | 'recognize'
  | 'theme'
  | 'announcement'
  | 'settings'
  | 'account'
  | 'colorScheme';

export type TopBarContainerKey = 'left' | 'right';

export interface TopBarLayoutSettings {
  left: TopBarItemKey[];
  right: TopBarItemKey[];
  hidden: TopBarItemKey[];
}

export type LyricsPlayerAlignment = 'left' | 'center' | 'right';
export type DesktopLyricsPlayerAlignment = LyricsPlayerAlignment | 'split-corners';
export type LyricsColorScheme = 'auto' | 'default' | 'pink' | 'blue' | 'green' | 'white' | 'custom';
export type LyricsFontPreset = string;
export type LyricsPlayerRenderMode = 'amll' | 'light';

export interface ImportedLyricsFont {
  id: string;
  name: string;
  family: string;
  filePath: string;
  importedAt: number;
  format: 'truetype' | 'opentype';
}

export interface LyricsSettings {
  showTranslation: boolean;
  showRomaji: boolean;
  enableWordEffect: boolean; // 实现
  playerRenderMode: LyricsPlayerRenderMode;
  playerFontScale: number;
  playerLineGap: number;
  playerOffsetX: number;
  playerOffsetY: number;
  playerAlignment: LyricsPlayerAlignment;
  playerFontPreset: LyricsFontPreset;
  playerFontSplitEnabled?: boolean;
  playerFontPresetCJK?: LyricsFontPreset;
  playerFontPresetLatin?: LyricsFontPreset;
  backgroundBlur: number;
  customBackgroundImage: string;
}

export interface DesktopLyricsSettings {
  isAlwaysOnTop: boolean;
  alwaysShowShadowBackground: boolean;
  autoHideWhenFullscreen: boolean;
  autoHideWhenPaused: boolean;
  showDoubleLine: boolean;
  enableWordEffect: boolean;
  enableTextOutline: boolean;
  textOutlineWidth: number;
  textOutlineColor: string;
  isLocked: boolean;
  persistLock: boolean;
  centerHorizontally: boolean;
  colorScheme: LyricsColorScheme;
  customPlayedColor: string;
  customUnplayedColor: string;
  customRomajiPlayedColor: string;
  customRomajiUnplayedColor: string;
  customRomajiColor: string;
  customTranslationColor: string;
  textOpacity: number;
  textShadowColor: string;
  firstLineTextShadowStrength: number;
  secondLineTextShadowStrength: number;
  playerFontScale: number;
  subFontScale: number;
  playerLineGap: number;
  playerOffsetX: number;
  playerOffsetY: number;
  playerAlignment: DesktopLyricsPlayerAlignment;
  playerFontPreset: LyricsFontPreset;
}

export type AudioOutputMode = 'shared' | 'wasapiExclusive';

// ==================== 音质类型系统 ==================== 
export type QualityKey = // 实现
  | 'mgg' // 实现
  | '128k' // 实现
  | '192k' // 实现
  | '320k' // 实现
  | 'flac' // 实现
  | 'flac24bit' // 实现
  | 'hires' // 实现
  | 'vinyl' // 实现
  | 'dolby' // 实现
  | 'atmos' // 实现
  | 'atmos_plus' // 实现
  | 'master'; // 实现
export interface QualityMeta { // 实现
  key: QualityKey; // 实现
  label: string;
  description: string;
  isLossless: boolean; // 实现
  rank: number; // 实现
} // 实现
export const QUALITY_META: Record<QualityKey, QualityMeta> = { // 实现
  mgg:         { key: 'mgg',         label: '低清',   description: '96k',         isLossless: false, rank: 1  },
  '128k':      { key: '128k',      label: '普通',   description: '128k',        isLossless: false, rank: 2  },
  '192k':      { key: '192k',      label: '中等',   description: '192k',        isLossless: false, rank: 3  },
  '320k':      { key: '320k',      label: 'HQ',    description: '320k',        isLossless: false, rank: 4  },
  flac:         { key: 'flac',         label: 'SQ',    description: 'flac',       isLossless: true,  rank: 5  },
  flac24bit:    { key: 'flac24bit',    label: 'Hi-Res',description: 'flac24bit',  isLossless: true,  rank: 6  },
  hires:        { key: 'hires',        label: '高解析度', description: 'hires',      isLossless: true,  rank: 7  },
  vinyl:        { key: 'vinyl',        label: '黑胶',   description: 'vinyl',       isLossless: true,  rank: 8  },
  dolby:        { key: 'dolby',        label: '杜比全景声', description: 'dolby',     isLossless: false, rank: 9  },
  atmos:        { key: 'atmos',        label: '臻品音质', description: 'atmos',       isLossless: false, rank: 10 },
  atmos_plus: { key: 'atmos_plus', label: '臻品全景声', description: 'atmos_plus',  isLossless: false, rank: 11 },
  master:       { key: 'master',       label: '臻品母带', description: 'master',      isLossless: true,  rank: 12 },
}; // 实现
export const ALL_QUALITY_KEYS: QualityKey[] = // 实现
  (Object.keys(QUALITY_META) as QualityKey[]) // 实现
    .sort((a, b) => QUALITY_META[a].rank - QUALITY_META[b].rank); // 实现
export const ALL_QUALITY_KEYS_DESC: QualityKey[] = [...ALL_QUALITY_KEYS].reverse(); // 实现
export const BAKA_PLUGIN_QUALITY_KEYS: string[] = ALL_QUALITY_KEYS.map(q => q === 'mgg' ? '96k' : q);

export const BAKA_TO_LEGACY_QUALITY_MAP: Record<QualityKey, 'low' | 'standard' | 'high' | 'super'> = {
  mgg: 'low',
  '128k': 'low',
  '192k': 'standard',
  '320k': 'high',
  flac: 'super',
  flac24bit: 'super',
  hires: 'super',
  vinyl: 'super',
  dolby: 'super',
  atmos: 'super',
  atmos_plus: 'super',
  master: 'super',
};

const QUALITY_KEY_ALIASES: Record<string, QualityKey> = {
  '96k': 'mgg',
  ogg96: 'mgg',
  mgg: 'mgg',
  '128': '128k',
  '128k': '128k',
  '192': '192k',
  '192k': '192k',
  ogg192: '192k',
  '320': '320k',
  '320k': '320k',
  ogg320: '320k',
  exhigh: '320k',
  flac: 'flac',
  sq: 'flac',
  super: 'flac',
  lossless: 'flac',
  flac24: 'flac24bit',
  '24bit': 'flac24bit',
  '24bits': 'flac24bit',
  '24_bit': 'flac24bit',
  flac24bit: 'flac24bit',
  hires: 'hires',
  'hi-res': 'hires',
  hi_res: 'hires',
  hr: 'hires',
  vinyl: 'vinyl',
  dolby: 'dolby',
  atmos: 'atmos',
  galaxy: 'atmos',
  atmosplus: 'atmos_plus',
  atmos_plus: 'atmos_plus',
  'atmos+': 'atmos_plus',
  galaxy51: 'atmos_plus',
  master: 'master',
};

export function normalizeQualityKey(raw: unknown): QualityKey | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, '').replace(/-/g, '_');
  if (!normalized) return null;
  if (normalized in QUALITY_META) return normalized as QualityKey;
  return QUALITY_KEY_ALIASES[normalized] ?? null;
}

export function qualityKeyToBakaPluginQuality(q: QualityKey): string {
  return q === 'mgg' ? '96k' : q;
}

export function qualityKeyToBakaLegacyQuality(q: QualityKey): 'low' | 'standard' | 'high' | 'super' {
  return BAKA_TO_LEGACY_QUALITY_MAP[q];
}

export function qualityKeyToLxQuality(q: QualityKey): string {
  if (q === 'mgg') return '128k';
  if (q in QUALITY_META) return q;
  return '320k';
}

export type OnlineDefaultQuality = QualityKey; // 实现
export type OnlineFailureBehavior = 'skip' | 'stop' | 'autoswitch';
export type OnlineQualityFallbackBehavior = 'pause' | 'lower' | 'higher';
export function resolveOnlinePlayQuality(
  preferred: QualityKey,
  available: QualityKey[] | null,
  fallbackBehavior: OnlineQualityFallbackBehavior,
): QualityKey[] {
  const avail = available && available.length > 0 ? available : [...ALL_QUALITY_KEYS];
  const availableSet = new Set(avail);
  const result: QualityKey[] = [];

  if (availableSet.has(preferred)) {
    result.push(preferred);
  }

  const preferredIdx = ALL_QUALITY_KEYS.indexOf(preferred);
  if (preferredIdx !== -1) {
    if (fallbackBehavior === 'higher') {
      for (let i = preferredIdx + 1; i < ALL_QUALITY_KEYS.length; i++) {
        if (availableSet.has(ALL_QUALITY_KEYS[i])) {
          result.push(ALL_QUALITY_KEYS[i]);
        }
      }
    } else if (fallbackBehavior === 'lower') {
      for (let i = preferredIdx - 1; i >= 0; i--) {
        if (availableSet.has(ALL_QUALITY_KEYS[i])) {
          result.push(ALL_QUALITY_KEYS[i]);
        }
      }
    }
  }

  if (fallbackBehavior === 'pause') {
    return result.length > 0 ? result : [preferred];
  }

  if (result.length === 0 && avail.length > 0) {
    const lowest = [...avail].sort((a, b) => QUALITY_META[a].rank - QUALITY_META[b].rank)[0];
    result.push(lowest);
  }

  return result;
}

export function qualityKeyToMfQuality(q: QualityKey): 'low' | 'standard' | 'high' | 'super' {
  const rank = QUALITY_META[q]?.rank ?? 0;
  if (rank >= 6) return 'super';
  if (rank >= 5) return 'high';
  if (rank >= 4) return 'standard';
  return 'low';
} // 实现
export interface EqualizerPreset {
  id: string;
  name: string;
  preamp: number;
  gains: number[];
  isBuiltin: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface EqualizerSettings {
  enabled: boolean;
  preamp: number;
  gains: number[];
  currentPresetId?: string | null;
}

export interface AudioSettings {
  outputMode: AudioOutputMode;
  outputBitPerfect?: boolean;
  dsdNativePassthrough?: boolean;
  volumeBalance: {
    enabled: boolean;
    gainOffsetDb: number;
    preventClipping: boolean;
  };
  equalizer: EqualizerSettings;
  showEqualizerInFooter: boolean;
  onlineDefaultQuality: OnlineDefaultQuality; // 实现
  onlineFailureBehavior: OnlineFailureBehavior; // 实现
  onlineQualityFallbackBehavior: OnlineQualityFallbackBehavior;
  streamCacheSizeMB: number;
  streamCacheDir?: string;
  fadeInOutEnabled: boolean;
  fadeInOutDurationMs: number;
  mvDefaultQuality?: MvQualityKey;
  mvVideoSyncOffsetMs?: number;
}

export type MvQualityKey = '360P' | '480P' | '720P' | '1080P' | '4K';

export const MV_QUALITY_META: Record<MvQualityKey, { label: string; description: string }> = {
  '360P': { label: '360P', description: '流畅' },
  '480P': { label: '480P', description: '清晰' },
  '720P': { label: '720P', description: '高清' },
  '1080P': { label: '1080P', description: '全高清' },
  '4K': { label: '4K', description: '超高清' },
};

export const MV_QUALITY_KEYS: MvQualityKey[] = ['360P', '480P', '720P', '1080P', '4K'];

export type ShortcutActionId =
  | 'togglePlay'
  | 'prevSong'
  | 'nextSong'
  | 'volumeUp'
  | 'volumeDown'
  | 'toggleMiniMode'
  | 'toggleFavorite'
  | 'toggleDesktopLyrics'
  | 'toggleDesktopLyricsLock';

export interface ShortcutBinding {
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export type ShortcutBindingMap = Record<ShortcutActionId, ShortcutBinding | null>;

export interface ShortcutSettings {
  enabled: boolean;
  globalEnabled: boolean;
  useSystemMediaKeys: boolean;
  local: ShortcutBindingMap;
  global: ShortcutBindingMap;
}

export interface PluginSettings {
  autoUpdateOnStartup: boolean;
  lazyLoad: boolean;
  skipVersionCheck: boolean;
}

export type SongClickAction = 'double' | 'single';
export type AppLanguage = 'system' | 'zh-CN' | 'zh-TW' | 'en-US';
export type PerformanceMode = 'auto' | 'full' | 'performance';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogSettings {
  minimumLevel: LogLevel;
  retentionDays: number;
  autoAnalyze: boolean;
}

export interface AppSettings {
  language: AppLanguage;
  closeToTray: boolean;
  launchOnStartup: boolean;
  launchOnStartupMinimized: boolean;
  /** 已勾选「用弦予音乐打开」的音频扩展名（仅 Windows 生效）。 */
  audioFileAssociations: string[];
  preventSleepWhilePlaying: boolean;
  showDesktopLyrics: boolean;
  showQualityBadges: boolean;
  showSongComments: boolean;
  enableScrollToTopButton: boolean;
  libraryMinDurationSeconds: number;
  linkFoldersToLibrary: boolean;
  lyricsSyncOffset: number;
  organizeRoot: string;
  enableAutoOrganize: boolean;
  organizeRule: string;
  audio: AudioSettings;
  customLyricsFonts: ImportedLyricsFont[];
  lyrics: LyricsSettings;
  desktopLyrics: DesktopLyricsSettings;
  theme: ThemeSettings;
  sidebar: SidebarSettings;
  footerLayout: FooterLayoutSettings;
  topBarLayout: TopBarLayoutSettings;
  shortcuts: ShortcutSettings;
  showTaskbarPlayer: boolean;
  taskbarPlayerCanDrag: boolean;
  gpuAcceleration: boolean;
  performanceMode: PerformanceMode;
  checkUpdateOnStartup: boolean;
  showWelcomeToastOnStartup: boolean;
  writeArtistAvatarToTags: boolean;
  download: DownloadSettings;
  upload: UploadSettings;
  plugins: PluginSettings;
  autoSync: AutoSyncConfig; // 实现
  logging: LogSettings;
  songClickAction: SongClickAction;
  shareLinkValidityMinutes: number;
  sharePlaybackFailureBehavior: 'pause' | 'replace';
  dlnaRendererEnabled: boolean;
  dlnaRendererName: string;
}

export type DownloadFormat = 'flac' | 'mp3' | 'wav' | 'aac';
export type DownloadQuality = QualityKey; // 实现
export type DownloadFileNameStyle = 'artist-title' | 'title-artist' | 'title-artist-album'; // 实现

export type DownloadLyricsStyle = 'word-by-word' | 'line-by-line';

export type DownloadBehavior = 'default' | 'ask';

export interface DownloadSettings {
  downloadPath: string;
  behavior: DownloadBehavior;
  batchDownloadLimit: number;
  format: DownloadFormat;
  quality: DownloadQuality;
  downloadLyrics: boolean;
  lyricsFormat: 'lrc' | 'txt';
  lyricsStyle: DownloadLyricsStyle;
  overwriteExisting: boolean;
  keepSourceFilename: boolean;
  fileNameStyle: DownloadFileNameStyle; // 实现
  rememberDownloadPath: boolean;
  qualityFallbackBehavior: DownloadQualityFallbackBehavior;
  embedMetadata: boolean;
  embedLyrics: boolean;
  embedCover: boolean;
  mvDefaultQuality?: MvQualityKey;
}

export type DownloadQualityFallbackBehavior = 'lower' | 'higher';

export interface UploadSettings {
  playlists: boolean;
  history: boolean;
  favorites: boolean;
  plugins: boolean;
  settings: boolean; // 实现
}

export interface AutoSyncConfig { // 实现
  enabled: boolean; // 实现
  syncIntervalSeconds: number; // 实现
  maxDelayMinutes: number; // 实现
  delayedCount: number; // 实现
  lastSyncAttemptAt: number; // 实现
  lastSyncSuccessAt: number; // 实现
  nextSyncAt: number; // 实现
} // 实现
export interface ServerLoadStatus { // 实现
  rateLimited: boolean; // 实现
  activeSyncCount: number; // 实现
  busy: boolean; // 实现
  suggestedDelaySeconds: number; // 实现
  bandwidthUsagePercent: number; // 实现
} // 实现
export interface SaveArtistAvatarResponse {
  artistId: number;
  avatarPath: string;
  taskId?: string;
}

// ==================== 插件系统类型 ==================== 
export type PluginFormat = 'lx' | 'musicfree' | 'anime' | 'unknown';
export interface PluginSource { // 实现
  id: string; // 实现
  name: string; // 实现
  format: PluginFormat; // 实现
  version: string; // 实现
  author: string; // 实现
  description: string; // 实现
  filePath: string; // 实现
  importedAt: number; // 实现
  enabled: boolean; // 实现
  sources: string[]; // 实现
  isBuiltin?: boolean; // 实现
  updateAvailable?: boolean;
  sortOrder?: number; // 实现
} // 实现
export interface PluginSubscription { // 实现
  id: string; // 实现
  name: string; // 实现
  url: string; // 实现
  addedAt: number; // 实现
  lastSyncAt?: number; // 实现
  lastSyncStatus?: 'success' | 'failed' | 'partial'; // 实现
  lastSyncMessage?: string; // 实现
  lastSyncCount?: number; // 实现
} // 实现
export interface PluginHttpResponse { // 实现
  status: number; // 实现
  url: string; // 实现
  headers: Record<string, string>; // 实现
  body: string; // 实现
} // 实现
export interface PluginSearchResult { // 实现
  id: string; // 实现
  title: string; // 实现
  name?: string; // 实现
  artist: string; // 实现
  album: string; // 实现
  coverUrl: string; // 实现
  duration: number; // 实现
  platform: string; // 实现
  platformId: string; // 实现
  pluginId: string; // 实现
  rawData?: any; // 实现
} // 实现
export interface PluginMusicInfo { // 实现
  url: string; // 实现
  lyric?: string; // 实现
  tlyric?: string; // 实现
  lxlyric?: string;
  yrc?: string;
  qrc?: string;
  eslrc?: string;
  ttml?: string;
  lyricsRaw?: string;
  coverUrl?: string; // 实现
  headers?: Record<string, string>; // 实现
  actualQuality?: QualityKey;
  ekey?: string;
  cek?: string;
} // 实现
export interface PluginPlaylistSearchResult { // 实现
  id: string; // 实现
  title: string; // 实现
  coverUrl: string; // 实现
  playCount?: number; // 实现
  trackCount?: number; // 实现
  artist?: string; // 实现
  platform: string; // 实现
  platformId: string; // 实现
  pluginId: string; // 实现
  rawData?: any; // 实现
} // 实现
