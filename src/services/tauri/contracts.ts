import type {
  AlbumCatalogItem,
  ArtistCatalogItem,
  FolderNode,
  LibraryFolder,
  LibrarySong,
  RecentAlbumCatalogItem,
  RecentPlaylistCatalogItem,
  Playlist,
  RemoteConnectionResult,
  RemoteCacheUsage,
  RemoteFileEntry,
  RemoteSource,
  RemoteSourceInput,
  RemoteSyncResult,
  Song,
  SongDetail,
  SaveArtistAvatarResponse,
  ImportedLyricsFont,
} from '../../types';
import type { AudioOutputMode } from '../../types';
import type { LyricsPayload } from '../../composables/lyrics/types';

export interface AudioDevice {
  id: string;
  name: string;
}

export interface AudioDeviceFormat {
  sample_format: string;
  min_sample_rate: number;
  max_sample_rate: number;
  channels: number;
}

export interface AudioDeviceFormats {
  id: string;
  name: string;
  formats: AudioDeviceFormat[];
}

export interface AudioOutputStatus {
  selected_device_id: string | null;
  active_device_name: string | null;
  follows_system_default: boolean;
  requested_output_mode: AudioOutputMode;
  active_output_mode: AudioOutputMode;
  fallback_reason: string | null;
}

interface MovedMusicFilePath {
  old_path: string;
  new_path: string;
}

interface BatchMoveMusicFilesResult {
  moved_paths: MovedMusicFilePath[];
}

export type LyricsStorageSource = 'embedded' | 'sidecar' | 'empty';

interface SongLyricsForEdit {
  lyrics: string;
  source: LyricsStorageSource;
  sourcePath: string | null;
}

interface SongInfoEditPayload {
  title: string;
  artist: string;
  album: string;
  trackNumber: string | null;
  discNumber: string | null;
  year: string | null;
  coverPath: string | null;
}

interface SaveSongInfoResponse {
  song: Song;
  detail: SongDetail;
}

export interface RecentHistoryRecord {
  songPath: string;
  playedAt: number;
}

export interface RecentHistoryImportRecord {
  songPath: string;
  playedAt: number;
}

export interface StatisticsExportResult {
  filePath: string;
  exportId: string;
  exportedAt: string;
}

export interface StatisticsImportPreview {
  version: number;
  exportedAt: string;
  appVersion: string;
  exportId: string;
  songStatsCount: number;
  dailyStatsCount: number;
  recentPlaysCount: number;
  matchedSongCount: number;
  unmatchedSongCount: number;
  duplicateImportDetected: boolean;
}

export interface StatisticsImportResult {
  mode: 'overwrite' | 'merge';
  matchedSongCount: number;
  unmatchedSongCount: number;
  mergedSongCount: number;
  importedRecentPlaysCount: number;
  duplicateImportSkipped: boolean;
}

export interface LoudnessRecord {
  songId: number;
  songPath: string;
  loudnessLufs: number | null;
  estimatedLoudnessLufs: number | null;
  samplePeak: number | null;
  truePeak: number | null;
  tagTrackGainDb: number | null;
  tagTrackPeak: number | null;
  tagAlbumGainDb: number | null;
  tagAlbumPeak: number | null;
  tagR128TrackGainDb: number | null;
  tagR128AlbumGainDb: number | null;
  fileSize: number;
  fileModifiedAt: number;
  scanSource: string;
  analyzerName: string | null;
  analyzerVersion: number;
  scanStatus: string;
  scannedAt: number | null;
  errorMessage: string | null;
}

export interface PlayAudioOptions {
  path: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
  outputMode: AudioOutputMode;
  startOffsetMs?: number;
  songId?: number | null;
  volumeBalanceEnabled?: boolean | null;
  gainOffsetDb?: number | null;
  preventClipping?: boolean | null;
  /** 插件返回的自定义请求头（防盗链 Cookie/Referer 等），仅对 http(s) 直链生效 */
  headers?: Record<string, string> | null;
  /** QMC2 加密密钥（Baka 插件加密音源，如 QQ 音乐 L2），由 Rust 后端流式解密 */
  ekey?: string;
  /** CENC 内容密钥（Baka 插件可能返回，如酷狗加密音源），透传给 Rust 后端 */
  cek?: string;
  /** DSD 原生 DoP 直通：仅 .dsf + WASAPI 独占时生效（关闭则走常规 PCM 解码） */
  dsdNativePassthrough?: boolean;
}

export interface UpdateLoudnessSettingsOptions {
  enabled: boolean;
  songId?: number | null;
  songPath?: string | null;
  gainOffsetDb: number;
  preventClipping: boolean;
}

export interface UpdatePlaybackMetadataOptions {
  title: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
  isPlaying: boolean;
}

export interface SeekAudioOptions {
  time: number;
  isPlaying: boolean;
  requestId: number;
}

// ===== 音效参数（与 Rust src-tauri/src/player/sound_effect.rs 的 SoundEffectSettings 一一对应）=====
// 字段单位与 UI 滑块一致（百分比 / dB / Hz / ms），Rust DSP 在各 Source 内部做单位换算。
// 所有字段均可省略（Rust 侧 #[serde(default)]），便于跨版本前向兼容与增量更新。

export type ReverbKind = 'none' | 'algorithmic' | 'convolution';
export type SpatialMode = 'none' | 'surround3d' | 'd8' | 'd36' | 'virtual';
type DistortionType = 'soft' | 'hard';
type DelayType = 'single' | 'pingpong';
type VirtualSurroundMode = '5.1' | '7.1';

interface ModulationParams {
  enabled: boolean;
  rate: number;
  depth: number;
}
interface FlangerParams {
  enabled: boolean;
  rate: number;
  depth: number;
  feedback: number;
  mix: number;
}
interface PhaserParams {
  enabled: boolean;
  rate: number;
  depth: number;
  feedback: number;
  mix: number;
}
interface DelayParams {
  enabled: boolean;
  timeMs: number;
  feedback: number;
  mix: number;
  delayType: DelayType;
}
interface CompressorParams {
  enabled: boolean;
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
}
interface MultibandParams {
  enabled: boolean;
  lowFreq: number;
  midFreq: number;
  threshold: number;
  ratio: number;
}
interface LimiterParams {
  enabled: boolean;
  threshold: number;
}
interface NoiseGateParams {
  enabled: boolean;
  threshold: number;
  attack: number;
  release: number;
}
interface ExpanderParams {
  enabled: boolean;
  threshold: number;
  ratio: number;
}
interface AgcParams {
  enabled: boolean;
  targetLevel: number;
}
interface DeEsserParams {
  enabled: boolean;
  threshold: number;
  frequency: number;
}
interface DistortionParams {
  enabled: boolean;
  amount: number;
  distortionType: DistortionType;
}
interface ExciterParams {
  enabled: boolean;
  amount: number;
  frequency: number;
}
interface SubBassParams {
  enabled: boolean;
  amount: number;
  frequency: number;
}
interface LoFiParams {
  enabled: boolean;
  sampleRate: number;
  bitDepth: number;
  noise: number;
}
interface BitcrushParams {
  enabled: boolean;
  bits: number;
}
interface StereoWidenParams {
  enabled: boolean;
  amount: number;
}
interface StereoSepParams {
  enabled: boolean;
  width: number;
  centerLevel: number;
}
interface CrossfeedParams {
  enabled: boolean;
  strength: number;
}
interface BassBoostParams {
  enabled: boolean;
  gain: number;
  dynamic: boolean;
}
interface DynamicEqParams {
  enabled: boolean;
}

export interface SoundEffectSettings {
  // 变调/变速
  pitchShift: number; // 50-200 (百分比，100=原调)
  playbackRate: number; // 50-200 (百分比，100=原速)
  preservesPitch: boolean;
  // 混响
  reverbKind: ReverbKind;
  reverbPreset: string;
  reverbDry: number; // 干信号增益
  reverbWet: number; // 湿信号增益
  // 空间
  spatialMode: SpatialMode;
  spatialSpeed: number; // 秒/圈
  spatialRadius: number; // 虚拟距离
  spatialIntensity: number; // 环绕强度
  virtualSurroundMode: VirtualSurroundMode;
  virtualSurroundSpread: number; // 1-20
  // 调制
  vibrato: ModulationParams;
  pitchDrift: ModulationParams;
  tremolo: ModulationParams;
  flanger: FlangerParams;
  phaser: PhaserParams;
  delay: DelayParams;
  // 动态
  compressor: CompressorParams;
  multiband: MultibandParams;
  limiter: LimiterParams;
  noiseGate: NoiseGateParams;
  expander: ExpanderParams;
  agc: AgcParams;
  deEsser: DeEsserParams;
  // 波形整形
  distortion: DistortionParams;
  exciter: ExciterParams;
  subBass: SubBassParams;
  loFi: LoFiParams;
  bitcrush: BitcrushParams;
  // 声道处理
  vocalRemoval: boolean;
  stereoWiden: StereoWidenParams;
  monoMerge: boolean;
  channelSwap: boolean;
  stereoSeparation: StereoSepParams;
  crossfeed: CrossfeedParams;
  bassBoost: BassBoostParams;
  dynamicEq: DynamicEqParams;
  // 组合
  v4aEnabled: boolean;
  bypass: boolean;
  audioBoost: number; // 0-100
}

export interface WindowMaterialCapabilities {
  isWindows: boolean;
  supportsAcrylic: boolean;
  supportsMica: boolean;
  supportsBlur: boolean;
  systemTransparencyEnabled: boolean | null;
  windowsBuildNumber: number | null;
}

export interface ForegroundFullscreenState {
  isFullscreen: boolean;
}

/** 任务栏托盘几何信息（Rust 无 rename_all → snake_case） */
export interface TaskbarTrayGeometry {
  taskbar_rect_physical: RectPhysical;
  tray_rect_physical: RectPhysical | null;
  taskbar_hwnd_changed: boolean;
  owner_binding: OwnerBindingState;
  source: GeometrySource;
  scale_factor: number;
}

export interface RectPhysical {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type OwnerBindingState = 'bound' | 'failed' | 'unsupported' | 'already_bound';
export type GeometrySource = 'tray' | 'taskbar_fallback';

/** 原生托盘菜单状态（Rust camelCase） */
export interface NativeTrayMenuState {
  currentSong?: NativeTrayMenuSong | null;
  isPlaying: boolean;
  playMode: number;
  showDesktopLyrics: boolean;
  isFavorite: boolean;
  isMiniMode: boolean;
  useCustomTrayMenu: boolean;
}

export interface NativeTrayMenuSong {
  title?: string | null;
  name?: string | null;
  artist?: string | null;
}

/** 曲库统计（Rust 无 rename_all → snake_case） */
export interface LibraryStats {
  total_songs: number;
  total_duration: number;
  total_file_size: number;
  album_count: number;
  artist_count: number;
  lossless_count: number;
  hires_count: number;
  this_month_added: number;
}

/** 行为统计时间范围（Rust tag="type" 内部标签枚举，变体名原样） */
export type TimeRange =
  | { type: 'All' }
  | { type: 'Days7' }
  | { type: 'Days30' }
  | { type: 'ThisYear' };

export interface BehaviorStats {
  total_plays: number;
  total_duration: number;
  top_songs: TopSong[];
  top_songs_by_duration: TopSong[];
  top_artists: TopArtist[];
  top_albums: TopAlbum[];
  hour_distribution: number[];
  recent_activity: number[];
}

/** 听歌时长（按周期），用于排行榜分周期上报 */
export interface ListenDurations {
  /** 今日听歌时长（秒） */
  daily: number;
  /** 最近 7 天听歌时长（秒） */
  weekly: number;
  /** 累计听歌时长（秒） */
  total: number;
}

export interface TopSong {
  song_path: string;
  play_count: number;
  value: number;
}

export interface TopArtist {
  artist: string;
  play_count: number;
}

export interface TopAlbum {
  album: string;
  play_count: number;
}

export interface QualityDistribution {
  hires: number;
  super_quality: number;
  high_quality: number;
  other: number;
}

export interface FormatDistribution {
  flac: number;
  mp3: number;
  alac: number;
  wav: number;
  aiff: number;
  aac: number;
  ogg: number;
  other: number;
}

/** 扫描文件夹生成的播放列表（Rust 无 rename_all → snake_case） */
export interface GeneratedFolder {
  name: string;
  path: string;
  songs: Song[];
}

/** 重命名工具配置（Rust 无 rename_all → snake_case） */
export interface RenameConfig {
  mode: string;
  template: string;
  remove_track_prefix: boolean;
  remove_source_prefix: boolean;
}

export interface RenamePreview {
  original_path: string;
  original_name: string;
  new_name: string;
  status: string;
  error: string | null;
}

export interface RenameOperation {
  original_path: string;
  new_name: string;
}

export interface TauriCommandMap {
  add_library_folder: { payload: { path: string }; response: void };
  remove_library_folder: { payload: { path: string }; response: void };
  get_library_hierarchy: { payload: undefined; response: FolderNode[] };
  get_library_artist_catalog: { payload: undefined; response: ArtistCatalogItem[] };
  save_artist_avatar: { payload: { artistId: number; imagePath: string; writeToTags: boolean }; response: SaveArtistAvatarResponse };
  get_library_album_catalog: { payload: undefined; response: AlbumCatalogItem[] };
  get_library_song_paths_by_artist: { payload: { artistName: string }; response: string[] };
  get_library_song_paths_by_album: { payload: { albumKey: string }; response: string[] };
  get_library_song_paths_for_all_view: {
    payload: {
      query?: string;
      artistFilter?: string;
      albumFilter?: string;
      sortMode: 'title' | 'artist' | 'added_at' | 'added_at_asc' | 'file_modified_at' | 'file_modified_at_asc';
    };
    response: string[];
  };
  get_library_song_paths_for_folder_view: {
    payload: {
      folderPath: string;
      query?: string;
      sortMode: 'title' | 'name' | 'artist' | 'added_at' | 'added_at_asc' | 'track_number';
    };
    response: string[];
  };
  get_folder_children: { payload: { folderPath: string }; response: FolderNode[] };
  get_library_folders: { payload: undefined; response: LibraryFolder[] };
  get_library_songs_by_paths: { payload: { paths: string[] }; response: LibrarySong[] };
  search_library_songs: { payload: { query: string; limit?: number }; response: LibrarySong[] };
  get_remote_sources: { payload: undefined; response: RemoteSource[] };
  test_remote_source: { payload: { source: RemoteSourceInput }; response: RemoteConnectionResult };
  add_remote_source: { payload: { source: RemoteSourceInput }; response: RemoteSource };
  update_remote_source: { payload: { source: RemoteSourceInput }; response: RemoteSource };
  remove_remote_source: { payload: { sourceId: string }; response: void };
  sync_remote_source: { payload: { sourceId: string }; response: RemoteSyncResult };
  precache_remote_song: { payload: { remoteUri: string }; response: void };
  get_remote_cache_usage: { payload: undefined; response: RemoteCacheUsage };
  clear_remote_cache: { payload: undefined; response: RemoteCacheUsage };
  list_remote_directory: { payload: { sourceId: string; path: string }; response: RemoteFileEntry[] };
  create_folder: { payload: { parentPath: string; folderName: string }; response: string };
  refresh_folder_songs: {
    payload: { folderPath: string; minimumDurationSeconds?: number };
    response: void;
  };
  delete_folder: { payload: { path: string }; response: void };
  move_file_to_folder: {
    payload: { sourcePath: string; targetFolder: string };
    response: void;
  };
  batch_move_music_files: {
    payload: { paths: string[]; targetFolder: string };
    response: BatchMoveMusicFilesResult;
  };
  get_folder_first_song: {
    payload: { folderPath: string };
    response: string | null;
  };
  scan_music_folder: {
    payload: { folderPath: string; minimumDurationSeconds?: number };
    response: Song[];
  };
  move_music_file: { payload: { oldPath: string; newPath: string }; response: void };
  show_in_folder: { payload: { path: string }; response: void };
  delete_music_file: { payload: { path: string }; response: void };
  is_directory: { payload: { path: string }; response: boolean };
  parse_audio_files: {
    payload: { paths: string[]; minimumDurationSeconds?: number };
    response: Song[];
  };
  parse_music_folder: {
    payload: { folderPath: string; minimumDurationSeconds?: number };
    response: Song[];
  };
  set_volume: { payload: { volume: number }; response: void };
  set_playback_speed: { payload: { speed: number }; response: void };
  get_playback_progress: { payload: undefined; response: number };
  get_playback_duration: { payload: undefined; response: number };
  get_playback_ready: { payload: undefined; response: boolean };
  get_playback_start_failed: { payload: undefined; response: boolean };
  get_playback_start_failed_reason: { payload: undefined; response: string | null };
  get_playback_start_failed_info: {
    payload: undefined;
    response: { failed: boolean; reason: string | null };
  };
  get_audio_visualizer_samples: { payload: undefined; response: number[] };
  record_play: {
    payload: {
      payload: {
        songPath: string;
        listenedMs: number;
        durationMs: number;
        title: string;
        artist: string;
        album: string;
        trackNumber?: string;
        countAsPlay: boolean;
      };
    };
    response: void;
  };
  get_song_cover_thumbnail: { payload: { path: string }; response: string };
  get_song_cover: { payload: { path: string }; response: string };
  extract_palette: {
    payload: { source: string; count: number; colorBoost: number; depth: number };
    response: string[];
  };
  authed_request: {
    payload: { action: string; body: Record<string, unknown>; fetchTimeoutMs?: number };
    response: { code: number; msg: string; data: unknown };
  };
  signed_post_json: {
    payload: { url: string; body: Record<string, unknown>; fetchTimeoutMs?: number };
    response: { code: number; msg: string; data: unknown };
  };
  save_auth_credentials: {
    payload: { token: string; user: unknown };
    response: void;
  };
  get_auth_credentials: {
    payload: undefined;
    response: { token: string; user: unknown } | null;
  };
  clear_auth_credentials: { payload: undefined; response: void };
  set_auth_base_url: { payload: { baseUrl: string }; response: void };
  get_auth_base_url: { payload: undefined; response: string };
  set_auth_api_secret: { payload: { apiSecret: string }; response: void };
  get_auth_api_secret: { payload: undefined; response: string };
  clear_cover_cache: { payload: undefined; response: void };
  get_song_lyrics: { payload: { path: string }; response: string };
  read_lyrics_file: { payload: { path: string }; response: string };
  get_song_lyrics_for_edit: { payload: { path: string }; response: SongLyricsForEdit };
  save_song_lyrics: {
    payload: {
      path: string;
      lyrics: string;
      source: LyricsStorageSource;
      sourcePath: string | null;
    };
    response: SongLyricsForEdit;
  };
  save_song_info: {
    payload: {
      path: string;
      payload: SongInfoEditPayload;
    };
    response: SaveSongInfoResponse;
  };
  get_song_detail: { payload: { path: string }; response: SongDetail };
  play_audio: { payload: PlayAudioOptions; response: void };
  update_playback_metadata: { payload: UpdatePlaybackMetadataOptions; response: void };
  pause_audio: { payload: undefined; response: void };
  stop_audio: { payload: undefined; response: void };
  resume_audio: { payload: undefined; response: void };
  seek_audio: { payload: SeekAudioOptions; response: void };
  set_audio_output_mode: { payload: { outputMode: AudioOutputMode }; response: void };
  set_output_device: { payload: { deviceId: string | null }; response: void };
  set_prevent_sleep: { payload: { active: boolean }; response: void };
  get_output_devices: { payload: undefined; response: AudioDevice[] };
  get_current_output_device: { payload: undefined; response: AudioOutputStatus };
  get_audio_device_formats: { payload: undefined; response: AudioDeviceFormats[] };
  add_to_history: { payload: { songPath: string }; response: void };
  remove_from_recent_history: { payload: { songPaths: string[] }; response: void };
  remove_songs_from_history_and_statistics: { payload: { songPaths: string[] }; response: void };
  clear_recent_history: { payload: undefined; response: void };
  get_recent_history: { payload: { limit: number }; response: RecentHistoryRecord[] };
  get_favorite_artist_catalog: { payload: { favoritePaths: string[] }; response: ArtistCatalogItem[] };
  get_favorite_album_catalog: { payload: { favoritePaths: string[] }; response: AlbumCatalogItem[] };
  get_favorite_song_paths_view: {
    payload: {
      favoritePaths: string[];
      query?: string;
      sortMode: 'title' | 'artist' | 'added_at' | 'added_at_asc' | 'file_modified_at' | 'file_modified_at_asc';
      detailFilterType?: 'artist' | 'album';
      detailFilterValue?: string;
    };
    response: string[];
  };
  get_recent_album_catalog: {
    payload: { recentEntries: RecentHistoryImportRecord[] };
    response: RecentAlbumCatalogItem[];
  };
  get_recent_song_paths_view: {
    payload: {
      recentEntries: RecentHistoryImportRecord[];
      query?: string;
      sortMode: 'title' | 'artist' | 'added_at' | 'added_at_asc' | 'file_modified_at' | 'file_modified_at_asc';
    };
    response: string[];
  };
  get_recent_playlist_catalog: {
    payload: {
      playlists: Playlist[];
      recentEntries: RecentHistoryImportRecord[];
    };
    response: RecentPlaylistCatalogItem[];
  };
  import_recent_history: {
    payload: { entries: RecentHistoryImportRecord[] };
    response: void;
  };
  export_statistics_file: {
    payload: {
      options: {
        filePath: string;
        includeRecentPlays: boolean;
      };
    };
    response: StatisticsExportResult;
  };
  preview_statistics_import: {
    payload: {
      options: {
        filePath: string;
      };
    };
    response: StatisticsImportPreview;
  };
  import_statistics_file: {
    payload: {
      options: {
        filePath: string;
        mode: 'overwrite' | 'merge';
        continueDuplicateImport: boolean;
      };
    };
    response: StatisticsImportResult;
  };
  set_mini_boundary_enabled: { payload: { enabled: boolean }; response: void };
  set_immersive_fullscreen: { payload: { enter: boolean }; response: boolean };
  refresh_immersive_fullscreen: { payload: undefined; response: boolean };
  save_window_placement: { payload: undefined; response: boolean };
  set_taskbar_fullscreen_flag: { payload: { enter: boolean }; response: boolean };
  smart_toggle_maximize: { payload: undefined; response: boolean };
  set_dark_mode_for_window: { payload: { dark: boolean }; response: void };
  get_window_material_capabilities: {
    payload: undefined;
    response: WindowMaterialCapabilities;
  };
  refresh_window_material_active_state: {
    payload: { keepActive: boolean };
    response: void;
  };
  get_foreground_fullscreen_state: {
    payload: undefined;
    response: ForegroundFullscreenState;
  };
  refresh_current_window_topmost: {
    payload: { enabled: boolean };
    response: void;
  };
  refresh_taskbar_window_topmost: { payload: undefined; response: boolean };
  start_topmost_guard: { payload: undefined; response: void };
  stop_topmost_guard: { payload: undefined; response: void };
  clear_all_app_data: { payload: undefined; response: void };
  open_external_program: {
    payload: { path: string; args: string[] };
    response: void;
  };
  consume_pending_open_paths: { payload: undefined; response: string[] };
  save_download_lyrics: {
    payload: { content: string; destPath: string };
    response: string;
  };
  get_track_loudness_info: {
    payload: { songId: number };
    response: LoudnessRecord | null;
  };
  update_loudness_settings: {
    payload: UpdateLoudnessSettingsOptions;
    response: void;
  };
  set_equalizer_settings: {
    payload: { enabled: boolean; preamp: number; gains: number[] };
    response: void;
  };
  set_sound_effect_settings: {
    payload: { settings: SoundEffectSettings };
    response: void;
  };
  set_stream_cache_max_size: {
    payload: { bytes: number };
    response: void;
  };
  get_stream_cache_info: {
    payload: undefined;
    response: { current: number; max: number };
  };
  clear_stream_cache: {
    payload: undefined;
    response: void;
  };
  file_exists: {
    payload: { path: string };
    response: boolean;
  };
  resolve_download_path: {
    payload: { directory: string; fileName: string; overwriteExisting: boolean };
    response: string;
  };
  resolve_download_full_path: {
    payload: {
      directory: string;
      title: string;
      artist: string;
      album: string;
      url: string;
      quality: string;
      keepSourceFilename: boolean;
      fileNameStyle: string;
      overwriteExisting: boolean;
    };
    response: string;
  };
  build_download_basename: {
    payload: { title: string; artist: string; album: string; fileNameStyle: string };
    response: string;
  };
  download_online_song: {
    payload: { url: string; destPath: string; ekey: string | null; headers: Record<string, string> | null };
    response: string;
  };
  decrypt_qmc_file: {
    payload: { filePath: string; ekey: string | null };
    response: boolean;
  };
  finalize_download_extras: {
    payload: { request: FinalizeDownloadExtrasRequestContract };
    response: FinalizeDownloadExtrasResultContract;
  };
  probe_url_size: {
    payload: { url: string };
    response: ProbeUrlInfoContract;
  };
  read_download_history: {
    payload: undefined;
    response: string;
  };
  write_download_history: {
    payload: { content: string };
    response: void;
  };
  is_stream_cached: {
    payload: { url: string };
    response: boolean;
  };
  copy_stream_cache: {
    payload: { url: string; destPath: string };
    response: number;
  };
  save_download_bytes: {
    payload: { data: number[]; destPath: string };
    response: string;
  };
  fetch_image_bytes: {
    payload: { url: string };
    response: { data: number[]; mime: string };
  };
  // ===== 插件基础设施命令 =====
  plugin_http_request: {
    payload: {
      method: string;
      url: string;
      headers?: Record<string, string> | null;
      body?: string | null;
      timeout?: number | null;
      follow?: number | null;
    };
    response: PluginHttpResponseContract;
  };
  plugin_http_request_binary: {
    payload: {
      method: string;
      url: string;
      headers?: Record<string, string> | null;
      body?: string | null;
      timeout?: number | null;
      follow?: number | null;
    };
    response: PluginHttpBinaryResponseContract;
  };
  read_plugin_file: {
    payload: { path: string };
    response: string;
  };
  save_plugin_script: {
    payload: { id: string; script: string };
    response: string;
  };
  read_file_bytes: {
    payload: { path: string };
    response: string;
  };
  proxy_image: {
    payload: { url: string; referer?: string | null };
    response: string;
  };
  download_audio_to_temp: {
    payload: { url: string; headers?: Record<string, string> | null };
    response: string;
  };
  write_state_json: {
    payload: { key: string; value: string };
    response: void;
  };
  read_state_json: {
    payload: { key: string };
    response: string | null;
  };
  open_devtools: {
    payload: undefined;
    response: null;
  };
  fetch_lyric_from_source: {
    payload: { source: string; songInfo: LyricSongInfoContract };
    response: LyricResultContract | null;
  };
  resolve_lx_music_url: {
    payload: { songInfo: LxUrlSongInfoContract; quality: string };
    response: ResolvedUrlContract | null;
  };
  get_lx_cover: {
    payload: { songInfo: LxUrlSongInfoContract };
    response: string | null;
  };
  clear_lx_url_cache: { payload: undefined; response: void };
  find_alternative_lx_source: {
    payload: {
      songName: string;
      songArtist: string;
      songDuration: number;
      failedSources: string[];
      qualities: string[];
    };
    response: AlternativeSourceResultContract | null;
  };
  resolve_lx_with_quality_fallback: {
    payload: { songInfo: LxUrlSongInfoContract; qualities: string[] };
    response: ResolvedUrlContract | null;
  };
  clear_lx_all_cache: { payload: undefined; response: void };
  save_playback_session: {
    payload: { session: PlaybackSessionDataContract };
    response: void;
  };
  load_playback_session: {
    payload: undefined;
    response: PlaybackSessionDataContract;
  };
  get_playback_session: {
    payload: undefined;
    response: PlaybackSessionDataContract;
  };
  update_playback_position: {
    payload: { positionSecs: number; isPlaying: boolean };
    response: void;
  };
  flush_playback_session: { payload: undefined; response: void };
  recognize_system_audio: { payload: undefined; response: RecognizeResponseContract };
  recognize_with_pcm: { payload: { pcm: number[] }; response: RecognizeResponseContract };
  cancel_recognize_system_audio: { payload: undefined; response: void };
  save_song_background: {
    payload: { songPath: string; backgroundPath: string };
    response: string;
  };
  get_song_background: {
    payload: { songPath: string };
    response: string | null;
  };
  clear_song_background: {
    payload: { songPath: string };
    response: void;
  };
  // ============ 更新检查 ============
  check_update_by_rust: { payload: { owner: string; repo: string }; response: string };
  download_update_file: { payload: { url: string }; response: string };
  run_installer: { payload: { path: string }; response: void };
  // ============ 应用生命周期 ============
  exit_app: { payload: undefined; response: void };
  // ============ 安装语言 ============
  get_install_language: { payload: undefined; response: string | null };
  set_install_language: { payload: { language: string }; response: boolean };
  // ============ 歌词字体 ============
  read_lyrics_font_data_url: { payload: { fontPath: string }; response: string };
  import_lyrics_font: { payload: { sourcePath: string }; response: ImportedLyricsFont };
  get_system_fonts: { payload: undefined; response: string[] };
  // ============ 歌词解析 ============
  parse_lyrics_text: { payload: { text: string }; response: LyricsPayload };
  get_song_lyrics_payload: { payload: { path: string }; response: LyricsPayload };
  // ============ 任务栏 ============
  get_taskbar_tray_geometry: { payload: undefined; response: TaskbarTrayGeometry };
  setup_taskbar_window: { payload: undefined; response: OwnerBindingState };
  install_taskbar_zorder_guard: { payload: undefined; response: boolean };
  uninstall_taskbar_zorder_guard: { payload: undefined; response: void };
  // ============ 原生托盘 ============
  update_native_tray_menu: { payload: { state: NativeTrayMenuState }; response: void };
  // ============ 统计 ============
  get_library_stats: { payload: undefined; response: LibraryStats };
  get_behavior_stats: { payload: { timeRange: TimeRange }; response: BehaviorStats };
  get_listen_durations: { payload: undefined; response: ListenDurations };
  get_quality_distribution: { payload: undefined; response: QualityDistribution };
  get_format_distribution: { payload: undefined; response: FormatDistribution };
  reset_local_statistics: { payload: undefined; response: void };
  // ============ 曲库扫描 ============
  scan_folder_as_playlists: {
    payload: { rootPath: string; minimumDurationSeconds?: number | null };
    response: GeneratedFolder[];
  };
  get_library_songs_cached: { payload: undefined; response: LibrarySong[] };
  scan_library: {
    payload: { minimumDurationSeconds?: number | null };
    response: LibrarySong[];
  };
  // ============ 重命名工具 ============
  preview_rename: { payload: { rootPath: string; config: RenameConfig }; response: RenamePreview[] };
  apply_rename: { payload: { operations: RenameOperation[] }; response: number };
  // ============ GPU 加速 ============
  set_gpu_acceleration: { payload: { enabled: boolean }; response: void };
  // ============ 壁纸下载 ============
  download_wallpaper: { payload: { url: string; filename: string }; response: string };
  delete_wallpaper_file: { payload: { localPath: string }; response: void };
  // ============ 通用文件写入 ============
  write_text_file: { payload: { content: string; destPath: string }; response: string };
}

/** 听歌识曲接口响应 */
export interface RecognizeResponseContract {
  status: number;
  body: string;
}

export interface LxUrlSongInfoContract {
  songmid: string;
  source: string;
  hash?: string;
  name?: string;
  singer?: string;
  albumName?: string;
  albumId?: string | number;
  albumMid?: string;
  copyrightId?: string;
  strMediaMid?: string;
  songId?: string | number;
  _types?: Record<string, { size?: string | null; hash?: string }>;
}

interface ResolvedUrlContract {
  url: string;
  quality: string;
}

export interface AlternativeSourceResultContract {
  source: string;
  songmid: string;
  name: string;
  singer: string;
  albumName: string;
  albumId: string | number;
  albumMid?: string;
  img?: string | null;
  interval: string;
  hash?: string | null;
  copyrightId?: string | null;
  strMediaMid?: string | null;
  songId?: string | number;
  lxTypes?: Record<string, { size?: string | null; hash?: string }>;
  resolvedUrl?: string | null;
  resolvedQuality?: string | null;
}

interface LyricSongInfoContract {
  songmid: string;
  hash?: string;
  name: string;
  singer: string;
  albumName?: string;
  interval?: string;
  _interval?: number;
  songId?: string | number;
  strMediaMid?: string;
  albumMid?: string;
  albumId?: string | number;
  copyrightId?: string;
  source?: string;
}

interface LyricResultContract {
  lyric: string;
  tlyric: string;
  rlyric: string;
  lxlyric: string;
}

interface PlaybackSessionDataContract {
  currentSongPath: string | null;
  playQueuePaths: string[];
  sourceSongPaths: string[];
  playMode: number;
  volume: number;
  currentPositionSecs: number;
  isPlaying: boolean;
  sessionQualityOverride: string | null;
  queueSongMeta: Record<string, Song>;
  updatedAt: number;
}

// ===== 下载服务类型契约 =====

/** URL 大小探测结果（与 Rust ProbeUrlInfo 对应，response 使用 Rust 序列化字段名） */
export interface ProbeUrlInfoContract {
  url: string;
  size: number;
  error?: string;
}

/** 元数据嵌入请求（与 Rust EmbedMetadataRequest 对应，payload 使用 camelCase） */
export interface EmbedMetadataRequestContract {
  filePath: string;
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  year?: string;
  trackNumber?: string;
  discNumber?: string;
  lyrics?: string;
  coverData?: number[] | Uint8Array;
  coverMime?: string;
}

/** 下载收尾请求（与 Rust FinalizeDownloadExtrasRequest 对应，payload 使用 camelCase） */
export interface FinalizeDownloadExtrasRequestContract {
  lyricsText?: string | null;
  lyricsPath?: string | null;
  coverUrl?: string | null;
  coverPath?: string | null;
  metadata?: EmbedMetadataRequestContract | null;
  embedCover: boolean;
}

/** 下载收尾结果（与 Rust FinalizeDownloadExtrasResult 对应，response 使用 Rust 序列化字段名） */
export interface FinalizeDownloadExtrasResultContract {
  lyrics_saved: boolean;
  cover_saved: boolean;
  metadata_embedded: boolean;
  metadata_error?: string | null;
  cover_data: number[] | null;
  cover_mime: string;
}

// ===== 插件基础设施类型契约 =====

/** 插件 HTTP 代理响应（与 Rust PluginHttpResponse 对应） */
export interface PluginHttpResponseContract {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** 插件 HTTP 二进制代理响应（与 Rust PluginHttpBinaryResponse 对应） */
export interface PluginHttpBinaryResponseContract {
  status: number;
  url: string;
  headers: Record<string, string>;
  body_base64: string;
}
