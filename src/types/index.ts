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
  /** 在线歌曲的原始插件搜索结果数据（用于 plugin:// 协议歌曲的后续解析） */
  rawData?: any;
  /** 在线歌曲的防盗链 headers（预获取直链时保存） */
  remote_headers?: Record<string, string>;
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
  keepWindowMaterialOnBlur: boolean;
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

/**
 * 底部栏可配置控件标识。
 * - 封面、歌名/艺人、进度条为固定核心元素，不参与排序。
 * - 上一首/播放暂停/下一首为"播放三大件"，固定在中间容器中央，不可移动。
 */
export type FooterItemKey =
  | 'download'        // 下载按钮
  | 'favorite'        // 收藏按钮
  | 'playMode'        // 播放模式
  | 'desktopLyrics'  // 桌面歌词
  | 'quality'         // 音质选择
  | 'speed'           // 倍速
  | 'volume'          // 音量
  | 'equalizer'       // 均衡器
  | 'playlist';       // 播放队列

/** 底部栏容器标识 */
export type FooterContainerKey = 'left' | 'middleLeft' | 'middleRight' | 'right';

/**
 * 底部栏布局配置。
 * - left: 左侧容器控件顺序（最多 2 个；封面与歌名/艺人固定显示）
 * - middleLeft / middleRight: 中间容器紧邻"播放三大件"左右各 1 个（null 表示留空）
 * - right: 右侧容器控件顺序（最多 5 个）
 * 未在任何容器中出现的控件会自动收入工具收纳菜单。
 */
export interface FooterLayoutSettings {
  left: FooterItemKey[];
  middleLeft: FooterItemKey | null;
  middleRight: FooterItemKey | null;
  right: FooterItemKey[];
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
export type OnlineFailureBehavior = 'skip' | 'stop';
/** 在线歌曲默认音质播放失败时的音质回退行为 */
export type OnlineQualityFallbackBehavior = 'pause' | 'lower' | 'higher';

/**
 * 根据用户首选音质、音源可用音质列表和回退行为，计算实际应尝试的音质列表（有序）。
 *
 * 逻辑：
 * 1. 首选音质在可用列表中 → 首选排第一
 * 2. 根据回退行为添加候选：
 *    - 'lower': 添加低于首选的可用音质（从高到低依次）
 *    - 'higher': 添加高于首选的可用音质（从低到高依次）
 *    - 'pause': 不添加候选
 * 3. 若候选列表为空（音源不支持首选音质且回退行为无法产出候选，如首选最高且回退为更高但音源只有更低音质），
 *    回退到可用列表中的最低音质（低音质兜底），确保始终能播放；
 *    实际命中的低音质会通过 currentPlayingQuality 同步显示至底部栏音质按钮
 *
 * @returns 有序音质列表，第一个返回有效 URL 的即采用
 */
export function resolveOnlinePlayQuality(
  preferred: QualityKey,
  available: QualityKey[] | null,
  fallbackBehavior: OnlineQualityFallbackBehavior,
): QualityKey[] {
  const avail = available && available.length > 0 ? available : [...ALL_QUALITY_KEYS];
  const availableSet = new Set(avail);
  const result: QualityKey[] = [];

  // 1. 首选音质可用时优先
  if (availableSet.has(preferred)) {
    result.push(preferred);
  }

  // 2. 根据回退行为添加候选
  const preferredIdx = ALL_QUALITY_KEYS.indexOf(preferred);
  if (preferredIdx !== -1) {
    if (fallbackBehavior === 'higher') {
      // 向上升级：从首选+1 到最高
      for (let i = preferredIdx + 1; i < ALL_QUALITY_KEYS.length; i++) {
        if (availableSet.has(ALL_QUALITY_KEYS[i])) {
          result.push(ALL_QUALITY_KEYS[i]);
        }
      }
    } else if (fallbackBehavior === 'lower') {
      // 向下降级：从首选-1 到最低
      for (let i = preferredIdx - 1; i >= 0; i--) {
        if (availableSet.has(ALL_QUALITY_KEYS[i])) {
          result.push(ALL_QUALITY_KEYS[i]);
        }
      }
    }
    // 'pause': 不添加回退候选
  }

  // 3. 若候选为空（音源不支持首选音质且回退行为无法产出候选），回退到可用列表中的最低音质
  //    （低音质兜底），实际命中音质会通过 currentPlayingQuality 同步显示至底部栏
  if (result.length === 0 && avail.length > 0) {
    const lowest = [...avail].sort((a, b) => QUALITY_META[a].rank - QUALITY_META[b].rank)[0];
    result.push(lowest);
  }

  return result;
}

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
  /** 在线播放默认音质，默认 '320k'（HQ） */
  onlineDefaultQuality: OnlineDefaultQuality;
  /** 在线歌曲起播失败时的行为，默认 'skip'（跳到下一首） */
  onlineFailureBehavior: OnlineFailureBehavior;
  /** 在线歌曲默认音质播放失败时的音质回退行为，默认 'lower'（播放更低音质） */
  onlineQualityFallbackBehavior: OnlineQualityFallbackBehavior;
  /** 在线流式播放缓存上限（MB），默认 512MB */
  streamCacheSizeMB: number;
  /** 播放/暂停渐入渐出（淡入淡出）开关，默认关闭 */
  fadeInOutEnabled: boolean;
  /** 渐入渐出时长（毫秒），默认 300ms */
  fadeInOutDurationMs: number;
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

export interface PluginSettings {
  autoUpdateOnStartup: boolean;
  lazyLoad: boolean;
  skipVersionCheck: boolean;
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
  footerLayout: FooterLayoutSettings;
  shortcuts: ShortcutSettings;
  showTaskbarPlayer: boolean;
  taskbarPlayerCanDrag: boolean;
  gpuAcceleration: boolean;
  writeArtistAvatarToTags: boolean;
  download: DownloadSettings;
  upload: UploadSettings;
  plugins: PluginSettings;
  autoSync: AutoSyncConfig;
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
  /** 下载音质缺失时的回退行为，默认 'lower'（下载更低音质） */
  qualityFallbackBehavior: DownloadQualityFallbackBehavior;
}

/** 下载音质缺失行为 */
export type DownloadQualityFallbackBehavior = 'lower' | 'higher';

export interface UploadSettings {
  playlists: boolean;
  history: boolean;
  favorites: boolean;
  plugins: boolean;
  settings: boolean;
}

/** 自动同步配置 */
export interface AutoSyncConfig {
  /** 是否启用自动同步 */
  enabled: boolean;
  /** 同步间隔（秒），0 表示使用最小间隔 */
  syncIntervalSeconds: number;
  /** 当服务器繁忙时自动延后的最大延迟（分钟） */
  maxDelayMinutes: number;
  /** 已延后的同步次数 */
  delayedCount: number;
  /** 最后一次同步尝试的时间戳 */
  lastSyncAttemptAt: number;
  /** 最后一次成功同步的时间戳 */
  lastSyncSuccessAt: number;
  /** 下一次计划同步的时间戳 */
  nextSyncAt: number;
}

export interface ServerLoadStatus {
  /** 是否启用流量限制 */
  rateLimited: boolean;
  /** 当前并发同步用户数 */
  activeSyncCount: number;
  /** 服务器是否繁忙（带宽或负载过高） */
  busy: boolean;
  /** 建议的延迟时间（秒） */
  suggestedDelaySeconds: number;
  /** 带宽利用率（百分比） */
  bandwidthUsagePercent: number;
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

/** 插件订阅源（参考 MusicFreeDesktop 订阅管理设计） */
export interface PluginSubscription {
  /** 唯一 ID（sub_<时间戳>_<随机>） */
  id: string;
  /** 订阅名称（用户可编辑） */
  name: string;
  /** 订阅源 URL（必须以 .js 或 .json 结尾） */
  url: string;
  /** 添加时间戳 */
  addedAt: number;
  /** 上次同步时间戳 */
  lastSyncAt?: number;
  /** 上次同步状态 */
  lastSyncStatus?: 'success' | 'failed' | 'partial';
  /** 上次同步消息 */
  lastSyncMessage?: string;
  /** 上次同步成功安装的插件数 */
  lastSyncCount?: number;
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
  /** 逐字歌词（lx-music-desktop 格式），由 Toskysun 系列插件提供 */
  lxlyric?: string;
  /** 构建好的歌词文本（优先使用逐字歌词），可直接赋值给 song.lyrics_raw */
  lyricsRaw?: string;
  coverUrl?: string;
  headers?: Record<string, string>;
  /** 实际获取到有效 URL 的音质（用于底部栏同步显示） */
  actualQuality?: QualityKey;
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

