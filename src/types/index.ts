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
  /** 预获取直链时使用的请求音质；播放时若当前设置不一致，应重新解析 */
  remote_requested_quality?: QualityKey;
  /** 预获取直链时使用的音质失败行为；播放时若当前设置不一致，应重新解析 */
  remote_fallback_behavior?: OnlineQualityFallbackBehavior;
  /** 预获取直链实际命中的音质，用于复用直链时同步底部栏显示 */
  remote_actual_quality?: QualityKey;
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
  /** 在线插件歌曲的 QMC2 加密密钥（预获取直链时保存，播放时传给后端流式解密） */
  remote_ekey?: string;
  /** 在线插件歌曲的 CENC 内容密钥（预留给后端解密链路） */
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
  accentColor: string;
  playerDetailCoverBehavior: 'show' | 'hide' | 'remember';
  lastPlayerDetailCoverVisible: boolean;
  dynamicBgType: 'none' | 'flow' | 'blur';
  windowMaterial: 'none' | 'mica' | 'acrylic' | 'blur';
  keepWindowMaterialOnBlur: boolean;
  useCustomTrayMenu: boolean;
  showLeaderboard: boolean;
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
  | 'account'
  | 'topLists';

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
  showTopLists: boolean;
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
  | 'volume'          // 音量
  | 'equalizer'       // 均衡器
  | 'playlist'        // 播放队列
  | 'comment';        // 评论区

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
  /** 用户明确关闭显示的控件，不进入底栏或更多工具菜单。 */
  hidden: FooterItemKey[];
}

/**
 * 顶部栏可配置控件标识。
 * - search（搜索框）与 settings（设置）为固定控件：始终显示、不可关闭，但可调整位置。
 * - 其余控件（back / recognize / theme / announcement / account / colorScheme）可自定义开关与位置。
 * 窗口控制（迷你窗、最小化、最大化、关闭）为固定区域，不属于自定义池。
 */
export type TopBarItemKey =
  | 'back'
  | 'search'
  | 'recognize'
  | 'theme'
  | 'announcement'
  | 'settings'
  | 'account'
  | 'colorScheme';

/** 顶部栏可自定义容器（固定区域：搜索框居中、窗口控制靠右，不参与编排） */
export type TopBarContainerKey = 'left' | 'right';

/**
 * 顶部栏布局配置。
 * - left / right：可自定义容器（搜索框固定的居中弹性区将剩余空间补齐）
 * - hidden：用户关闭显示的控件（search / settings 固定不可关闭）
 */
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
  enableWordEffect: boolean;
  playerRenderMode: LyricsPlayerRenderMode;
  playerFontScale: number;
  playerLineGap: number;
  playerOffsetX: number;
  playerOffsetY: number;
  playerAlignment: LyricsPlayerAlignment;
  playerFontPreset: LyricsFontPreset;
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
  description: string;      /** 详细音质：前端统一展示 Baka/LX 原生音质档位 */
  /** 是否属于无损类（用于判断下载扩展名与无损识别） */
  isLossless: boolean;
  /** 音质排序序号，越小音质越差，用于从高到低降级时翻转 */
  rank: number;
}

/** 音质元数据表：按音质从低到高排序 */
export const QUALITY_META: Record<QualityKey, QualityMeta> = {
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
};

/** 所有 12 种音质键值列表（按 rank 升序：低→高） */
export const ALL_QUALITY_KEYS: QualityKey[] =
  (Object.keys(QUALITY_META) as QualityKey[])
    .sort((a, b) => QUALITY_META[a].rank - QUALITY_META[b].rank);

/** 所有 12 种音质键值列表（按 rank 降序：高→低） */
export const ALL_QUALITY_KEYS_DESC: QualityKey[] = [...ALL_QUALITY_KEYS].reverse();

/** BakaMusic 原生插件音质键（对外传给插件时使用；96k 是 mgg 的插件侧名称） */
export const BAKA_PLUGIN_QUALITY_KEYS: string[] = ALL_QUALITY_KEYS.map(q => q === 'mgg' ? '96k' : q);

/** BakaMusic 新音质键 → 旧 MF 兼容音质键映射（对齐 newToLegacyQualityMap） */
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

/** 常见插件/音源别名 → 本项目统一 Baka 音质键 */
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

/** 将插件声明/接口入参里的音质字符串标准化为 Baka 12 档 QualityKey */
export function normalizeQualityKey(raw: unknown): QualityKey | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, '').replace(/-/g, '_');
  if (!normalized) return null;
  if (normalized in QUALITY_META) return normalized as QualityKey;
  return QUALITY_KEY_ALIASES[normalized] ?? null;
}

/** 将内部 QualityKey 转为 Baka 插件原生音质字符串 */
export function qualityKeyToBakaPluginQuality(q: QualityKey): string {
  return q === 'mgg' ? '96k' : q;
}

/** 将内部 QualityKey 转为 BakaMusic 旧版兼容音质键 */
export function qualityKeyToBakaLegacyQuality(q: QualityKey): 'low' | 'standard' | 'high' | 'super' {
  return BAKA_TO_LEGACY_QUALITY_MAP[q];
}

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
 * 3. 若候选列表为空且回退行为不是 pause（音源不支持首选音质且回退行为无法产出候选，如首选最高且回退为更高但音源只有更低音质），
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

  // 3. pause 表示严格不回退：首选不在可用列表时仍只尝试首选一次，
  //    失败后交给在线起播失败行为（跳过/停止）处理，避免后台反复请求其他音质。
  if (fallbackBehavior === 'pause') {
    return result.length > 0 ? result : [preferred];
  }

  // 4. 若候选为空（音源不支持首选音质且回退行为无法产出候选），回退到可用列表中的最低音质
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
  /** bit-perfect 输出：强制 WASAPI 独占 + 关闭音量/均衡器/音效 DSP，按源采样率直出 */
  outputBitPerfect?: boolean;
  /** DSD 原生 DoP 直通：仅 .dsf + WASAPI 独占时生效，关闭则走常规 PCM 解码 */
  dsdNativePassthrough?: boolean;
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
  /** 渐入渐出时长（毫秒），默认 1000ms，范围 100-2000ms */
  fadeInOutDurationMs: number;
  /** 在线播放失败时自动切换到其他落雪音源（仅 lx:// 歌曲），默认 true */
  autoSwitchSourceOnFailure: boolean;
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

export type SongClickAction = 'double' | 'single';
export type AppLanguage = 'system' | 'zh-CN' | 'zh-TW' | 'en-US';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogSettings {
  minimumLevel: LogLevel;
  retentionDays: number;
  autoAnalyze: boolean;
}

export interface AppSettings {
  language: AppLanguage;
  closeToTray: boolean;
  preventSleepWhilePlaying: boolean;
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
  topBarLayout: TopBarLayoutSettings;
  shortcuts: ShortcutSettings;
  showTaskbarPlayer: boolean;
  taskbarPlayerCanDrag: boolean;
  gpuAcceleration: boolean;
  checkUpdateOnStartup: boolean;
  writeArtistAvatarToTags: boolean;
  download: DownloadSettings;
  upload: UploadSettings;
  plugins: PluginSettings;
  autoSync: AutoSyncConfig;
  logging: LogSettings;
  songClickAction: SongClickAction;
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

/** 歌词下载样式：word-by-word 优先逐字歌词（回退逐行），line-by-line 仅逐行歌词 */
export type DownloadLyricsStyle = 'word-by-word' | 'line-by-line';

/** 底部下载按钮行为：default 使用下载设置，ask 每次打开详细弹窗 */
export type DownloadBehavior = 'default' | 'ask';

export interface DownloadSettings {
  downloadPath: string;
  /** 底部下载按钮点击行为 */
  behavior: DownloadBehavior;
  /** 批量下载同时下载数量上限，范围 1-5，默认 2 */
  batchDownloadLimit: number;
  format: DownloadFormat;
  quality: DownloadQuality;
  /** 下载独立歌词文件（.lrc/.txt），默认 true */
  downloadLyrics: boolean;
  lyricsFormat: 'lrc' | 'txt';
  /** 歌词样式：word-by-word 优先下载逐字歌词（回退到逐行），line-by-line 仅下载逐行歌词 */
  lyricsStyle: DownloadLyricsStyle;
  overwriteExisting: boolean;
  keepSourceFilename: boolean;
  /** 文件名样式（keepSourceFilename 为真时不生效） */
  fileNameStyle: DownloadFileNameStyle;
  rememberDownloadPath: boolean;
  /** 下载音质缺失时的回退行为，默认 'lower'（下载更低音质） */
  qualityFallbackBehavior: DownloadQualityFallbackBehavior;
  /** 将歌曲元数据（标题、歌手、专辑等）写入音频文件 tag（默认 true） */
  embedMetadata: boolean;
  /** 将歌词写入音频文件 tag（默认 true） */
  embedLyrics: boolean;
  /** 将封面嵌入音频文件 tag（默认 true） */
  embedCover: boolean;
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
  /** 网易云 YRC 逐字歌词，由 Baka/MF 插件提供 */
  yrc?: string;
  /** QQ 音乐 QRC 逐字歌词，由 Baka/MF 插件提供，可能为 hex 加密串 */
  qrc?: string;
  /** Baka ESLRC 增强逐字歌词 */
  eslrc?: string;
  /** Baka MP3/XML 逐字歌词（JOOX 等平台），由 Baka 插件提供 */
  ttml?: string;
  /** 构建好的歌词文本（优先使用逐字歌词），可直接赋值给 song.lyrics_raw */
  lyricsRaw?: string;
  coverUrl?: string;
  headers?: Record<string, string>;
  /** 实际获取到有效 URL 的音质（用于底部栏同步显示） */
  actualQuality?: QualityKey;
  /** QMC2 加密密钥（QQ音乐 L2 等加密音源），由 Baka 插件 getMediaSource 返回 */
  ekey?: string;
  /** CENC 内容密钥（32-hex），由 Baka 插件 getMediaSource 返回 */
  cek?: string;
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
