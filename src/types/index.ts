export interface SongCore { // 实现
  id?: number;
  name: string; // 实现
  title?: string; // 实现
  path: string; // 实现
  artist: string; // 实现
  artist_names: string[]; // 实现
  effective_artist_names: string[]; // 实现
  album: string; // 实现
  album_artist: string; // 实现
  album_key: string; // 实现
  is_various_artists_album: boolean; // 实现
  collapse_artist_credits: boolean; // 实现
  duration: number; // 实现
  cover_thumb_path?: string; // 实现
  genre?: string; // 实现
  year?: string; // 实现
  bitrate?: number; // 实现
  sample_rate?: number; // 实现
  bit_depth?: number; // 实现
  format?: string; // 实现
  container?: string; // 实现
  codec?: string; // 实现
  file_size?: number; // 实现
  track_number?: string; // 实现
  disc_number?: string; // 实现
  added_at?: number; // 实现
  file_modified_at?: number; // 实现
  source_type?: 'local' | 'remote' | 'plugin'; // 实现
  /** 本软件内手动添加（导入歌单从源端更新时跳过删除） */
  addedInApp?: boolean;
  remote_source_id?: string; // 实现
  remote_requested_quality?: QualityKey;
  remote_fallback_behavior?: OnlineQualityFallbackBehavior;
  remote_actual_quality?: QualityKey;
  plugin_id?: string; // 实现
  cue_source_path?: string; // 实现
  cue_start_offset?: number; // 实现
  cue_end_offset?: number; // 实现
  comment?: string; // 实现
  lyrics_raw?: string;
  rawData?: any;
  remote_headers?: Record<string, string>;
  remote_ekey?: string;
  remote_cek?: string;
}

export interface Song extends SongCore {} // 实现

export type LibrarySong = Omit<Song, 'container' | 'codec' | 'file_size' | 'genre' | 'year'>; // 实现

export interface SongDetail { // 实现
  path: string; // 实现
  genre?: string; // 实现
  year?: string; // 实现
  track_number?: string; // 实现
  disc_number?: string; // 实现
  comment?: string; // 实现
  container?: string; // 实现
  codec?: string; // 实现
  file_size?: number; // 实现
}

export interface ArtistCatalogItem { // 实现
  id: number;
  name: string; // 实现
  count: number; // 实现
  firstSongPath: string; // 实现
  avatarPath: string | null; // 实现
}

export interface AlbumCatalogItem { // 实现
  key: string; // 实现
  name: string; // 实现
  count: number; // 实现
  artist: string; // 实现
  firstSongPath: string; // 实现
}

export interface RecentAlbumCatalogItem { // 实现
  key: string; // 实现
  name: string; // 实现
  artist: string; // 实现
  playedAt: number; // 实现
  firstSongPath: string; // 实现
}

export interface RecentPlaylistCatalogItem { // 实现
  id: string;
  name: string; // 实现
  count: number; // 实现
  playedAt: number; // 实现
  firstSongPath: string; // 实现
}

export interface HistoryItem { // 实现
  path: string; // 实现
  playedAt: number; // 实现
}

export interface Playlist { // 实现
  id: string;
  name: string; // 实现
  songPaths: string[]; // 实现
  createdAt?: string; // 实现
  coverPath?: string; // 实现
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

export interface LibraryFolder { // 实现
  path: string; // 实现
  song_count: number; // 实现
}

export type RemoteSourceProvider = 'webdav'; // 实现

export interface RemoteSource { // 实现
  id: string;
  name: string; // 实现
  provider: RemoteSourceProvider; // 实现
  baseUrl: string; // 实现
  username: string | null; // 实现
  rootPath: string; // 实现
  enabled: boolean; // 实现
  lastSyncAt: number | null; // 实现
  lastSyncError: string | null; // 实现
  createdAt: number; // 实现
  updatedAt: number; // 实现
}

export interface RemoteSourceInput { // 实现
  id?: string; // 实现
  name: string; // 实现
  provider: RemoteSourceProvider; // 实现
  baseUrl: string; // 实现
  username?: string | null; // 实现
  password?: string | null; // 实现
  rootPath?: string | null; // 实现
}

export interface RemoteConnectionResult { // 实现
  ok: boolean; // 实现
  message: string; // 实现
}

export interface RemoteSyncResult { // 实现
  sourceId: string; // 实现
  indexedFiles: number; // 实现
  audioFiles: number; // 实现
  parsedSongs: number; // 实现
}

export interface RemoteFileEntry { // 实现
  remotePath: string; // 实现
  name: string; // 实现
  size: number; // 实现
  etag: string | null; // 实现
  modifiedAt: string | null; // 实现
  isDir: boolean; // 实现
}

export interface RemoteCacheUsage { // 实现
  bytes: number; // 实现
  files: number; // 实现
  limitBytes: number; // 实现
}

export type RemoteSyncPhase = 'scanning' | 'parsing' | 'writing' | 'complete' | 'error'; // 实现

export interface RemoteSyncProgress { // 实现
  sourceId: string; // 实现
  phase: RemoteSyncPhase; // 实现
  current: number; // 实现
  total: number; // 实现
  message: string; // 实现
  done: boolean; // 实现
  failed: boolean; // 实现
}

export interface RemoteDownloadProgress { // 实现
  uri: string; // 实现
  downloaded: number; // 实现
  total: number | null; // 实现
  percent: number | null; // 实现
  done: boolean; // 实现
  failed: boolean; // 实现
  message: string | null; // 实现
}

export interface FolderNode { // 实现
  name: string; // 实现
  path: string; // 实现
  children: FolderNode[]; // 实现
  child_count: number; // 实现
  children_loaded: boolean; // 实现
  song_count: number; // 实现
  cover_song_path: string | null; // 实现
  is_expanded: boolean; // 实现
  is_loading?: boolean; // 实现
}

export type LibraryScanPhase = 'collecting' | 'parsing' | 'writing' | 'complete' | 'error'; // 实现
export type LibraryScanTrigger = 'bootstrap' | 'first-import' | 'manual-rescan' | 'folder-add'; // 实现
export type LibraryScanVisibility = 'silent' | 'hero' | 'inline'; // 实现

export interface LibraryScanProgress { // 实现
  phase: LibraryScanPhase; // 实现
  current: number; // 实现
  total: number; // 实现
  folder_path: string; // 实现
  folder_index: number; // 实现
  folder_total: number; // 实现
  message: string | null; // 实现
  done: boolean; // 实现
  failed: boolean; // 实现
}

export interface LibraryScanSession { // 实现
  trigger: LibraryScanTrigger; // 实现
  visibility: LibraryScanVisibility; // 实现
  startedAt: number; // 实现
  hadLibraryFoldersAtStart: boolean; // 实现
  hadSongsAtStart: boolean; // 实现
  sourcePath?: string; // 实现
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

/** 主题包 v3 每页独立壁纸（桌面端 0-1 制：opacity/maskAlpha 为比例，scale=1 原大，translate 为视口比例） */
export interface PerPageBackground {
  imagePath: string;
  blur: number;
  opacity: number;
  maskColor: string;
  maskAlpha: number;
  scale: number;
  translateX: number;
  translateY: number;
  foregroundStyle: 'light' | 'dark';
}

export interface ThemeSettings { // 实现
  mode: 'light' | 'dark' | 'custom' | 'system';
  accentColor: string; // 实现
  desktopTheme: DesktopThemeVisuals;
  playerDetailCoverBehavior: 'show' | 'hide' | 'remember'; // 实现
  lastPlayerDetailCoverVisible: boolean; // 实现
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
  dynamicBgType: 'none' | 'flow' | 'blur'; // 实现
  windowMaterial: 'none' | 'mica' | 'acrylic' | 'blur'; // 实现
  keepWindowMaterialOnBlur: boolean;
  useCustomTrayMenu: boolean;
  useGlassSwitch: boolean;
  showLeaderboard: boolean;
  flowColorBoost: number; // 实现
  flowDepth: number; // 实现
  flowSpeed: number; // 实现
  flowTexture: number; // 实现
  windowBlurTint: number; // 实现
  customBgPath: string;
  opacity: number;
  blur: number;
  customBackground: { // 实现
    imagePath: string; // 实现
    mediaType?: 'image' | 'video';
    blur: number; // 实现
    opacity: number; // 实现
    maskColor: string; // 实现
    maskAlpha: number; // 实现
    scale: number; // 实现
    foregroundStyle: 'light' | 'dark'; // 实现
    translateX?: number; // 实现
    translateY?: number; // 实现
    imageWidth?: number; // 实现
    imageHeight?: number; // 实现
  };
  /** 每页独立壁纸（主题包 v3 随包分发；pageId: main/playlist/player/local/fav/settings） */
  perPageBackgrounds: Record<string, PerPageBackground>;
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

export interface SidebarSettings { // 实现
  showLocalMusic: boolean; // 实现
  showArtists: boolean; // 实现
  showAlbums: boolean; // 实现
  showFavorites: boolean; // 实现
  showRecent: boolean; // 实现
  showFolders: boolean; // 实现
  showStatistics: boolean; // 实现
  showPlugins: boolean; // 实现
  showAccount: boolean; // 实现
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
  hidden: FooterItemKey[]; // 实现
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

export type LyricsPlayerAlignment = 'left' | 'center' | 'right'; // 实现
export type DesktopLyricsPlayerAlignment = LyricsPlayerAlignment | 'split-corners'; // 实现
export type LyricsColorScheme = 'auto' | 'default' | 'pink' | 'blue' | 'green' | 'white' | 'custom'; // 实现
export type LyricsFontPreset = string; // 实现
export type LyricsPlayerRenderMode = 'amll' | 'light'; // 实现

export interface ImportedLyricsFont { // 实现
  id: string;
  name: string; // 实现
  family: string; // 实现
  filePath: string; // 实现
  importedAt: number; // 实现
  format: 'truetype' | 'opentype'; // 实现
}

export interface LyricsSettings { // 实现
  showTranslation: boolean; // 实现
  showRomaji: boolean; // 实现
  enableWordEffect: boolean; // 实现
  playerRenderMode: LyricsPlayerRenderMode; // 实现
  playerFontScale: number; // 实现
  playerLineGap: number; // 实现
  playerOffsetX: number; // 实现
  playerOffsetY: number; // 实现
  playerAlignment: LyricsPlayerAlignment; // 实现
  playerFontPreset: LyricsFontPreset; // 实现
  playerFontSplitEnabled?: boolean;
  playerFontPresetCJK?: LyricsFontPreset;
  playerFontPresetLatin?: LyricsFontPreset;
  backgroundBlur: number; // 实现
  customBackgroundImage: string; // 实现
}

export interface DesktopLyricsSettings { // 实现
  isAlwaysOnTop: boolean; // 实现
  alwaysShowShadowBackground: boolean; // 实现
  autoHideWhenFullscreen: boolean; // 实现
  autoHideWhenPaused: boolean; // 实现
  showDoubleLine: boolean; // 实现
  enableWordEffect: boolean; // 实现
  enableTextOutline: boolean;
  textOutlineWidth: number;
  textOutlineColor: string;
  isLocked: boolean; // 实现
  persistLock: boolean; // 实现
  centerHorizontally: boolean; // 实现
  colorScheme: LyricsColorScheme; // 实现
  customPlayedColor: string; // 实现
  customUnplayedColor: string; // 实现
  customRomajiPlayedColor: string; // 实现
  customRomajiUnplayedColor: string; // 实现
  customRomajiColor: string; // 实现
  customTranslationColor: string; // 实现
  textOpacity: number; // 实现
  textShadowColor: string; // 实现
  firstLineTextShadowStrength: number; // 实现
  secondLineTextShadowStrength: number; // 实现
  playerFontScale: number; // 实现
  subFontScale: number;
  playerLineGap: number; // 实现
  playerOffsetX: number; // 实现
  playerOffsetY: number; // 实现
  playerAlignment: DesktopLyricsPlayerAlignment; // 实现
  playerFontPreset: LyricsFontPreset; // 实现
}

export type AudioOutputMode = 'shared' | 'wasapiExclusive'; // 实现

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
export interface EqualizerPreset { // 实现
  id: string;
  name: string; // 实现
  preamp: number; // 实现
  gains: number[]; // 实现
  isBuiltin: boolean; // 实现
  createdAt: number; // 实现
  updatedAt: number; // 实现
}

export interface EqualizerSettings { // 实现
  enabled: boolean; // 实现
  preamp: number; // 实现
  gains: number[]; // 实现
  currentPresetId?: string | null; // 实现
}

export interface AudioSettings { // 实现
  outputMode: AudioOutputMode; // 实现
  outputBitPerfect?: boolean;
  dsdNativePassthrough?: boolean;
  volumeBalance: { // 实现
    enabled: boolean; // 实现
    gainOffsetDb: number; // 实现
    preventClipping: boolean; // 实现
  };
  equalizer: EqualizerSettings; // 实现
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

export type ShortcutActionId = // 实现
  | 'togglePlay' // 实现
  | 'prevSong' // 实现
  | 'nextSong' // 实现
  | 'volumeUp' // 实现
  | 'volumeDown' // 实现
  | 'toggleMiniMode' // 实现
  | 'toggleFavorite' // 实现
  | 'toggleDesktopLyrics' // 实现
  | 'toggleDesktopLyricsLock'; // 实现

export interface ShortcutBinding { // 实现
  code: string; // 实现
  ctrl: boolean; // 实现
  alt: boolean; // 实现
  shift: boolean; // 实现
  meta: boolean; // 实现
}

export type ShortcutBindingMap = Record<ShortcutActionId, ShortcutBinding | null>; // 实现

export interface ShortcutSettings { // 实现
  enabled: boolean; // 实现
  globalEnabled: boolean; // 实现
  useSystemMediaKeys: boolean; // 实现
  local: ShortcutBindingMap; // 实现
  global: ShortcutBindingMap; // 实现
}

export interface PluginSettings {
  autoUpdateOnStartup: boolean;
  lazyLoad: boolean;
  skipVersionCheck: boolean;
}

export type SongClickAction = 'double' | 'single';
export type AppLanguage = 'system' | 'zh-CN' | 'zh-TW' | 'en-US';
export type PerformanceMode = 'auto' | 'full' | 'performance';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'; // 实现

export interface LogSettings { // 实现
  minimumLevel: LogLevel; // 实现
  retentionDays: number; // 实现
  autoAnalyze: boolean; // 实现
}

export interface AppSettings { // 实现
  language: AppLanguage; // 实现
  closeToTray: boolean; // 实现
  launchOnStartup: boolean;
  launchOnStartupMinimized: boolean;
  /** 已勾选「用弦予音乐打开」的音频扩展名（仅 Windows 生效）。 */
  audioFileAssociations: string[];
  preventSleepWhilePlaying: boolean; // 实现
  showDesktopLyrics: boolean; // 实现
  showQualityBadges: boolean; // 实现
  showSongComments: boolean; // 实现
  enableScrollToTopButton: boolean; // 实现
  libraryMinDurationSeconds: number; // 实现
  linkFoldersToLibrary: boolean; // 实现
  lyricsSyncOffset: number; // 实现
  organizeRoot: string; // 实现
  enableAutoOrganize: boolean; // 实现
  organizeRule: string; // 实现
  audio: AudioSettings; // 实现
  customLyricsFonts: ImportedLyricsFont[]; // 实现
  lyrics: LyricsSettings; // 实现
  desktopLyrics: DesktopLyricsSettings; // 实现
  theme: ThemeSettings; // 实现
  sidebar: SidebarSettings; // 实现
  footerLayout: FooterLayoutSettings;
  topBarLayout: TopBarLayoutSettings;
  shortcuts: ShortcutSettings; // 实现
  showTaskbarPlayer: boolean; // 实现
  taskbarPlayerCanDrag: boolean; // 实现
  gpuAcceleration: boolean; // 实现
  performanceMode: PerformanceMode;
  checkUpdateOnStartup: boolean;
  showWelcomeToastOnStartup: boolean;
  writeArtistAvatarToTags: boolean; // 实现
  download: DownloadSettings; // 实现
  upload: UploadSettings; // 实现
  plugins: PluginSettings;
  autoSync: AutoSyncConfig; // 实现
  logging: LogSettings; // 实现
  songClickAction: SongClickAction;
  shareLinkValidityMinutes: number;
  sharePlaybackFailureBehavior: 'pause' | 'replace';
  dlnaRendererEnabled: boolean;
  dlnaRendererName: string;
}

export type DownloadFormat = 'flac' | 'mp3' | 'wav' | 'aac'; // 实现
export type DownloadQuality = QualityKey; // 实现
export type DownloadFileNameStyle = 'artist-title' | 'title-artist' | 'title-artist-album'; // 实现

export type DownloadLyricsStyle = 'word-by-word' | 'line-by-line';

export type DownloadBehavior = 'default' | 'ask';

export interface DownloadSettings { // 实现
  downloadPath: string; // 实现
  behavior: DownloadBehavior;
  batchDownloadLimit: number;
  format: DownloadFormat; // 实现
  quality: DownloadQuality; // 实现
  downloadLyrics: boolean; // 实现
  lyricsFormat: 'lrc' | 'txt'; // 实现
  lyricsStyle: DownloadLyricsStyle;
  overwriteExisting: boolean; // 实现
  keepSourceFilename: boolean; // 实现
  fileNameStyle: DownloadFileNameStyle; // 实现
  rememberDownloadPath: boolean;
  qualityFallbackBehavior: DownloadQualityFallbackBehavior;
  embedMetadata: boolean;
  embedLyrics: boolean;
  embedCover: boolean;
  mvDefaultQuality?: MvQualityKey;
}

export type DownloadQualityFallbackBehavior = 'lower' | 'higher';

export interface UploadSettings { // 实现
  playlists: boolean; // 实现
  history: boolean; // 实现
  favorites: boolean; // 实现
  plugins: boolean; // 实现
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
export interface SaveArtistAvatarResponse { // 实现
  artistId: number; // 实现
  avatarPath: string; // 实现
  taskId?: string; // 实现
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
