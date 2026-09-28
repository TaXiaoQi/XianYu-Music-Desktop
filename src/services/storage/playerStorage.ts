import type { AppSettings, HistoryItem, Playlist, Song, EqualizerPreset } from '../../types';
import type { FavoriteCollectionEntry } from '../../features/collections/store';
import { localStore } from './localStore';
import { fileStore } from './fileStore';

// —— 排序模式相关类型（仅是各视图可选排序项的联合） ——
export type ArtistSortMode =
  | 'count' | 'name' | 'custom';
export type AlbumSortMode =
  | 'count' | 'name' | 'artist' | 'custom';
export type FolderSortMode =
  | 'title' | 'name' | 'artist' | 'track_number' | 'added_at' | 'added_at_asc' | 'custom';
export type LocalSortMode =
  | 'title' | 'artist' | 'added_at' | 'added_at_asc' | 'file_modified_at' | 'file_modified_at_asc' | 'custom';
export type AlbumDetailSortMode =
  | 'track_number' | 'track_number_desc' | 'title' | 'artist' | 'added_at' | 'added_at_asc'
  | 'file_modified_at' | 'file_modified_at_asc';
export type PlaylistSortMode =
  | 'title' | 'name' | 'artist' | 'added_at' | 'added_at_asc' | 'custom';

/**
 * 播放器全部存储键的集中登记处。
 * 键名一旦发布即不可变更，此处仅按域分组陈列。
 */
export const playerStorageKeys = {
  settings: 'player_settings', volume: 'player_volume', playMode: 'player_mode',
  lastTime: 'player_last_time', outputDevice: 'player_output_device',
  outputDeviceMode: 'player_output_device_mode', watchedFolders: 'player_watched_folders',
  favorites: 'player_favorites', favoriteSongMeta: 'player_favorite_song_meta',
  favoriteCollections: 'player_favorite_collections', recentSongMeta: 'player_recent_song_meta',
  recentOnlineHistory: 'player_recent_online_history', queueSongMeta: 'player_queue_song_meta',
  playlists: 'player_custom_playlists',
  artistSortMode: 'player_artist_sort_mode', albumSortMode: 'player_album_sort_mode',
  albumDetailSortMode: 'player_album_detail_sort_mode', folderSortMode: 'player_folder_sort_mode',
  localSortMode: 'player_local_sort_mode', playlistSortMode: 'player_playlist_sort_mode',
  artistCustomOrder: 'player_artist_custom_order', albumCustomOrder: 'player_album_custom_order',
  folderCustomOrder: 'player_folder_custom_order', localCustomOrder: 'player_local_custom_order',
  legacyAppSettings: 'app_settings',
  equalizerPresets: 'player_equalizer_presets', soundEffectState: 'player_sound_effect_state',
  pluginHostRack: 'player_plugin_host_rack', pluginHostExtraDirs: 'player_plugin_host_extra_dirs',
  consumedInstallLanguage: 'player_consumed_install_language',
  /** 已应用过的设置迁移 id（JSON 数组），见 features/settings/migrations.ts */
  settingsMigrations: 'player_settings_migrations',
} as const;

/** 判断任意值是否具备 Song 的最小形态（带字符串 path 的对象）。 */
function looksLikeSong(candidate: unknown): candidate is Song {
  return !!candidate
    && typeof candidate === 'object'
    && typeof (candidate as Song).path === 'string';
}

/** 把历史条目归一化成 { path, playedAt }；无法识别时返回 null。 */
function coerceHistoryEntry(candidate: unknown): HistoryItem | null {
  if (candidate === null || typeof candidate !== 'object') {
    return null;
  }

  const entry = candidate as HistoryItem & { song?: Song };
  const hasPlayedAt = typeof entry.playedAt === 'number';

  if (hasPlayedAt && typeof entry.path === 'string') {
    return { path: entry.path, playedAt: entry.playedAt };
  }
  if (hasPlayedAt && looksLikeSong(entry.song)) {
    return { path: entry.song.path, playedAt: entry.playedAt };
  }

  return null;
}

/** 校验值是否为「非数组普通对象」。 */
function asPlainRecord(candidate: unknown): Record<string, unknown> | null {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }
  return candidate as Record<string, unknown>;
}

/** 从任意解析结果里筛出结构合法的歌单列表。 */
function pickValidPlaylists(candidate: unknown): Playlist[] {
  if (!Array.isArray(candidate)) return [];

  const accepted: Playlist[] = [];
  for (const entry of candidate) {
    if (entry === null || typeof entry !== 'object') continue;
    const playlist = entry as Playlist;
    const shapeOk =
      typeof playlist.id === 'string'
      && typeof playlist.name === 'string'
      && Array.isArray(playlist.songPaths);
    if (shapeOk) accepted.push(playlist);
  }
  return accepted;
}

/** 收藏/最近播放/队列共用的「path → Song」元数据表清洗。 */
function pickSongMetaTable(candidate: unknown): Record<string, Song> {
  const table = asPlainRecord(candidate);
  if (table === null) return {};

  const cleaned: Record<string, Song> = {};
  for (const [songPath, meta] of Object.entries(table)) {
    if (looksLikeSong(meta)) cleaned[songPath] = meta;
  }
  return cleaned;
}

/** 均衡器预设的完整字段校验。 */
function isValidEqualizerPreset(candidate: unknown): candidate is EqualizerPreset {
  if (candidate === null || typeof candidate !== 'object') return false;
  const preset = candidate as Record<string, unknown>;
  const gains = preset.gains;
  const finite = (input: unknown): input is number => typeof input === 'number' && Number.isFinite(input);

  return (
    typeof preset.id === 'string' && preset.id !== ''
    && typeof preset.name === 'string'
    && finite(preset.preamp)
    && Array.isArray(gains)
    && gains.length === 10
    && gains.every((gain: unknown) => finite(gain))
    && typeof preset.isBuiltin === 'boolean'
    && finite(preset.createdAt)
    && finite(preset.updatedAt)
  );
}

/** 收藏合集条目校验：key/type/title 三要素齐全且 type 取值合法。 */
function isValidFavoriteCollectionEntry(candidate: unknown): candidate is FavoriteCollectionEntry {
  if (candidate === null || typeof candidate !== 'object') return false;
  const entry = candidate as FavoriteCollectionEntry;
  const typeOk = entry.type === 'playlist' || entry.type === 'album';
  return typeof entry.key === 'string' && typeOk && typeof entry.title === 'string';
}

export const playerStorage = {
  // 原样透传基础读写能力，保持调用面不变。
  getString: (key: string) => localStore.getString(key),
  setString: (key: string, value: string) => localStore.setString(key, value),
  remove: (key: string) => localStore.remove(key),

  readStringArray(key: string): string[] | null {
    const parsed = localStore.getJson<unknown>(key);
    if (!Array.isArray(parsed)) return null;

    const cleaned: string[] = [];
    for (const entry of parsed) {
      if (typeof entry === 'string' && entry.trim() !== '') cleaned.push(entry);
    }
    return cleaned;
  },

  readSongArray(key: string): Song[] {
    const parsed = localStore.getJson<unknown>(key);
    if (!Array.isArray(parsed)) return [];

    const songs: Song[] = [];
    for (const entry of parsed) {
      if (looksLikeSong(entry)) songs.push(entry);
    }
    return songs;
  },

  readSong(key: string): Song | null {
    const parsed = localStore.getJson<unknown>(key);
    return looksLikeSong(parsed) ? parsed : null;
  },

  readHistory(key: string): HistoryItem[] {
    const parsed = localStore.getJson<unknown>(key);
    if (!Array.isArray(parsed)) return [];

    const history: HistoryItem[] = [];
    for (const entry of parsed) {
      const normalized = coerceHistoryEntry(entry);
      if (normalized !== null) history.push(normalized);
    }
    return history;
  },

  readSettings<T extends AppSettings>(key = playerStorageKeys.settings): T | null {
    const parsed = asPlainRecord(localStore.getJson<unknown>(key));
    return parsed === null ? null : (parsed as T);
  },

  readObject<T extends object>(key: string): T | null {
    const parsed = asPlainRecord(localStore.getJson<unknown>(key));
    return parsed === null ? null : (parsed as T);
  },

  writeSettings(settings: AppSettings, key = playerStorageKeys.settings) {
    localStore.setJson(key, settings);
  },

  readNumber(key: string): number | null {
    const raw = localStore.getString(key);
    if (raw === null || raw === '') return null;

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  },

  writeNumber(key: string, value: number) {
    localStore.setString(key, value.toString());
  },

  readPlaylists(key = playerStorageKeys.playlists): Playlist[] {
    return pickValidPlaylists(localStore.getJson<unknown>(key));
  },

  async readPlaylistsAsync(key = playerStorageKeys.playlists): Promise<Playlist[]> {
    // 优先读文件态存储；文件侧没有（返回 null）时回退到 localStorage。
    const fromFile = await fileStore.getJson<unknown>(key);
    if (fromFile !== null) return pickValidPlaylists(fromFile);
    return pickValidPlaylists(localStore.getJson<unknown>(key));
  },

  async writePlaylistsAsync(playlists: Playlist[], key = playerStorageKeys.playlists): Promise<void> {
    await fileStore.setJson(key, playlists);
    try {
      localStore.setJson(key, playlists);
    } catch {
      localStore.remove(key);
    }
  },

  readEqualizerPresets(): EqualizerPreset[] {
    const parsed = localStore.getJson<unknown>(playerStorageKeys.equalizerPresets);
    if (!Array.isArray(parsed)) return [];

    const presets: EqualizerPreset[] = [];
    for (const entry of parsed) {
      if (isValidEqualizerPreset(entry)) presets.push(entry);
    }
    return presets;
  },

  readFavoriteSongMeta(): Record<string, Song> {
    return pickSongMetaTable(localStore.getJson<unknown>(playerStorageKeys.favoriteSongMeta));
  },

  readRecentSongMeta(): Record<string, Song> {
    return pickSongMetaTable(localStore.getJson<unknown>(playerStorageKeys.recentSongMeta));
  },

  readFavoriteCollections(): FavoriteCollectionEntry[] {
    const parsed = localStore.getJson<unknown>(playerStorageKeys.favoriteCollections);
    if (!Array.isArray(parsed)) return [];

    const entries: FavoriteCollectionEntry[] = [];
    for (const item of parsed) {
      if (isValidFavoriteCollectionEntry(item)) entries.push(item);
    }
    return entries;
  },

  readRecentOnlineHistory(): HistoryItem[] {
    return this.readHistory(playerStorageKeys.recentOnlineHistory);
  },

  readQueueSongMeta(): Record<string, Song> {
    return pickSongMetaTable(localStore.getJson<unknown>(playerStorageKeys.queueSongMeta));
  },

  writeEqualizerPresets(presets: EqualizerPreset[]) {
    const { equalizerPresets: presetKey } = playerStorageKeys;
    localStore.setJson(presetKey, presets);
  },

  /**
   * 一次性把播放器的持久化状态刷入 localStorage。
   * 写入顺序即数组排列顺序；最后清理两个遗留键。
   */
  writePlayerState(state: {
    playlistPathKey: string;
    queuePathKey: string;
    legacyPlaylistKey: string;
    legacyQueueKey: string;
    sourceSongPaths: string[];
    watchedFolders: string[];
    favoritePaths: string[];
    favoriteSongMeta: Record<string, Song>;
    favoriteCollections: FavoriteCollectionEntry[];
    recentSongMeta: Record<string, Song>;
    recentOnlineHistory: HistoryItem[];
    queueSongMeta: Record<string, Song>;
    playlists: Playlist[];
    settings: AppSettings;
    playQueuePaths: string[];
    artistCustomOrder: string[];
    albumCustomOrder: string[];
    folderCustomOrder: Record<string, string[]>;
    localCustomOrder: string[];
  }) {
    const pendingWrites: Array<[storageKey: string, payload: unknown]> = [
      [state.playlistPathKey, state.sourceSongPaths],
      [playerStorageKeys.watchedFolders, state.watchedFolders],
      [playerStorageKeys.favorites, state.favoritePaths],
      [playerStorageKeys.favoriteSongMeta, state.favoriteSongMeta],
      [playerStorageKeys.favoriteCollections, state.favoriteCollections],
      [playerStorageKeys.recentSongMeta, state.recentSongMeta],
      [playerStorageKeys.recentOnlineHistory, state.recentOnlineHistory],
      [playerStorageKeys.queueSongMeta, state.queueSongMeta],
      [playerStorageKeys.settings, state.settings],
      [state.queuePathKey, state.playQueuePaths],
      [playerStorageKeys.artistCustomOrder, state.artistCustomOrder],
      [playerStorageKeys.albumCustomOrder, state.albumCustomOrder],
      [playerStorageKeys.folderCustomOrder, state.folderCustomOrder],
      [playerStorageKeys.localCustomOrder, state.localCustomOrder],
    ];

    for (const [storageKey, payload] of pendingWrites) {
      localStore.setJson(storageKey, payload);
    }

    localStore.remove(state.legacyPlaylistKey);
    localStore.remove(state.legacyQueueKey);
  },
};
