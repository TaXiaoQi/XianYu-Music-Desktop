import type { Song } from '../types';
import type { PlaylistImportResult } from '../services/domain/playlistImport';
import { importResultToSongs } from '../services/domain/playlistSourceUpdate';
import { matchSongsToLocalLibrary, type ImportedPlaylist } from '../services/domain/backupImport';
import type { PreparedPluginBackupImport } from '../services/domain/pluginBackupImport';
import { cacheLxSong } from '../services/domain/lxSongCache';
import { useLibraryStore } from '../features/library/store';
import { useToast } from './toast';

type CreatePlaylistFn = (name: string, initialSongs?: string[], fullSongs?: Song[]) => string | null;

interface SetPlaylistSourceFn {
  (id: string, source: { sourcePluginId?: string; sourceUrl?: string; sourceRaw?: any } | null): void;
}

interface SidebarImportConfirmersOptions {
  createPlaylist: CreatePlaylistFn;
  setPlaylistSource: SetPlaylistSourceFn;
}

/**
 * 侧边栏四类歌单导入入口的确认落库逻辑：
 * 插件歌单导入 / 本地文件夹导入 / 备份文件导入 / 在线插件备份导入。
 */
export function useSidebarImportConfirmers({ createPlaylist, setPlaylistSource }: SidebarImportConfirmersOptions) {
  const libraryStore = useLibraryStore();
  const { showToast } = useToast();

  const reportCreateResult = (created: boolean, playlistName: string, songCount: number) => {
    if (created) {
      showToast(`已创建歌单「${playlistName}」，共 ${songCount} 首歌曲`, 'success');
    } else {
      showToast('创建歌单失败', 'error');
    }
  };

  /** 插件歌单导入：转换曲目、缓存 lx 元数据并登记额外曲目 */
  const confirmImportPlaylist = (payload: { result: PlaylistImportResult; rename?: string }) => {
    const { result, rename } = payload;
    if (result.songs.length === 0) {
      return;
    }

    const songs = importResultToSongs(result.songs);
    const songPaths = songs.map((item) => item.path);

    songs.forEach((song) => {
      const raw = song.rawData as any;
      if (raw && raw.source && raw.songmid) {
        cacheLxSong({
          name: raw.name || song.name,
          singer: raw.singer || song.artist,
          albumName: song.album || '',
          albumId: '',
          songmid: raw.songmid,
          source: raw.source,
          interval: raw.interval || '',
          img: song.cover_thumb_path || null,
          types: [],
          _types: {},
          hash: raw.hash,
          strMediaMid: raw.strMediaMid,
          songId: raw.songId,
          albumMid: raw.albumMid,
        });
      }
    });

    songs.forEach((song) => {
      libraryStore.setExtraSong(song);
    });

    const playlistName = rename || result.info.name || '导入的歌单';
    const playlistId = createPlaylist(playlistName, songPaths, songs);
    if (playlistId) {
      setPlaylistSource(playlistId, result.sourceRef ?? null);
    }
    reportCreateResult(Boolean(playlistId), playlistName, songPaths.length);
  };

  /** 本地文件夹导入：直接登记曲目并建单 */
  const confirmLocalFolderImport = (payload: { name: string; songs: Song[] }) => {
    const playlistName = payload.name.trim();
    if (!playlistName || payload.songs.length === 0) {
      return;
    }

    const songPaths = payload.songs.map((song) => song.path);
    payload.songs.forEach((song) => {
      libraryStore.setExtraSong(song);
    });

    const playlistId = createPlaylist(playlistName, songPaths, payload.songs);
    reportCreateResult(Boolean(playlistId), playlistName, songPaths.length);
  };

  /** 备份文件导入：按本地库匹配曲目后批量建单 */
  const confirmBackupImport = (playlists: ImportedPlaylist[]) => {
    if (playlists.length === 0) {
      return;
    }

    const { playlists: matchedPlaylists, matchedCount, unmatchedCount } =
      matchSongsToLocalLibrary(playlists, libraryStore.canonicalSongs);

    const localLowerPathIndex = new Set(
      libraryStore.canonicalSongs.map((item) => item.path.toLowerCase()),
    );

    let createdCount = 0;
    let totalSongs = 0;
    const songsOutsideLibrary: Song[] = [];

    matchedPlaylists.forEach((pl) => {
      const playlistName = pl.name.trim();
      if (!playlistName || pl.songs.length === 0) {
        return;
      }

      const songPaths = pl.songs.map((song) => song.path);
      pl.songs.forEach((song) => {
        if (!localLowerPathIndex.has(song.path.toLowerCase())) {
          songsOutsideLibrary.push(song);
        }
      });

      const playlistId = createPlaylist(playlistName, songPaths, pl.songs);
      if (playlistId) {
        createdCount += 1;
        totalSongs += songPaths.length;
      }
    });

    if (songsOutsideLibrary.length > 0) {
      libraryStore.setExtraSongs(songsOutsideLibrary);
    }

    if (createdCount > 0) {
      const message = unmatchedCount > 0
        ? `已创建 ${createdCount} 个歌单，匹配 ${matchedCount} 首，${unmatchedCount} 首未匹配本地文件`
        : `已创建 ${createdCount} 个歌单，共 ${totalSongs} 首歌曲`;
      showToast(message, 'success');
    } else {
      showToast('创建歌单失败', 'error');
    }
  };

  /** 在线插件备份导入：直接落库全部曲目 */
  const confirmOnlineBackupImport = (prepared: PreparedPluginBackupImport) => {
    if (prepared.playlists.length === 0) {
      showToast('没有可导入的歌单', 'info');
      return;
    }

    let createdCount = 0;
    const songsOutsideLibrary: Song[] = [];

    prepared.playlists.forEach((playlist) => {
      if (playlist.songs.length === 0) {
        return;
      }
      const songPaths = playlist.songs.map((song) => song.path);
      songsOutsideLibrary.push(...playlist.songs);
      const playlistId = createPlaylist(playlist.name, songPaths, playlist.songs);
      if (playlistId) {
        createdCount += 1;
      }
    });

    if (songsOutsideLibrary.length > 0) {
      libraryStore.setExtraSongs(songsOutsideLibrary);
    }

    if (createdCount > 0) {
      const message = prepared.failures.length > 0
        ? `已创建 ${createdCount} 个歌单，导入 ${prepared.importedSongCount} 首，${prepared.failures.length} 首未导入`
        : `已创建 ${createdCount} 个歌单，共 ${prepared.importedSongCount} 首歌曲`;
      showToast(message, 'success');
    } else {
      showToast('创建歌单失败', 'error');
    }
  };

  return {
    confirmImportPlaylist,
    confirmLocalFolderImport,
    confirmBackupImport,
    confirmOnlineBackupImport,
  };
}
