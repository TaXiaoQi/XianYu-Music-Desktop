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
  mode: 'light' | 'dark' | 'custom';
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
export type DownloadQuality = 'lossless' | 'high' | 'standard';

export interface DownloadSettings {
  downloadPath: string;
  format: DownloadFormat;
  quality: DownloadQuality;
  downloadLyrics: boolean;
  lyricsFormat: 'lrc' | 'txt';
  overwriteExisting: boolean;
  keepSourceFilename: boolean;
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
  /** 是否有可用更新（用于在插件列表显示“可更新”标记） */
  updateAvailable?: boolean;
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

