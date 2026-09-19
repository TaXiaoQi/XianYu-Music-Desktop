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

export const resolveOnlineCollectionPlatformId = (
  ctx: { type: 'playlist' | 'album' | 'artist' | 'user'; rawData?: any; platformId?: string },
): string => {
  if (ctx.platformId) {
    const pid = String(ctx.platformId).trim();
    if (pid) return pid;
  }

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

export const buildLocalPlaylistCollectionKey = (playlistId: string) =>
  `local:playlist:${playlistId}`;

export const useCollectionsStore = defineStore('collections', () => {
  const RECENT_SONG_LIMIT = 200;
  const favoritePaths = ref<string[]>([]);
  const favoriteSongMeta = ref<Record<string, Song>>({});
  const recentSongMeta = ref<Record<string, Song>>({});
  const playlists = ref<Playlist[]>([]);
  const recentSongs = ref<HistoryItem[]>([]);
  const playlistSortMode = ref<PlaylistSortMode>('custom');
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

  const setPlaylistCloudId = (id: string, cloudId?: string) => {
    const playlist = getPlaylistById(id);
    if (playlist) {
      playlist.cloudId = cloudId && cloudId.length > 0 ? cloudId : undefined;
      return true;
    }
    return false;
  };

  const setPlaylistCloudCoverUrl = (id: string, cloudCoverUrl: string) => {
    const playlist = getPlaylistById(id);
    if (playlist) {
      playlist.cloudCoverUrl = cloudCoverUrl;
      return true;
    }
    return false;
  };

  const getPlaylistByCloudId = (cloudId?: string) =>
    cloudId ? playlists.value.find(item => item.cloudId === cloudId) : undefined;

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

    let addedCount = 0;
    const existingPaths = new Set(playlist.songPaths);
    for (const path of songPaths) {
      if (!existingPaths.has(path)) {
        playlist.songPaths.push(path);
        existingPaths.add(path);
        addedCount += 1;
      }
    }

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

    if (playlist.songs && playlist.songs.length > 0) {
      return [...playlist.songs];
    }

    const lookup = libraryStore.songLookup;
    return playlist.songPaths
      .map(path => lookup.get(path))
      .filter((song): song is Song => !!song);
  };

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

  const setFavoriteSongMeta = (path: string, song: Song) => {
    if (!path || !song) {
      return;
    }

    favoriteSongMeta.value = { ...favoriteSongMeta.value, [path]: song };
  };

  const removeFavoriteSongMeta = (path: string) => {
    if (!path || !(path in favoriteSongMeta.value)) {
      return;
    }

    const next = { ...favoriteSongMeta.value };
    delete next[path];
    favoriteSongMeta.value = next;
  };

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

  const isCollectionFavorited = (key: string) =>
    favoriteCollections.value.some(entry => entry.key === key);

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

  const setRecentSongMeta = (path: string, song: Song) => {
    if (!path || !song) {
      return;
    }

    recentSongMeta.value = { ...recentSongMeta.value, [path]: song };
  };

  const removeRecentSongMeta = (path: string) => {
    if (!path || !(path in recentSongMeta.value)) {
      return;
    }

    const next = { ...recentSongMeta.value };
    delete next[path];
    recentSongMeta.value = next;
  };

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
