import { ref, computed } from 'vue';
import { defineStore } from 'pinia';

import type { PlaylistSortMode } from '../../services/storage/playerStorage';
import type { HistoryItem, Playlist, Song } from '../../types';
import type { OnlineDetailContext } from '../onlineDetail/store';
import { useLibraryStore } from '../library/store';

const formatPlaylistDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
};

/** 收藏的歌单/专辑条目（收藏页"歌单/专辑"tab 数据源） */
export interface FavoriteCollectionEntry {
  /** 唯一键：`online:mf|lx:<源>:<type>:<平台ID>` 或 `local:playlist:<歌单ID>` */
  key: string;
  type: 'playlist' | 'album';
  title: string;
  subtitle: string;
  coverUrl: string;
  favoritedAt: number;
  /** 在线详情上下文快照（在线歌单/专辑从收藏页重新打开详情用） */
  onlineContext?: OnlineDetailContext | null;
  /** 本地歌单 ID（收藏本地歌单时使用，打开走首页歌单详情） */
  localPlaylistId?: string;
}

/** 在线歌单/专辑的收藏唯一键 */
export const buildOnlineCollectionKey = (
  ctx: {
    type: 'playlist' | 'album';
    engineType?: 'musicfree' | 'lx' | null;
    lxSourceId?: string | null;
    pluginSource?: { id: string } | null;
  },
  platformId: string,
): string => {
  const engine = ctx.engineType === 'lx'
    ? `lx:${ctx.lxSourceId ?? ''}`
    : `mf:${ctx.pluginSource?.id ?? ''}`;
  return `online:${engine}:${ctx.type}:${platformId}`;
};

/** 从在线详情上下文 rawData 中提取平台 ID（收藏键标识），提取不到返回空串 */
export const resolveOnlineCollectionPlatformId = (
  ctx: { type: 'playlist' | 'album' | 'artist' | 'user'; rawData?: any },
): string => {
  const raw = ctx.rawData;
  if (!raw || typeof raw !== 'object') {
    return '';
  }

  const candidates = ctx.type === 'album'
    ? [raw.albumId, raw.albumID, raw.AlbumID, raw.albumMID, raw.albumMid, raw.id, raw.ID]
    : [raw.id, raw.ID, raw.playlistId, raw.playlistid, raw.specialid, raw.dissid, raw.disstid, raw.songListId, raw.songlistId, raw.rid];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const value = String(candidate).trim();
    if (value) return value;
  }
  return '';
};

/** 本地歌单的收藏唯一键 */
export const buildLocalPlaylistCollectionKey = (playlistId: string) =>
  `local:playlist:${playlistId}`;

export const useCollectionsStore = defineStore('collections', () => {
  const RECENT_SONG_LIMIT = 200;
  const favoritePaths = ref<string[]>([]);
  /**
   * 在线收藏歌曲的完整元信息（path → Song）。
   * 在线歌曲不在本地音乐库/数据库中，仅存 path 无法还原歌曲信息，
   * 因此收藏时额外保存一份元信息用于列表展示与播放。
   */
  const favoriteSongMeta = ref<Record<string, Song>>({});
  /**
   * 在线最近播放歌曲的完整元信息（path → Song）。
   * 在线歌曲不在本地音乐库/数据库中，仅存 path 无法在最近播放列表里还原歌曲信息，
   * 因此播放时额外保存一份元信息用于列表展示与播放。
   */
  const recentSongMeta = ref<Record<string, Song>>({});
  const playlists = ref<Playlist[]>([]);
  const recentSongs = ref<HistoryItem[]>([]);
  const playlistSortMode = ref<PlaylistSortMode>('custom');
  /** 收藏的歌单/专辑（整张收藏，区别于按单曲收藏） */
  const favoriteCollections = ref<FavoriteCollectionEntry[]>([]);

  const setFavoritePaths = (paths: string[]) => {
    favoritePaths.value = paths;
  };

  const setFavoriteCollections = (entries: FavoriteCollectionEntry[]) => {
    favoriteCollections.value = entries ?? [];
  };

  const setPlaylists = (nextPlaylists: Playlist[]) => {
    playlists.value = nextPlaylists;
  };

  const setRecentSongs = (historyItems: HistoryItem[]) => {
    recentSongs.value = historyItems;
  };

  const createPlaylist = (name: string, initialSongs: string[] = [], fullSongs?: Song[]) => {
    if (!name.trim()) {
      return null;
    }

    const playlist: Playlist = {
      id: Date.now().toString() + Math.random().toString().slice(2),
      name,
      songPaths: [...initialSongs],
      createdAt: formatPlaylistDate(),
      songs: fullSongs?.length ? [...fullSongs] : undefined,
    };

    playlists.value.push(playlist);
    return playlist.id;
  };

  const deletePlaylist = (id: string) => {
    const beforeLength = playlists.value.length;
    playlists.value = playlists.value.filter(playlist => playlist.id !== id);
    return beforeLength !== playlists.value.length;
  };

  const renamePlaylist = (id: string, name: string) => {
    const playlist = getPlaylistById(id);
    if (playlist && name.trim()) {
      playlist.name = name.trim();
      return true;
    }
    return false;
  };

  const setPlaylistCover = (id: string, coverPath: string | null) => {
    const playlist = getPlaylistById(id);
    if (!playlist) return false;
    if (coverPath === null) {
      playlist.coverPath = undefined;
    } else {
      playlist.coverPath = coverPath;
    }
    return true;
  };

  /** 绑定云端歌单 ID（同步后调用） */
  const setPlaylistCloudId = (id: string, cloudId: number) => {
    const playlist = getPlaylistById(id);
    if (playlist) {
      playlist.cloudId = cloudId;
      return true;
    }
    return false;
  };

  /** 设置云端封面 URL */
  const setPlaylistCloudCoverUrl = (id: string, cloudCoverUrl: string) => {
    const playlist = getPlaylistById(id);
    if (playlist) {
      playlist.cloudCoverUrl = cloudCoverUrl;
      return true;
    }
    return false;
  };

  /** 根据云端歌单 ID 查找本地歌单 */
  const getPlaylistByCloudId = (cloudId: number) =>
    playlists.value.find(item => item.cloudId === cloudId);

  const getPlaylistById = (playlistId: string) =>
    playlists.value.find(item => item.id === playlistId);

  const addToPlaylist = (playlistId: string, path: string) => {
    const playlist = getPlaylistById(playlistId);
    if (playlist && !playlist.songPaths.includes(path)) {
      playlist.songPaths.push(path);
      return true;
    }

    return false;
  };

  const removeFromPlaylist = (playlistId: string, path: string) => {
    const playlist = getPlaylistById(playlistId);
    if (!playlist) {
      return false;
    }

    const beforeLength = playlist.songPaths.length;
    playlist.songPaths = playlist.songPaths.filter(songPath => songPath !== path);
    return beforeLength !== playlist.songPaths.length;
  };

  const addSongsToPlaylist = (playlistId: string, songPaths: string[], fullSongs?: Song[]) => {
    const playlist = getPlaylistById(playlistId);
    if (!playlist) {
      return 0;
    }

    // 使用 Set 实现 O(1) 去重，替代 O(n) includes，避免大批量添加时的 O(n×m) 嵌套循环
    let addedCount = 0;
    const existingPaths = new Set(playlist.songPaths);
    for (const path of songPaths) {
      if (!existingPaths.has(path)) {
        playlist.songPaths.push(path);
        existingPaths.add(path);
        addedCount += 1;
      }
    }

    // 同时缓存完整 Song 对象（在线歌曲需要，确保重启后仍可显示和播放）
    if (fullSongs && fullSongs.length > 0) {
      if (!playlist.songs) {
        playlist.songs = [];
      }
      const existingSongPaths = new Set(playlist.songs.map(s => s.path));
      for (const song of fullSongs) {
        if (song?.path && !existingSongPaths.has(song.path)) {
          playlist.songs.push({ ...song });
          existingSongPaths.add(song.path);
        }
      }
    }

    return addedCount;
  };

  const reorderPlaylists = (from: number, to: number) => {
    const list = [...playlists.value];
    const [removed] = list.splice(from, 1);
    if (!removed) {
      return;
    }

    list.splice(to, 0, removed);
    playlists.value = list;
  };

  const getSongsFromPlaylist = (playlistId: string): Song[] => {
    const libraryStore = useLibraryStore();
    const playlist = getPlaylistById(playlistId);
    if (!playlist) {
      return [];
    }

    // 优先使用完整歌曲对象缓存（插件导入等非本地来源）
    if (playlist.songs && playlist.songs.length > 0) {
      return [...playlist.songs];
    }

    // 回退到按 path 从 libraryStore 查找
    // 使用 songLookup（与歌单详情页一致），以包含 songPool 中的在线收藏歌曲
    const lookup = libraryStore.songLookup;
    return playlist.songPaths
      .map(path => lookup.get(path))
      .filter((song): song is Song => !!song);
  };

  // 预计算 Set 实现 O(1) 收藏状态查询，替代每行 O(n) includes
  const favoritePathSet = computed(() => new Set(favoritePaths.value));

  const isFavoritePath = (path: string | null | undefined) => {
    if (!path) {
      return false;
    }

    return favoritePathSet.value.has(path);
  };

  const toggleFavoritePath = (path: string) => {
    if (isFavoritePath(path)) {
      favoritePaths.value = favoritePaths.value.filter(item => item !== path);
      return false;
    }

    favoritePaths.value.push(path);
    return true;
  };

  /** 保存在线收藏歌曲的完整元信息 */
  const setFavoriteSongMeta = (path: string, song: Song) => {
    if (!path || !song) {
      return;
    }

    favoriteSongMeta.value = { ...favoriteSongMeta.value, [path]: song };
  };

  /** 移除某首在线收藏歌曲的元信息 */
  const removeFavoriteSongMeta = (path: string) => {
    if (!path || !(path in favoriteSongMeta.value)) {
      return;
    }

    const next = { ...favoriteSongMeta.value };
    delete next[path];
    favoriteSongMeta.value = next;
  };

  /** 整体替换在线收藏元信息（启动恢复时用） */
  const setFavoriteSongMetaMap = (map: Record<string, Song>) => {
    favoriteSongMeta.value = map ?? {};
  };

  const removeFavoritePaths = (paths: string[]) => {
    if (paths.length === 0) {
      return;
    }

    const blocked = new Set(paths);
    favoritePaths.value = favoritePaths.value.filter(path => !blocked.has(path));

    const nextMeta = { ...favoriteSongMeta.value };
    let metaChanged = false;
    paths.forEach((path) => {
      if (path in nextMeta) {
        delete nextMeta[path];
        metaChanged = true;
      }
    });
    if (metaChanged) {
      favoriteSongMeta.value = nextMeta;
    }
  };

  const clearFavorites = () => {
    favoritePaths.value = [];
    favoriteSongMeta.value = {};
    favoriteCollections.value = [];
  };

  /** 歌单/专辑整张是否已收藏 */
  const isCollectionFavorited = (key: string) =>
    favoriteCollections.value.some(entry => entry.key === key);

  /** 收藏/取消收藏整张歌单或专辑，返回收藏后的状态 */
  const toggleFavoriteCollection = (entry: FavoriteCollectionEntry) => {
    const index = favoriteCollections.value.findIndex(item => item.key === entry.key);
    if (index >= 0) {
      favoriteCollections.value.splice(index, 1);
      return false;
    }

    favoriteCollections.value.unshift({ ...entry, favoritedAt: Date.now() });
    return true;
  };

  const removeFavoriteCollection = (key: string) => {
    favoriteCollections.value = favoriteCollections.value.filter(entry => entry.key !== key);
  };

  const addRecentSong = (song: Song) => {
    recentSongs.value = recentSongs.value.filter(item => item.path !== song.path);
    recentSongs.value.unshift({ path: song.path, playedAt: Date.now() });

    if (recentSongs.value.length > RECENT_SONG_LIMIT) {
      const removed = recentSongs.value.slice(RECENT_SONG_LIMIT);
      recentSongs.value = recentSongs.value.slice(0, RECENT_SONG_LIMIT);
      // 超出上限被裁掉的在线歌曲，同步清理其元信息，避免无用堆积
      if (removed.length > 0) {
        const kept = new Set(recentSongs.value.map(item => item.path));
        const nextMeta = { ...recentSongMeta.value };
        let metaChanged = false;
        removed.forEach((item) => {
          if (!kept.has(item.path) && item.path in nextMeta) {
            delete nextMeta[item.path];
            metaChanged = true;
          }
        });
        if (metaChanged) {
          recentSongMeta.value = nextMeta;
        }
      }
    }
  };

  /** 保存在线最近播放歌曲的完整元信息 */
  const setRecentSongMeta = (path: string, song: Song) => {
    if (!path || !song) {
      return;
    }

    recentSongMeta.value = { ...recentSongMeta.value, [path]: song };
  };

  /** 移除某首在线最近播放歌曲的元信息 */
  const removeRecentSongMeta = (path: string) => {
    if (!path || !(path in recentSongMeta.value)) {
      return;
    }

    const next = { ...recentSongMeta.value };
    delete next[path];
    recentSongMeta.value = next;
  };

  /** 整体替换在线最近播放元信息（启动恢复时用） */
  const setRecentSongMetaMap = (map: Record<string, Song>) => {
    recentSongMeta.value = map ?? {};
  };

  const removeRecentSongs = (songPaths: string[]) => {
    if (songPaths.length === 0) {
      return;
    }

    const blocked = new Set(songPaths);
    recentSongs.value = recentSongs.value.filter(item => !blocked.has(item.path));

    const nextMeta = { ...recentSongMeta.value };
    let metaChanged = false;
    songPaths.forEach((path) => {
      if (path in nextMeta) {
        delete nextMeta[path];
        metaChanged = true;
      }
    });
    if (metaChanged) {
      recentSongMeta.value = nextMeta;
    }
  };

  const clearRecentSongs = () => {
    recentSongs.value = [];
    recentSongMeta.value = {};
  };

  return {
    favoritePaths,
    favoriteSongMeta,
    recentSongMeta,
    playlists,
    recentSongs,
    playlistSortMode,
    favoriteCollections,
    setFavoritePaths,
    setFavoriteCollections,
    setPlaylists,
    setRecentSongs,
    createPlaylist,
    deletePlaylist,
    renamePlaylist,
    setPlaylistCover,
    setPlaylistCloudId,
    setPlaylistCloudCoverUrl,
    getPlaylistByCloudId,
    getPlaylistById,
    addToPlaylist,
    removeFromPlaylist,
    addSongsToPlaylist,
    reorderPlaylists,
    getSongsFromPlaylist,
    isFavoritePath,
    toggleFavoritePath,
    setFavoriteSongMeta,
    removeFavoriteSongMeta,
    setFavoriteSongMetaMap,
    removeFavoritePaths,
    clearFavorites,
    isCollectionFavorited,
    toggleFavoriteCollection,
    removeFavoriteCollection,
    addRecentSong,
    setRecentSongMeta,
    removeRecentSongMeta,
    setRecentSongMetaMap,
    removeRecentSongs,
    clearRecentSongs,
  };
});
