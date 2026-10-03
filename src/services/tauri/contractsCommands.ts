import type {
  AlbumCatalogItem,
  ArtistCatalogItem,
  FolderNode,
  ImportedLyricsFont,
  LibraryFolder,
  LibrarySong,
  Playlist,
  RecentAlbumCatalogItem,
  RecentPlaylistCatalogItem,
  RemoteCacheUsage,
  RemoteConnectionResult,
  RemoteFileEntry,
  RemoteSource,
  RemoteSourceInput,
  RemoteSyncResult,
  SaveArtistAvatarResponse,
  SleepTimerAction,
  SleepTimerSnapshot,
  Song,
  SongDetail,
} from '../../types';
import type { AudioOutputMode } from '../../types';
import type { LyricsPayload } from '../../composables/lyrics/types';

import type {
  AlternativeSourceResultContract,
  LyricResultContract,
  LyricSongInfoContract,
  LxUrlSongInfoContract,
  PlaybackSessionDataContract,
  PlaylistImportResultContract,
  RecognizeResponseContract,
} from './contractsDomain';

import type {
  FinalizeDownloadExtrasRequestContract,
  FinalizeDownloadExtrasResultContract,
  ProbeUrlInfoContract,
} from './contractsDownload';

import type {
  LoudnessRecord,
  RecentHistoryImportRecord,
  RecentHistoryRecord,
  StatisticsExportResult,
  StatisticsImportPreview,
  StatisticsImportResult,
} from './contractsHistory';

import type {
  BatchMoveMusicFilesResult,
  BehaviorStats,
  CloudMergeResult,
  ConvertAudioResult,
  FfmpegDetection,
  FormatDistribution,
  GeneratedFolder,
  LibraryStats,
  ListenDurations,
  ListenSnapshotMergeResult,
  LyricsStorageSource,
  QualityDistribution,
  RenameConfig,
  RenameOperation,
  RenamePreview,
  SaveSongInfoResponse,
  SongInfoEditPayload,
  SongLyricsForEdit,
  TimeRange,
  TrimAudioResult,
} from './contractsLibrary';

import type {
  NetworkProxyConfigOptions,
  NetworkProxyState,
  NetworkProxyTestResult,
} from './contractsNetwork';

import type {
  AudioDevice,
  AudioDeviceFormats,
  AudioOutputStatus,
  ControlChannelStatus,
  ControlPairingCodeInfo,
  DlnaCastMediaInfo,
  DlnaCastTransportState,
  DlnaDevicePayload,
  DlnaMediaPayload,
  DlnaRendererStatus,
  PlayAudioOptions,
  PrefetchAudioHeadOptions,
  SeekAudioOptions,
  SoundEffectSettings,
  SystemInfoPayload,
  UpdateLoudnessSettingsOptions,
  UpdatePlaybackMetadataOptions,
} from './contractsPlayback';

import type {
  FallbackCallManyResultContract,
  FallbackCallResultContract,
  FallbackLoadResultContract,
  PluginEngineCallResultContract,
  PluginEngineLoadResultContract,
  PluginHostEditorStateEntry,
  PluginHostParameterEntry,
  PluginHostParameterValueEntry,
  PluginHostPresetEntry,
  PluginHostRackConfig,
  PluginHostScanEntry,
  PluginHttpBinaryResponseContract,
  PluginHttpResponseContract,
} from './contractsPlugin';

import type {
  ForegroundFullscreenState,
  ForegroundWindowInfo,
  NativeTrayMenuState,
  OwnerBindingState,
  TaskbarTrayGeometry,
  WindowMaterialCapabilities,
} from './contractsWindow';

export interface TauriCommandMap {
  set_sleep_timer: { payload: { seconds: number; action: SleepTimerAction }; response: SleepTimerSnapshot };
  clear_sleep_timer: { payload: undefined; response: void };
  get_sleep_timer: { payload: undefined; response: SleepTimerSnapshot | null };
  run_sleep_action: { payload: { action: SleepTimerAction }; response: void };
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
  verify_fallback_module_signature: {
    payload: { moduleKey: string; version: number; code: string; signature: string };
    response: boolean;
  };
  verify_beta_access_signature: {
    payload: { deviceId: string; allowed: boolean; pending: boolean; exp: number; signature: string };
    response: boolean;
  };
  clear_cover_cache: { payload: undefined; response: void };
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
  prefetch_audio_head: { payload: PrefetchAudioHeadOptions; response: boolean };
  update_playback_metadata: { payload: UpdatePlaybackMetadataOptions; response: void };
  // ===== DLNA 双向投屏 =====
  dlna_search_devices: { payload: { timeoutMs: number }; response: DlnaDevicePayload[] };
  dlna_cast_set_uri: {
    payload: {
      device: DlnaDevicePayload;
      media: DlnaMediaPayload;
      cover: DlnaMediaPayload | null;
      lyric: DlnaMediaPayload | null;
      title: string;
      artist: string;
      album: string;
      durationMs: number;
    };
    response: DlnaCastMediaInfo;
  };
  dlna_cast_play: { payload: { device: DlnaDevicePayload }; response: void };
  dlna_cast_pause: { payload: { device: DlnaDevicePayload }; response: void };
  dlna_cast_stop: { payload: { device: DlnaDevicePayload }; response: void };
  dlna_cast_seek: { payload: { device: DlnaDevicePayload; secs: number }; response: void };
  dlna_cast_set_volume: { payload: { device: DlnaDevicePayload; percent: number }; response: void };
  dlna_cast_get_state: { payload: { device: DlnaDevicePayload }; response: DlnaCastTransportState };
  dlna_update_media_token: { payload: { token: string; payload: DlnaMediaPayload }; response: boolean };
  dlna_enable_renderer: { payload: { friendlyName: string; udn: string }; response: number };
  dlna_disable_renderer: { payload: undefined; response: void };
  dlna_renderer_status: { payload: undefined; response: DlnaRendererStatus };
  control_channel_status: { payload: undefined; response: ControlChannelStatus };
  control_channel_set_enabled: { payload: { enabled: boolean }; response: void };
  control_channel_refresh_pairing_code: { payload: undefined; response: ControlPairingCodeInfo };
  control_channel_forget_device: { payload: { token: string }; response: boolean };
  control_channel_push_state: { payload: { isPlaying: boolean; volume: number }; response: void };
  control_channel_push_now_playing: {
    payload: { id: string; title: string; artist: string; album: string; duration: number };
    response: void;
  };
  control_channel_push_position: { payload: { pos: number; duration: number }; response: void };
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
        defaultFileName: string;
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
  smart_toggle_maximize: { payload: undefined; response: boolean };
  set_dark_mode_for_window: { payload: { dark: boolean }; response: void };
  force_window_foreground: { payload: { label: string }; response: void };
  describe_foreground_window: { payload: undefined; response: ForegroundWindowInfo };
  start_tray_mouse_capture: { payload: { label: string }; response: void };
  stop_tray_mouse_capture: { payload: undefined; response: void };
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
  clear_all_app_data: { payload: { confirm: boolean }; response: void };
  open_external_program: {
    payload: { path: string; args: string[] };
    response: void;
  };
  register_external_program: {
    payload: undefined;
    response: string;
  };
  register_download_directory: {
    payload: undefined;
    response: string;
  };
  save_text_via_dialog: {
    payload: {
      defaultFileName: string;
      filter: { name: string; extensions: string[] } | null;
      content: string;
    };
    response: string | null;
  };
  save_bytes_via_dialog: {
    payload: {
      defaultFileName: string;
      filter: { name: string; extensions: string[] } | null;
      data: number[];
    };
    response: string | null;
  };
  consume_pending_open_paths: { payload: undefined; response: string[] };
  consume_pending_deep_links: { payload: undefined; response: string[] };
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
  set_stream_cache_dir: {
    payload: { path: string };
    response: void;
  };
  get_stream_cache_dir: {
    payload: undefined;
    response: string;
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
    payload: { fileName: string; overwriteExisting: boolean };
    response: string;
  };
  resolve_download_full_path: {
    payload: {
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
    payload: { url: string; fileName: string; ekey: string | null; headers: Record<string, string> | null };
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
    payload: { url: string; fileName: string };
    response: number;
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
  // ===== QuickJS 插件引擎命令（插件脚本在 Rust 后端隔离执行）=====
  plugin_engine_load_musicfree: {
    payload: { pluginId: string; script: string; userVarsJson: string };
    response: PluginEngineLoadResultContract;
  };
  plugin_engine_load_lx: {
    payload: { pluginId: string; script: string; scriptInfoJson: string };
    response: PluginEngineLoadResultContract;
  };
  plugin_engine_call: {
    payload: {
      pluginId: string;
      method: string;
      argsJson: string;
      userVarsJson?: string | null;
      timeoutMs: number;
    };
    response: PluginEngineCallResultContract;
  };
  plugin_engine_destroy: {
    payload: { pluginId: string };
    response: void;
  };
  plugin_engine_store_import: {
    payload: {
      payload: {
        cookies: Record<string, { value: string; domain: string }>;
        storage: Record<string, string>;
      };
    };
    response: void;
  };
  plugin_engine_cookie_header_for_domain: {
    payload: { domain: string };
    response: string;
  };
  // ===== 兜底模块宿主命令（Rust fallback_host）=====
  fallback_module_load: {
    payload: { moduleKey: string; version: number; code: string; signature: string; appVersion: string };
    response: FallbackLoadResultContract;
  };
  fallback_module_call: {
    payload: { moduleKey: string; method: string; argsJson: string; timeoutMs?: number | null };
    response: FallbackCallResultContract;
  };
  fallback_module_call_many: {
    payload: { moduleKey: string; method: string; argsJsonList: string[]; timeoutMs?: number | null };
    response: FallbackCallManyResultContract;
  };
  fallback_module_update_config: {
    payload: { configJson: string };
    response: string;
  };
  // 启动对账：返回 Rust 已存配置的 sha256-hex（未推送过为空串）
  fallback_module_config_hash: {
    payload: undefined;
    response: string;
  };
  // ===== 宿主侧平台签名/加密（Rust host_crypto）=====
  host_zzc_sign: {
    payload: { text: string };
    response: string;
  };
  host_kugou_sign: {
    payload: { params: string; platform: string; body?: string | null };
    response: string;
  };
  host_kugou_request_key: {
    payload: undefined;
    response: string;
  };
  host_migu_sign: {
    payload: { text: string; time: string };
    response: { sign: string; deviceId: string };
  };
  host_linuxapi_encrypt: {
    payload: { payload: string };
    response: string;
  };
  host_weapi_encrypt: {
    payload: { payload: string };
    response: { params: string; encSecKey: string };
  };
  host_sha256_hex: {
    payload: { text: string };
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
  read_image_base64: {
    payload: { path: string };
    response: { mime: string; base64: string };
  };
  import_skin_image: {
    payload: { sourcePath: string };
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
  fetch_playlist_from_source: {
    payload: { source: string; rawId: string };
    response: PlaylistImportResultContract;
  };
  decrypt_plugin_lyric: {
    payload: { encryptedHex: string };
    response: string;
  };
  get_lx_cover: {
    payload: { songInfo: LxUrlSongInfoContract };
    response: string | null;
  };
  find_alternative_lx_source: {
    payload: {
      songName: string;
      songArtist: string;
      songDuration: number;
      failedSources: string[];
    };
    response: AlternativeSourceResultContract | null;
  };

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
  is_store_build: { payload: undefined; response: boolean };
  // ============ 应用生命周期 ============
  exit_app: { payload: undefined; response: void };
  // ============ 开机自启动 ============
  set_launch_on_startup: { payload: { enabled: boolean }; response: void };
  get_launch_on_startup: { payload: undefined; response: boolean };
  set_audio_file_associations: { payload: { enabled: string[]; disabled: string[] }; response: void };
  get_audio_file_associations: { payload: undefined; response: string[] };
  was_launched_at_startup: { payload: undefined; response: boolean };
  // ============ 网络代理 ============
  get_network_proxy: { payload: undefined; response: NetworkProxyState };
  set_network_proxy: {
    payload: { config: NetworkProxyConfigOptions; password: string | null };
    response: void;
  };
  test_network_proxy: {
    payload: { config: NetworkProxyConfigOptions; password: string | null };
    response: NetworkProxyTestResult;
  };
  restart_app: { payload: undefined; response: void };
  // ============ 安装语言 ============
  get_install_language: { payload: undefined; response: string | null };
  set_install_language: { payload: { language: string }; response: boolean };
  // ============ 歌词字体 ============
  read_lyrics_font_data_url: { payload: { fontPath: string }; response: string };
  import_lyrics_font: { payload: { sourcePath: string }; response: ImportedLyricsFont };
  get_system_fonts: { payload: undefined; response: string[] };
  get_system_info: { payload: undefined; response: SystemInfoPayload };
  get_machine_id: { payload: undefined; response: string };
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
  merge_cloud_listen_duration: {
    payload: { totalSeconds: number };
    response: CloudMergeResult;
  };
  export_listen_snapshot: {
    payload: undefined;
    response: string;
  };
  merge_listen_snapshot: {
    payload: { snapshotJson: string; mode: 'add' | 'max' };
    response: ListenSnapshotMergeResult;
  };
  clear_listen_stats: { payload: undefined; response: void };
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
  // ============ 文件转换（工具箱 · ffmpeg） ============
  detect_ffmpeg: { payload: { ffmpegPath?: string }; response: FfmpegDetection };
  convert_audio: {
    payload: { inputPaths: string[]; outDir: string; targetFormat: string; ffmpegPath?: string; outName?: string; sampleRate?: number };
    response: ConvertAudioResult[];
  };
  // ============ 音频剪辑（工具箱 · ffmpeg） ============
  probe_audio_duration: {
    payload: { inputPath: string; ffmpegPath?: string };
    response: number;
  };
  trim_audio: {
    payload: { inputPath: string; startSecs: number; endSecs: number; outputDir?: string; ffmpegPath?: string };
    response: TrimAudioResult;
  };
  // ============ GPU 加速 ============
  set_gpu_acceleration: { payload: { enabled: boolean }; response: void };
  // ============ 壁纸下载 ============
  download_wallpaper: { payload: { url: string; filename: string; protectedPath?: string }; response: string };
  delete_wallpaper_file: { payload: { localPath: string }; response: void };
  save_theme_wallpaper: { payload: { dataUrl: string; filename: string }; response: string };
  delete_theme_wallpaper: { payload: { localPath: string }; response: void };
  // ============ 背景视频缓存 ============
  download_video_to_cache: {
    payload: { url: string; headers?: Record<string, string> | null };
    response: string;
  };
  remove_cached_background_video: {
    payload: { path: string };
    response: void;
  };
  // ============ MV 流式代理（进在线播放流缓存池） ============
  mv_proxy_url: {
    payload: { url: string; headers?: Record<string, string> | null };
    response: string;
  };
  // ============ VST3/CLAP 原生插件宿主 ============
  plugin_host_scan_plugins: { payload: { dirs: string[]; disabledPaths?: string[] }; response: PluginHostScanEntry[] };
  plugin_host_get_rack: { payload: undefined; response: PluginHostRackConfig };
  plugin_host_set_rack: { payload: { config: PluginHostRackConfig }; response: void };
  plugin_host_get_plugin_parameters: {
    payload: { format: string; uniqueId: string; path: string };
    response: PluginHostParameterEntry[];
  };
  plugin_host_get_parameter_values: {
    payload: { format: string; uniqueId: string; path: string };
    response: PluginHostParameterValueEntry[];
  };
  plugin_host_set_parameter: {
    payload: { format: string; uniqueId: string; index: number; value: number };
    response: void;
  };
  plugin_host_get_plugin_presets: {
    payload: { format: string; uniqueId: string; path: string };
    response: PluginHostPresetEntry[];
  };
  plugin_host_load_preset: {
    payload: { format: string; uniqueId: string; path: string; presetNumber: number };
    response: void;
  };
  plugin_host_open_editor: {
    payload: { format: string; uniqueId: string; title: string };
    response: void;
  };
  plugin_host_close_editor: {
    payload: { format: string; uniqueId: string };
    response: void;
  };
  plugin_host_editor_states: { payload: undefined; response: PluginHostEditorStateEntry[] };
  plugin_host_take_process_error: { payload: undefined; response: string | null };
}
