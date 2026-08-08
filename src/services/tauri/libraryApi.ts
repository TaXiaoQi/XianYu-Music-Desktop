import type {
  AlbumCatalogItem,
  ArtistCatalogItem,
  FolderNode,
  LibraryFolder,
  LibrarySong,
  Playlist,
  RecentAlbumCatalogItem,
  RecentPlaylistCatalogItem,
  SaveArtistAvatarResponse,
  SongDetail,
} from '../../types';
import type { GeneratedFolder, RecentHistoryImportRecord } from './contracts';
import { tauriInvoke } from './invoke';

type LibrarySortMode =
  | 'title'
  | 'artist'
  | 'added_at'
  | 'added_at_asc'
  | 'file_modified_at'
  | 'file_modified_at_asc';
type FolderViewSortMode =
  | 'title'
  | 'name'
  | 'artist'
  | 'added_at'
  | 'added_at_asc'
  | 'track_number';

export const libraryApi = {
  getLibraryFolders: (): Promise<LibraryFolder[]> => tauriInvoke('get_library_folders'),
  getLibraryHierarchy: (): Promise<FolderNode[]> => tauriInvoke('get_library_hierarchy'),
  getFolderChildren: (folderPath: string): Promise<FolderNode[]> =>
    tauriInvoke('get_folder_children', { folderPath }),
  addLibraryFolder: (path: string): Promise<void> => tauriInvoke('add_library_folder', { path }),
  removeLibraryFolder: (path: string): Promise<void> => tauriInvoke('remove_library_folder', { path }),
  createFolder: (parentPath: string, folderName: string) =>
    tauriInvoke('create_folder', { parentPath, folderName }),
  refreshFolderSongs: (folderPath: string, minimumDurationSeconds = 0) =>
    tauriInvoke('refresh_folder_songs', { folderPath, minimumDurationSeconds }),
  getLibrarySongsCached: (): Promise<LibrarySong[]> => tauriInvoke('get_library_songs_cached'),
  getLibraryArtistCatalog: (): Promise<ArtistCatalogItem[]> => tauriInvoke('get_library_artist_catalog'),
  getLibraryAlbumCatalog: (): Promise<AlbumCatalogItem[]> => tauriInvoke('get_library_album_catalog'),
  scanLibrary: (minimumDurationSeconds?: number | null): Promise<LibrarySong[]> =>
    tauriInvoke('scan_library', { minimumDurationSeconds }),
  searchLibrarySongs: (query: string, limit?: number): Promise<LibrarySong[]> =>
    tauriInvoke('search_library_songs', { query, limit }),
  saveArtistAvatar: (
    artistId: number,
    imagePath: string,
    writeToTags: boolean,
  ): Promise<SaveArtistAvatarResponse> =>
    tauriInvoke('save_artist_avatar', { artistId, imagePath, writeToTags }),
  scanFolderAsPlaylists: (
    rootPath: string,
    minimumDurationSeconds?: number | null,
  ): Promise<GeneratedFolder[]> =>
    tauriInvoke('scan_folder_as_playlists', { rootPath, minimumDurationSeconds }),
  getLibrarySongPathsByArtist: (artistName: string): Promise<string[]> =>
    tauriInvoke('get_library_song_paths_by_artist', { artistName }),
  getLibrarySongPathsByAlbum: (albumKey: string): Promise<string[]> =>
    tauriInvoke('get_library_song_paths_by_album', { albumKey }),
  getLibrarySongPathsForFolderView: (
    folderPath: string,
    query: string,
    sortMode: FolderViewSortMode,
  ): Promise<string[]> =>
    tauriInvoke('get_library_song_paths_for_folder_view', { folderPath, query, sortMode }),
  getLibrarySongPathsForAllView: (
    query: string,
    artistFilter: string,
    albumFilter: string,
    sortMode: LibrarySortMode,
  ): Promise<string[]> =>
    tauriInvoke('get_library_song_paths_for_all_view', {
      query,
      artistFilter,
      albumFilter,
      sortMode,
    }),
  getFavoriteSongPathsView: (
    favoritePaths: string[],
    query: string,
    sortMode: LibrarySortMode,
    detailFilterType?: 'artist' | 'album',
    detailFilterValue?: string,
  ): Promise<string[]> =>
    tauriInvoke('get_favorite_song_paths_view', {
      favoritePaths,
      query,
      sortMode,
      detailFilterType,
      detailFilterValue,
    }),
  getRecentSongPathsView: (
    recentEntries: RecentHistoryImportRecord[],
    query: string,
    sortMode: LibrarySortMode,
  ): Promise<string[]> =>
    tauriInvoke('get_recent_song_paths_view', { recentEntries, query, sortMode }),
  getFavoriteArtistCatalog: (favoritePaths: string[]): Promise<ArtistCatalogItem[]> =>
    tauriInvoke('get_favorite_artist_catalog', { favoritePaths }),
  getFavoriteAlbumCatalog: (favoritePaths: string[]): Promise<AlbumCatalogItem[]> =>
    tauriInvoke('get_favorite_album_catalog', { favoritePaths }),
  getRecentAlbumCatalog: (
    recentEntries: RecentHistoryImportRecord[],
  ): Promise<RecentAlbumCatalogItem[]> =>
    tauriInvoke('get_recent_album_catalog', { recentEntries }),
  getRecentPlaylistCatalog: (
    playlists: Playlist[],
    recentEntries: RecentHistoryImportRecord[],
  ): Promise<RecentPlaylistCatalogItem[]> =>
    tauriInvoke('get_recent_playlist_catalog', { playlists, recentEntries }),
  getSongDetail: (path: string): Promise<SongDetail> =>
    tauriInvoke('get_song_detail', { path }),
};
