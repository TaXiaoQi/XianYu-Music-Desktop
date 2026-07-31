import type { AppSettings, HistoryItem, Playlist, Song, EqualizerPreset } from '../../types';
import { localStore } from './localStore';
import { fileStore } from './fileStore';

export type ArtistSortMode = 'count' | 'name' | 'custom';
export type AlbumSortMode = 'count' | 'name' | 'artist' | 'custom';
export type FolderSortMode = 'title' | 'name' | 'artist' | 'track_number' | 'added_at' | 'added_at_asc' | 'custom';
export type LocalSortMode = 'title' | 'artist' | 'added_at' | 'added_at_asc' | 'file_modified_at' | 'file_modified_at_asc' | 'custom';
export type AlbumDetailSortMode = 'track_number' | 'track_number_desc' | 'title' | 'artist' | 'added_at' | 'added_at_asc' | 'file_modified_at' | 'file_modified_at_asc';
export type PlaylistSortMode = 'title' | 'name' | 'artist' | 'added_at' | 'added_at_asc' | 'custom';

export const playerStorageKeys = {
  settings: 'player_settings',
  volume: 'player_volume',
  playMode: 'player_mode',
  lastTime: 'player_last_time',
  outputDevice: 'player_output_device',
  outputDeviceMode: 'player_output_device_mode',
  watchedFolders: 'player_watched_folders',
  favorites: 'player_favorites',
  favoriteSongMeta: 'player_favorite_song_meta',
  recentSongMeta: 'player_recent_song_meta',
  recentOnlineHistory: 'player_recent_online_history',
  queueSongMeta: 'player_queue_song_meta',
  playlists: 'player_custom_playlists',
  artistSortMode: 'player_artist_sort_mode',
  albumSortMode: 'player_album_sort_mode',
  albumDetailSortMode: 'player_album_detail_sort_mode',
  folderSortMode: 'player_folder_sort_mode',
  localSortMode: 'player_local_sort_mode',
  playlistSortMode: 'player_playlist_sort_mode',
  artistCustomOrder: 'player_artist_custom_order',
  albumCustomOrder: 'player_album_custom_order',
  folderCustomOrder: 'player_folder_custom_order',
  localCustomOrder: 'player_local_custom_order',
  legacyAppSettings: 'app_settings',
  equalizerPresets: 'player_equalizer_presets',
} as const;

const isSong = (value: unknown): value is Song =>
  !!value && typeof value === 'object' && typeof (value as Song).path === 'string';

const normalizeHistoryItem = (value: unknown): HistoryItem | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const item = value as HistoryItem & { song?: Song };
  if (typeof item.path === 'string' && typeof item.playedAt === 'number') {
    return {
      path: item.path,
      playedAt: item.playedAt,
    };
  }

  if (isSong(item.song) && typeof item.playedAt === 'number') {
    return {
      path: item.song.path,
      playedAt: item.playedAt,
    };
  }

  return null;
};

export const playerStorage = {
  getString: localStore.getString,
  setString: localStore.setString,
  remove: localStore.remove,

  readStringArray(key: string): string[] | null {
    const parsed = localStore.getJson<unknown>(key);
    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  },

  readSongArray(key: string): Song[] {
    const parsed = localStore.getJson<unknown>(key);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isSong);
  },

  readSong(key: string): Song | null {
    const parsed = localStore.getJson<unknown>(key);
    return isSong(parsed) ? parsed : null;
  },

  readHistory(key: string): HistoryItem[] {
    const parsed = localStore.getJson<unknown>(key);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(normalizeHistoryItem)
      .filter((item): item is HistoryItem => !!item);
  },

  readSettings<T extends AppSettings>(key = playerStorageKeys.settings): T | null {
    const parsed = localStore.getJson<unknown>(key);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return parsed as T;
  },

  readObject<T extends object>(key: string): T | null {
    const parsed = localStore.getJson<unknown>(key);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return parsed as T;
  },

  writeSettings(settings: AppSettings, key = playerStorageKeys.settings) {
    localStore.setJson(key, settings);
  },

  readNumber(key: string): number | null {
    const raw = localStore.getString(key);
    if (!raw) {
      return null;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  },

  writeNumber(key: string, value: number) {
    localStore.setString(key, value.toString());
  },

  readPlaylists(key = playerStorageKeys.playlists): Playlist[] {
    const parsed = localStore.getJson<unknown>(key);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is Playlist => {
      if (!item || typeof item !== 'object') {
        return false;
      }

      const playlist = item as Playlist;
      return typeof playlist.id === 'string' && typeof playlist.name === 'string' && Array.isArray(playlist.songPaths);
    });
  },

  /**
   * 异步读取歌单：优先从文件系统读取（支持大数据），回退到 localStorage（兼容旧数据）。
   * 导入大歌单（9000+首）后 localStorage 会超限，必须用文件存储。
   */
  async readPlaylistsAsync(key = playerStorageKeys.playlists): Promise<Playlist[]> {
    const filterPlaylists = (parsed: unknown): Playlist[] => {
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is Playlist => {
        if (!item || typeof item !== 'object') return false;
        const playlist = item as Playlist;
        return typeof playlist.id === 'string' && typeof playlist.name === 'string' && Array.isArray(playlist.songPaths);
      });
    };

    // 优先从文件系统读取
    const fileData = await fileStore.getJson<unknown>(key);
    if (fileData !== null) {
      return filterPlaylists(fileData);
    }
    // 回退到 localStorage（兼容未迁移的旧数据）
    return filterPlaylists(localStore.getJson<unknown>(key));
  },

  /**
   * 异步写入歌单到文件系统，同时尝试写入 localStorage（向后兼容，超限时清理旧数据释放空间）。
   */
  async writePlaylistsAsync(playlists: Playlist[], key = playerStorageKeys.playlists): Promise<void> {
    // 优先写入文件系统（主存储，无大小限制）
    await fileStore.setJson(key, playlists);
    // 尝试同步写入 localStorage（向后兼容旧版本），超限时移除旧数据释放空间
    try {
      localStore.setJson(key, playlists);
    } catch {
      // localStorage 配额超限，文件存储已保证数据安全
      // 移除 localStorage 中的旧歌单数据，释放空间给其他 localStorage 写入
      localStore.remove(key);
    }
  },

  // 均衡器预设管理
  readEqualizerPresets(): EqualizerPreset[] {
    const parsed = localStore.getJson<unknown>(playerStorageKeys.equalizerPresets);
    if (!Array.isArray(parsed)) {
      return [];
    }
    
    return parsed.filter((item): item is EqualizerPreset => {
      if (!item || typeof item !== 'object') return false;
      
      const preset = item as Record<string, unknown>;
      
      // 完整校验所有必需字段
      return (
        typeof preset.id === 'string' &&
        preset.id.length > 0 &&
        typeof preset.name === 'string' &&
        typeof preset.preamp === 'number' &&
        Number.isFinite(preset.preamp) &&
        Array.isArray(preset.gains) &&
        preset.gains.length === 10 &&
        preset.gains.every((g: unknown) => typeof g === 'number' && Number.isFinite(g)) &&
        typeof preset.isBuiltin === 'boolean' &&
        typeof preset.createdAt === 'number' &&
        Number.isFinite(preset.createdAt) &&
        typeof preset.updatedAt === 'number' &&
        Number.isFinite(preset.updatedAt)
      );
    });
  },
  
  /** 读取在线收藏歌曲的元信息（path → Song） */
  readFavoriteSongMeta(): Record<string, Song> {
    const parsed = localStore.getJson<unknown>(playerStorageKeys.favoriteSongMeta);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const result: Record<string, Song> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([path, value]) => {
      if (value && typeof value === 'object' && typeof (value as Song).path === 'string') {
        result[path] = value as Song;
      }
    });
    return result;
  },

  /** 读取在线最近播放歌曲的元信息（path → Song） */
  readRecentSongMeta(): Record<string, Song> {
    const parsed = localStore.getJson<unknown>(playerStorageKeys.recentSongMeta);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const result: Record<string, Song> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([path, value]) => {
      if (value && typeof value === 'object' && typeof (value as Song).path === 'string') {
        result[path] = value as Song;
      }
    });
    return result;
  },

  /** 读取持久化的在线最近播放条目（含 playedAt，毫秒） */
  readRecentOnlineHistory(): HistoryItem[] {
    return this.readHistory(playerStorageKeys.recentOnlineHistory);
  },

  /**
   * 读取播放队列/歌单中在线歌曲的元信息（path → Song）。
   * 队列/歌单持久化只存 path，在线歌（lx://）不在本地库中，需靠这份元数据在启动时
   * 还原完整 Song（含 duration），否则非收藏在线歌重启后会从队列中整首丢失。
   */
  readQueueSongMeta(): Record<string, Song> {
    const parsed = localStore.getJson<unknown>(playerStorageKeys.queueSongMeta);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const result: Record<string, Song> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([path, value]) => {
      if (value && typeof value === 'object' && typeof (value as Song).path === 'string') {
        result[path] = value as Song;
      }
    });
    return result;
  },

  writeEqualizerPresets(presets: EqualizerPreset[]) {
    localStore.setJson(playerStorageKeys.equalizerPresets, presets);
  },

  writePlayerState(options: {
    playlistPathKey: string;
    queuePathKey: string;
    legacyPlaylistKey: string;
    legacyQueueKey: string;
    sourceSongPaths: string[];
    watchedFolders: string[];
    favoritePaths: string[];
    favoriteSongMeta: Record<string, Song>;
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
    localStore.setJson(options.playlistPathKey, options.sourceSongPaths);
    localStore.setJson(playerStorageKeys.watchedFolders, options.watchedFolders);
    localStore.setJson(playerStorageKeys.favorites, options.favoritePaths);
    localStore.setJson(playerStorageKeys.favoriteSongMeta, options.favoriteSongMeta);
    localStore.setJson(playerStorageKeys.recentSongMeta, options.recentSongMeta);
    localStore.setJson(playerStorageKeys.recentOnlineHistory, options.recentOnlineHistory);
    localStore.setJson(playerStorageKeys.queueSongMeta, options.queueSongMeta);
    // 歌单数据通过 writePlaylistsAsync 异步写入文件系统，避免 localStorage 超限
    localStore.setJson(playerStorageKeys.settings, options.settings);
    localStore.setJson(options.queuePathKey, options.playQueuePaths);
    localStore.setJson(playerStorageKeys.artistCustomOrder, options.artistCustomOrder);
    localStore.setJson(playerStorageKeys.albumCustomOrder, options.albumCustomOrder);
    localStore.setJson(playerStorageKeys.folderCustomOrder, options.folderCustomOrder);
    localStore.setJson(playerStorageKeys.localCustomOrder, options.localCustomOrder);
    localStore.remove(options.legacyPlaylistKey);
    localStore.remove(options.legacyQueueKey);
  },
};
