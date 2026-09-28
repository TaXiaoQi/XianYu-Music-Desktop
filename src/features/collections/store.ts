import { ref, computed } from 'vue';
import { defineStore } from 'pinia';

import type { PlaylistSortMode } from '../../services/storage/playerStorage';
import type { HistoryItem, Playlist, Song } from '../../types';
import type { OnlineDetailContext } from '../onlineDetail/store';
import { useLibraryStore } from '../library/store';

/** 生成歌单的建档日期（本地时区 YYYY-MM-DD）。 */
const todayStamp = () => {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

/** 从一组候选值里取第一个可转成非空字符串的。 */
const firstNonEmptyString = (candidates: unknown[]): string => {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const text = String(candidate).trim();
    if (text !== '') return text;
  }
  return '';
};

export interface FavoriteCollectionEntry {
  key: string;
  type: 'playlist' | 'album';
  title: string;
  subtitle: string;
  coverUrl: string;
  favoritedAt: number;
  onlineContext?: OnlineDetailContext | null;
  localPlaylistId?: string;
}

/** 拼在线合集的收藏键：引擎前缀 + 合集类型 + 平台侧 id。 */
export const buildOnlineCollectionKey = (
  ctx: {
    type: 'playlist' | 'album';
    engineType?: 'musicfree' | 'lx' | null;
    lxSourceId?: string | null;
    pluginSource?: { id: string } | null;
  },
  platformId: string,
): string => {
  const engineTag = ctx.engineType === 'lx'
    ? `lx:${ctx.lxSourceId ?? ''}`
    : `mf:${ctx.pluginSource?.id ?? ''}`;
  return `online:${engineTag}:${ctx.type}:${platformId}`;
};

/** 尽力从原始数据里解析出平台侧合集 id。 */
export const resolveOnlineCollectionPlatformId = (
  ctx: { type: 'playlist' | 'album' | 'artist' | 'user'; rawData?: any; platformId?: string },
): string => {
  const explicitId = ctx.platformId !== undefined ? String(ctx.platformId).trim() : '';
  if (explicitId !== '') return explicitId;

  const raw = ctx.rawData;
  if (!raw || typeof raw !== 'object') {
    return '';
  }

  const albumFields = [raw.albumId, raw.albumID, raw.AlbumID, raw.albumMID, raw.albumMid, raw.id, raw.ID];
  const playlistFields = [
    raw.id, raw.ID, raw.playlistId, raw.playlistid, raw.specialid,
    raw.dissid, raw.disstid, raw.songListId, raw.songlistId, raw.rid,
  ];

  return firstNonEmptyString(ctx.type === 'album' ? albumFields : playlistFields);
};

export const buildLocalPlaylistCollectionKey = (playlistId: string) =>
  `local:playlist:${playlistId}`;

/* —— store 内部的纯函数工具 —— */

/** 整库全量同步时，剔除源端已删除且非本软件内添加的歌曲。返回剔除数量。 */
function pruneDeletedSourceSongs(playlist: Playlist, sourceKeys: Set<string>): number {
  const metaList = playlist.songs ?? [];
  const removablePaths = new Set(
    metaList
      .filter(song => !song.addedInApp && !sourceKeys.has(song.path))
      .map(song => song.path),
  );
  if (removablePaths.size === 0) return 0;

  const sizeBefore = playlist.songPaths.length;
  playlist.songPaths = playlist.songPaths.filter(path => !removablePaths.has(path));
  const keptMeta = metaList.filter(song => !removablePaths.has(song.path));
  playlist.songs = keptMeta.length > 0 ? keptMeta : undefined;
  return sizeBefore - playlist.songPaths.length;
}

/** 把源端新歌曲追加进歌单（路径表 + 元数据表）。返回新增数量。 */
function appendIncomingSourceSongs(playlist: Playlist, sourceSongs: Song[]): number {
  const knownPaths = new Set(playlist.songPaths);
  const knownMetaPaths = new Set((playlist.songs ?? []).map(song => song.path));
  let appended = 0;

  for (const song of sourceSongs) {
    if (!song.path || knownPaths.has(song.path)) continue;

    playlist.songPaths.push(song.path);
    knownPaths.add(song.path);
    appended += 1;

    if (!knownMetaPaths.has(song.path)) {
      if (!playlist.songs) {
        playlist.songs = [];
      }
      playlist.songs.push({ ...song });
      knownMetaPaths.add(song.path);
    }
  }
  return appended;
}

/** 向歌单元数据表合并歌曲；markAddedInApp 时打上「本软件内添加」标记。 */
function mergeSongMeta(playlist: Playlist, songs: Song[], markAddedInApp: boolean) {
  if (!playlist.songs) {
    playlist.songs = [];
  }
  const knownMetaPaths = new Set(playlist.songs.map(song => song.path));

  for (const song of songs) {
    if (!song?.path || knownMetaPaths.has(song.path)) continue;
    playlist.songs!.push(markAddedInApp ? { ...song, addedInApp: true } : { ...song });
    knownMetaPaths.add(song.path);
  }
}

export const useCollectionsStore = defineStore('collections', () => {
  // 最近播放历史上限（超出后淘汰最旧记录并清理孤儿元数据）。
  const RECENT_HISTORY_CAP = 200;

  const favoritePaths = ref<string[]>([]);
  const favoriteSongMeta = ref<Record<string, Song>>({});
  const recentSongMeta = ref<Record<string, Song>>({});
  const playlists = ref<Playlist[]>([]);
  const recentSongs = ref<HistoryItem[]>([]);
  const playlistSortMode = ref<PlaylistSortMode>('custom');
  const favoriteCollections = ref<FavoriteCollectionEntry[]>([]);

  /** 按 id 在歌单表中定位（内部统一入口）。 */
  const locatePlaylist = (playlistId: string) =>
    playlists.value.find(item => item.id === playlistId);

  const setFavoritePaths = (paths: string[]) => { favoritePaths.value = paths; };
  const setFavoriteCollections = (entries: FavoriteCollectionEntry[]) => { favoriteCollections.value = entries ?? []; };
  const setPlaylists = (nextPlaylists: Playlist[]) => { playlists.value = nextPlaylists; };
  const setRecentSongs = (historyItems: HistoryItem[]) => { recentSongs.value = historyItems; };

  const createPlaylist = (name: string, initialSongs: string[] = [], fullSongs?: Song[]) => {
    if (name.trim() === '') {
      return null;
    }

    const playlist: Playlist = {
      id: `${Date.now()}${Math.random().toString().slice(2)}`,
      name,
      songPaths: [...initialSongs],
      createdAt: todayStamp(),
      songs: fullSongs?.length ? [...fullSongs] : undefined,
    };

    playlists.value.push(playlist);
    return playlist.id;
  };

  const deletePlaylist = (id: string) => {
    const remaining = playlists.value.filter(entry => entry.id !== id);
    const didRemove = remaining.length !== playlists.value.length;
    playlists.value = remaining;
    return didRemove;
  };

  const renamePlaylist = (id: string, name: string) => {
    const target = locatePlaylist(id);
    const nextName = name.trim();
    if (!target || nextName === '') {
      return false;
    }
    target.name = nextName;
    return true;
  };

  const setPlaylistCover = (id: string, coverPath: string | null) => {
    const target = locatePlaylist(id);
    if (!target) return false;

    if (coverPath === null) {
      target.coverPath = undefined;
    } else {
      target.coverPath = coverPath;
    }
    return true;
  };

  const setPlaylistCloudId = (id: string, cloudId?: string) => {
    const target = locatePlaylist(id);
    if (!target) return false;

    target.cloudId = cloudId && cloudId.length > 0 ? cloudId : undefined;
    return true;
  };

  const setPlaylistCloudCoverUrl = (id: string, cloudCoverUrl: string) => {
    const target = locatePlaylist(id);
    if (!target) return false;

    target.cloudCoverUrl = cloudCoverUrl;
    return true;
  };

  const setPlaylistSource = (
    id: string,
    source: { sourcePluginId?: string; sourceUrl?: string; sourceRaw?: any } | null,
  ) => {
    const target = locatePlaylist(id);
    if (!target) {
      return false;
    }

    // 缺少任何有效来源字段时视为「清除来源」。
    if (!source || (!source.sourcePluginId && !source.sourceUrl)) {
      target.sourcePluginId = undefined;
      target.sourceUrl = undefined;
      target.sourceRaw = undefined;
      return false;
    }

    target.sourcePluginId = source.sourcePluginId;
    target.sourceUrl = source.sourceUrl;
    target.sourceRaw = source.sourceRaw;
    return true;
  };

  // 从源端同步导入的歌单：添加源端新歌曲；完全同步时移除源端已删除的歌曲。
  // 本软件内手动添加的歌曲（addedInApp）与无元数据（path-only）的歌曲不参与删除。
  const applySourceSync = (id: string, sourceSongs: Song[], fullSync: boolean) => {
    const target = locatePlaylist(id);
    if (!target) {
      return { added: 0, removed: 0 };
    }

    const sourceKeys = new Set(sourceSongs.map(song => song.path));
    const removedCount = fullSync ? pruneDeletedSourceSongs(target, sourceKeys) : 0;
    const addedCount = appendIncomingSourceSongs(target, sourceSongs);

    return { added: addedCount, removed: removedCount };
  };

  const getPlaylistByCloudId = (cloudId?: string) =>
    cloudId ? playlists.value.find(item => item.cloudId === cloudId) : undefined;

  const addToPlaylist = (playlistId: string, path: string) => {
    const target = locatePlaylist(playlistId);
    if (!target || target.songPaths.includes(path)) {
      return false;
    }

    target.songPaths.push(path);
    return true;
  };

  const removeFromPlaylist = (playlistId: string, path: string) => {
    const target = locatePlaylist(playlistId);
    if (!target) {
      return false;
    }

    const sizeBefore = target.songPaths.length;
    target.songPaths = target.songPaths.filter(entry => entry !== path);
    return target.songPaths.length !== sizeBefore;
  };

  const addSongsToPlaylist = (playlistId: string, songPaths: string[], fullSongs?: Song[]) => {
    const target = locatePlaylist(playlistId);
    if (!target) {
      return 0;
    }

    let addedCount = 0;
    const alreadyIn = new Set(target.songPaths);
    for (const path of songPaths) {
      if (alreadyIn.has(path)) continue;
      target.songPaths.push(path);
      alreadyIn.add(path);
      addedCount += 1;
    }

    if (fullSongs && fullSongs.length > 0) {
      mergeSongMeta(target, fullSongs, true);
    }

    return addedCount;
  };

  const reorderPlaylists = (from: number, to: number) => {
    const next = [...playlists.value];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) {
      return;
    }

    next.splice(to, 0, moved);
    playlists.value = next;
  };

  const getSongsFromPlaylist = (playlistId: string): Song[] => {
    const target = locatePlaylist(playlistId);
    if (!target) {
      return [];
    }

    // 元数据齐全时直接返回副本，缺元数据再回查本地曲库。
    if (target.songs && target.songs.length > 0) {
      return [...target.songs];
    }

    const lookup = useLibraryStore().songLookup;
    const resolved: Song[] = [];
    for (const path of target.songPaths) {
      const hit = lookup.get(path);
      if (hit) resolved.push(hit);
    }
    return resolved;
  };

  /* —— 本地歌曲收藏 —— */

  const favoritedIndex = computed(() => new Set(favoritePaths.value));

  const isFavoritePath = (path: string | null | undefined) =>
    !!path && favoritedIndex.value.has(path);

  const toggleFavoritePath = (path: string) => {
    if (!favoritedIndex.value.has(path)) {
      favoritePaths.value.push(path);
      return true;
    }

    favoritePaths.value = favoritePaths.value.filter(entry => entry !== path);
    return false;
  };

  const setFavoriteSongMeta = (path: string, song: Song) => {
    if (path === '' || !song) {
      return;
    }
    favoriteSongMeta.value = { ...favoriteSongMeta.value, [path]: song };
  };

  const removeFavoriteSongMeta = (path: string) => {
    if (path === '' || !(path in favoriteSongMeta.value)) {
      return;
    }

    const nextTable = { ...favoriteSongMeta.value };
    delete nextTable[path];
    favoriteSongMeta.value = nextTable;
  };

  const setFavoriteSongMetaMap = (map: Record<string, Song>) => {
    favoriteSongMeta.value = map ?? {};
  };

  const removeFavoritePaths = (paths: string[]) => {
    if (paths.length === 0) {
      return;
    }

    const doomed = new Set(paths);
    favoritePaths.value = favoritePaths.value.filter(path => !doomed.has(path));

    const nextTable = { ...favoriteSongMeta.value };
    let touched = false;
    for (const path of paths) {
      if (path in nextTable) {
        delete nextTable[path];
        touched = true;
      }
    }
    if (touched) {
      favoriteSongMeta.value = nextTable;
    }
  };

  const clearFavorites = () => {
    favoritePaths.value = [];
    favoriteSongMeta.value = {};
    favoriteCollections.value = [];
  };

  /* —— 收藏的在线合集 —— */

  const isCollectionFavorited = (key: string) =>
    favoriteCollections.value.findIndex(entry => entry.key === key) !== -1;

  const toggleFavoriteCollection = (entry: FavoriteCollectionEntry) => {
    const existingAt = favoriteCollections.value.findIndex(item => item.key === entry.key);
    if (existingAt !== -1) {
      favoriteCollections.value.splice(existingAt, 1);
      return false;
    }

    favoriteCollections.value.unshift({ ...entry, favoritedAt: Date.now() });
    return true;
  };

  const removeFavoriteCollection = (key: string) => {
    favoriteCollections.value = favoriteCollections.value.filter(entry => entry.key !== key);
  };

  /* —— 最近播放 —— */

  const addRecentSong = (song: Song) => {
    const remaining = recentSongs.value.filter(entry => entry.path !== song.path);
    recentSongs.value = [{ path: song.path, playedAt: Date.now() }, ...remaining];

    if (recentSongs.value.length <= RECENT_HISTORY_CAP) {
      return;
    }

    const overflowEntries = recentSongs.value.splice(RECENT_HISTORY_CAP);
    if (overflowEntries.length === 0) {
      return;
    }

    // 被挤出历史的条目：若其路径已不在历史中，则连元数据一并清掉。
    const survivingPaths = new Set(recentSongs.value.map(entry => entry.path));
    const nextTable = { ...recentSongMeta.value };
    let touched = false;
    for (const entry of overflowEntries) {
      if (entry.path in nextTable && !survivingPaths.has(entry.path)) {
        delete nextTable[entry.path];
        touched = true;
      }
    }
    if (touched) {
      recentSongMeta.value = nextTable;
    }
  };

  const setRecentSongMeta = (path: string, song: Song) => {
    if (path === '' || !song) {
      return;
    }
    recentSongMeta.value = { ...recentSongMeta.value, [path]: song };
  };

  const removeRecentSongMeta = (path: string) => {
    if (path === '' || !(path in recentSongMeta.value)) {
      return;
    }

    const nextTable = { ...recentSongMeta.value };
    delete nextTable[path];
    recentSongMeta.value = nextTable;
  };

  const setRecentSongMetaMap = (map: Record<string, Song>) => {
    recentSongMeta.value = map ?? {};
  };

  const removeRecentSongs = (songPaths: string[]) => {
    if (songPaths.length === 0) {
      return;
    }

    const doomed = new Set(songPaths);
    recentSongs.value = recentSongs.value.filter(entry => !doomed.has(entry.path));

    const nextTable = { ...recentSongMeta.value };
    let touched = false;
    for (const path of songPaths) {
      if (path in nextTable) {
        delete nextTable[path];
        touched = true;
      }
    }
    if (touched) {
      recentSongMeta.value = nextTable;
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
    setPlaylistSource,
    applySourceSync,
    getPlaylistByCloudId,
    getPlaylistById: (playlistId: string) => locatePlaylist(playlistId),
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
