export interface SongCore {
  id?: number;       // 数据库主键 (用于播放记录关联)
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
  // Audio quality fields (v1.1.1)
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
  remote_source_id?: string;
  plugin_id?: string;
  cue_source_path?: string;
  cue_start_offset?: number;
  cue_end_offset?: number;
  comment?: string;
  /** 原始歌词文本（在线歌曲或内嵌歌词加载时可直接解析） */
  lyrics_raw?: string;
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
  /** 完整歌曲对象（插件导入等非本地来源，用于跨设备同步） */
  songs?: Song[];
  /** 云端歌单 ID（同步后绑定，用于增量同步定位云端歌单） */
  cloudId?: number;
  /** 云端歌单封面 URL */
  cloudCoverUrl?: string;
  /** 是否为收藏歌单（"我喜欢的音乐"） */
  isFavorite?: boolean;
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

export interface ThemeSettings {
  mode: 'light' | 'dark' | 'custom' | 'system';
  dynamicBgType: 'none' | 'flow' | 'blur';
  windowMaterial: 'none' | 'mica' | 'acrylic' | 'blur';
  flowColorBoost: number;
  flowDepth: number;
  flowSpeed: number;
  flowTexture: number;
  windowBlurTint: number;
  customBgPath: string; // Legacy field, keeping for compatibility if needed, but we'll use customBackground
  opacity: number;      // Legacy field
  blur: number;         // Legacy field
  customBackground: {
    imagePath: string;
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

/** 可排序的侧边栏项标识（"首页"固定置顶，不参与排序） */
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
  /** 侧边栏项目的排列顺序 */
  order: SidebarItemKey[];
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
  enableWordEffect: boolean;
  playerRenderMode: LyricsPlayerRenderMode;
  playerFontScale: number;
  playerLineGap: number;
  playerOffsetX: number;
  playerOffsetY: number;
  playerAlignment: LyricsPlayerAlignment;
  playerFontPreset: LyricsFontPreset;
}

export interface DesktopLyricsSettings {
  isAlwaysOnTop: boolean;
  alwaysShowShadowBackground: boolean;
  autoHideWhenFullscreen: boolean;
  autoHideWhenPaused: boolean;
  showDoubleLine: boolean;
  enableWordEffect: boolean;
  enableTextOutline: boolean;
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
  playerLineGap: number;
  playerOffsetX: number;
  playerOffsetY: number;
  playerAlignment: DesktopLyricsPlayerAlignment;
  playerFontPreset: LyricsFontPreset;
}

export type AudioOutputMode = 'shared' | 'wasapiExclusive';

// ==================== 音质类型系统 ====================

/** 统一音质键值（12 档，从低到高） */
export type QualityKey =
  | 'mgg'
  | '128k'
  | '192k'
  | '320k'
  | 'flac'
  | 'flac24bit'
  | 'hires'
  | 'vinyl'
  | 'dolby'
  | 'atmos'
  | 'atmos_plus'
  | 'master';

/** 音质元信息（UI 显示 + 内部映射） */
export interface QualityMeta {
  key: QualityKey;
  label: string;            /** 中文标签 */
  description: string;      /** 比特率/格式 */
  /** 是否属于无损类（用于判断下载扩展名与无损识别） */
  isLossless: boolean;
  /** 音质排序序号，越小音质越差，用于从高到低降级时翻转 */
  rank: number;
}

/** 音质元数据表：按音质从低到高排序 */
export const QUALITY_META: Record<QualityKey, QualityMeta> = {
  mgg:         { key: 'mgg',         label: '低清',   description: '96 kbps',         isLossless: false, rank: 1  },
  '128k':      { key: '128k',      label: '普通',   description: '128 kbps',        isLossless: false, rank: 2  },
  '192k':      { key: '192k',      label: '中等',   description: '192 kbps',        isLossless: false, rank: 3  },
  '320k':      { key: '320k',      label: 'HQ',    description: '320 kbps',        isLossless: false, rank: 4  },
  flac:         { key: 'flac',         label: 'SQ',    description: 'FLAC',           isLossless: true,  rank: 5  },
  flac24bit:    { key: 'flac24bit',    label: 'Hi-Res',description: 'FLAC 24位',     isLossless: true,  rank: 6  },
  hires:        { key: 'hires',        label: '高解析度', description: '高分辨率',       isLossless: true,  rank: 7  },
  vinyl:        { key: 'vinyl',        label: '黑胶',   description: '黑胶唱片',           isLossless: true,  rank: 8  },
  dolby:        { key: 'dolby',        label: '杜比全景声', description: '杜比自然声',   isLossless: false, rank: 9  },
  atmos:        { key: 'atmos',        label: '臻品音质', description: 'Atmos 2.0',       isLossless: false, rank: 10 },
  atmos_plus: { key: 'atmos_plus', label: '臻品全景声', description: 'Atmos+ 2.0',  isLossless: false, rank: 11 },
  master:       { key: 'master',       label: '臻品母带', description: '大师3.0',       isLossless: true,  rank: 12 },
};

/** 所有 12 种音质键值列表（按 rank 升序：低→高） */
export const ALL_QUALITY_KEYS: QualityKey[] =
  (Object.keys(QUALITY_META) as QualityKey[])
    .sort((a, b) => QUALITY_META[a].rank - QUALITY_META[b].rank);

/** 所有 12 种音质键值列表（按 rank 降序：高→低） */
export const ALL_QUALITY_KEYS_DESC: QualityKey[] = [...ALL_QUALITY_KEYS].reverse();

/** 在线播放默认音质档位（对应落雪/插件引擎的音质标识） */
/** 现在使用统一的 QualityKey */
export type OnlineDefaultQuality = QualityKey;
/** 在线歌曲起播失败时的行为 */
export type OnlineFailureBehavior = 'skip' | 'stop' | 'retry';
/** 在线歌曲播放中途被中断（卡顿/出错）时的行为 */
export type OnlineInterruptBehavior = 'pause' | 'skip';

/**
 * 将 QualityKey 映射到 MusicFree 插件的 standard / high / lossless
 * MusicFree 插件标准只有这 3 档，其他档位按比特率/无损性降级映射
 *
 * 映射规则：
 *   mgg / 128k / 192k           → standard
 *   320k                         → high
 *   flac / flac24bit / hires / vinyl / dolby / atmos / atmos_plus / master  → lossless
 */
export function qualityKeyToMfQuality(q: QualityKey): 'standard' | 'high' | 'lossless' {
  const meta = QUALITY_META[q];
  if (meta.isLossless || meta.rank >= 5) return 'lossless';
  if (meta.rank >= 4) return 'high';
  return 'standard';
}

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
  volumeBalance: {
    enabled: boolean;
    gainOffsetDb: number;
    preventClipping: boolean;
  };
  equalizer: EqualizerSettings;
  showEqualizerInFooter: boolean; // 运行态必选属性
  /**
   * IDM 兼容模式：在线歌曲改为在 Worker 线程拉取完整音频后用本地 blob 播放，
   * 避免音频直链出现在主线程请求中被 IDM 等下载器劫持。
   */
  idmCompatMode: boolean;
  /** 在线播放默认音质，默认 '320k'（HQ） */
  onlineDefaultQuality: OnlineDefaultQuality;
  /** 在线歌曲起播失败时的行为，默认 'skip'（跳到下一首） */
  onlineFailureBehavior: OnlineFailureBehavior;
  /** 在线歌曲播放中途被中断时的行为，默认 'pause'（暂停等待） */
  onlineInterruptBehavior: OnlineInterruptBehavior;
}

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

export interface AppSettings {
  closeToTray: boolean;
  showDesktopLyrics: boolean;
  showQualityBadges: boolean;
  showSongComments: boolean;
  enableScrollToTopButton: boolean;
  libraryMinDurationSeconds: number;
  // Deprecated compat field. Retained only for legacy config deserialization.
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
  shortcuts: ShortcutSettings;
  showTaskbarPlayer: boolean;
  taskbarPlayerCanDrag: boolean;
  gpuAcceleration: boolean;
  writeArtistAvatarToTags: boolean;
  download: DownloadSettings;
  upload: UploadSettings;
}

export type DownloadFormat = 'flac' | 'mp3' | 'wav' | 'aac';
/** 下载默认音质（使用统一的 QualityKey 枚举，和在线播放一致） */
export type DownloadQuality = QualityKey;

/**
 * 下载文件名样式：
 *   artist-title       → 歌手 - 歌名
 *   title-artist       → 歌名 - 歌手
 *   title-artist-album → 歌名 - 歌手 - 专辑
 */
export type DownloadFileNameStyle = 'artist-title' | 'title-artist' | 'title-artist-album';

export interface DownloadSettings {
  downloadPath: string;
  format: DownloadFormat;
  quality: DownloadQuality;
  downloadLyrics: boolean;
  lyricsFormat: 'lrc' | 'txt';
  overwriteExisting: boolean;
  keepSourceFilename: boolean;
  /** 文件名样式（keepSourceFilename 为真时不生效） */
  fileNameStyle: DownloadFileNameStyle;
  rememberDownloadPath: boolean;
}

export interface UploadSettings {
  playlists: boolean;
  history: boolean;
  favorites: boolean;
  plugins: boolean;
}

export interface SaveArtistAvatarResponse {
  artistId: number;
  avatarPath: string;
  taskId?: string;
}

// ==================== 插件系统类型 ====================

/** 插件格式枚举 */
export type PluginFormat = 'lx' | 'musicfree' | 'unknown';

/** 插件条目（存储中的完整描述） */
export interface PluginSource {
  /** SHA-256 哈希作为插件 ID */
  id: string;
  /** 插件显示名称 */
  name: string;
  /** 插件格式 */
  format: PluginFormat;
  /** 插件版本 */
  version: string;
  /** 作者 */
  author: string;
  /** 描述 */
  description: string;
  /** 文件路径或 URL */
  filePath: string;
  /** 导入时间 */
  importedAt: number;
  /** 是否启用 */
  enabled: boolean;
  /** 支持的音源列表 */
  sources: string[];
  /** 是否为内置插件 */
  isBuiltin?: boolean;
  /** 是否有可用更新（用于在插件列表显示"可更新"标记） */
  updateAvailable?: boolean;
  /** 用户自定义排序权重（数值越小越靠前），同一格式组内生效 */
  sortOrder?: number;
}

/** 插件 HTTP 响应 */
export interface PluginHttpResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** MusicFree 插件搜索结果 */
export interface PluginSearchResult {
  id: string;
  title: string;
  name?: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number;
  platform: string;
  platformId: string;
  pluginId: string;
  rawData?: any;
}

/** MusicFree 插件音乐信息（含播放URL） */
export interface PluginMusicInfo {
  url: string;
  lyric?: string;
  tlyric?: string;
  coverUrl?: string;
  headers?: Record<string, string>;
}

/** MusicFree 插件歌单搜索结果 */
export interface PluginPlaylistSearchResult {
  id: string;
  title: string;
  coverUrl: string;
  playCount?: number;
  trackCount?: number;
  artist?: string;
  platform: string;
  platformId: string;
  pluginId: string;
  rawData?: any;
}

