import { libraryApi } from '../services/tauri/libraryApi';
import { createSongPathChannel } from './libraryPathCacheKit';

// 歌手/专辑详情页停留时间更长，TTL 放宽到 10 分钟；容量取默认 96 条。
const detailChannel = createSongPathChannel({
  ttlMs: 10 * 60 * 1000,
});

const scopeSegment = (scope: string, value: string) => [scope, value].join('::');

export const useLibraryDetailSongPathCache = () => {
  const fetchArtistPaths = (artist: string): Promise<string[]> => {
    if (!artist) {
      return Promise.resolve([]);
    }

    return detailChannel.enqueue(scopeSegment('artist', artist), () =>
      libraryApi.getLibrarySongPathsByArtist(artist),
    );
  };

  const fetchAlbumPaths = (albumId: string): Promise<string[]> => {
    if (!albumId) {
      return Promise.resolve([]);
    }

    return detailChannel.enqueue(scopeSegment('album', albumId), () =>
      libraryApi.getLibrarySongPathsByAlbum(albumId),
    );
  };

  const api = {
    loadArtistSongPaths: fetchArtistPaths, loadAlbumSongPaths: fetchAlbumPaths,
    clearLibraryDetailSongPathCache: () => detailChannel.reset(),
    libraryDetailSongPathCacheVersion: detailChannel.changes,
  };
  return api;
};
