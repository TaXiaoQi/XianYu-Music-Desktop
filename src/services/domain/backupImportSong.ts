import type { Song } from '../../types';


export function decodeFileUrl(url: string): string {
  try {
    let path = url;
    if (path.startsWith('file:///')) {
      path = path.slice('file:///'.length);
    } else if (path.startsWith('file://')) {
      path = path.slice('file://'.length);
    }
    path = decodeURIComponent(path);
    path = path.replace(/\//g, '\\');
    return path;
  } catch {
    return url;
  }
}

export function resolveLocalPath(rawSong: any): string {
  if (rawSong.localPath && typeof rawSong.localPath === 'string') {
    return rawSong.localPath;
  }
  if (rawSong.url && typeof rawSong.url === 'string' && rawSong.url.startsWith('file:')) {
    return decodeFileUrl(rawSong.url);
  }
  if (rawSong.qualities && typeof rawSong.qualities === 'object') {
    for (const quality of Object.values(rawSong.qualities) as any[]) {
      if (quality?.url && typeof quality.url === 'string' && quality.url.startsWith('file:')) {
        return decodeFileUrl(quality.url);
      }
    }
  }
  return '';
}

export function convertBackupSong(rawSong: any): Song | null {
  const title = rawSong.title || rawSong.name || '';
  if (!title) return null;

  const artist = rawSong.artist || '未知歌手';
  const album = rawSong.album || '未知专辑';
  const duration = Math.floor(Number(rawSong.duration) || 0);

  const artistNames = artist
    ? artist.split(/[、,/&]/).filter(Boolean).map((s: string) => s.trim())
    : ['未知歌手'];

  const localPath = resolveLocalPath(rawSong);

  if (!localPath) {
    return null;
  }

  const song: Song = {
    name: title,
    title,
    path: localPath,
    artist,
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album,
    album_artist: artist,
    album_key: `${album}-${artist}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration,
    source_type: 'local',
  };

  if (rawSong.rawLrc && typeof rawSong.rawLrc === 'string') {
    song.lyrics_raw = rawSong.rawLrc;
  }

  if (rawSong.artwork && typeof rawSong.artwork === 'string') {
    song.cover_thumb_path = rawSong.artwork;
  }

  return song;
}

export function createSongFromPath(
  filePath: string,
  titleFromMeta: string,
  artistFromMeta: string,
  duration: number,
): Song | null {
  if (!filePath || filePath.trim().length === 0) return null;

  const trimmedPath = filePath.trim();
  const fileName = trimmedPath.split(/[\\/]/).pop() || trimmedPath;
  const baseName = fileName.replace(/\.[^.]+$/, '');

  let title = titleFromMeta;
  let artist = artistFromMeta;

  if (!title && baseName) {
    const dashIdx = baseName.lastIndexOf('-');
    if (dashIdx > 0) {
      title = baseName.slice(0, dashIdx).trim();
      artist = baseName.slice(dashIdx + 1).trim();
    } else {
      title = baseName;
      artist = '未知歌手';
    }
  }

  if (!title) title = fileName;
  if (!artist) artist = '未知歌手';

  const artistNames = artist
    ? artist.split(/[、,/&]/).filter(Boolean).map((s: string) => s.trim())
    : ['未知歌手'];

  const isRemote = /^https?:\/\//i.test(trimmedPath);

  const song: Song = {
    name: title,
    title,
    path: trimmedPath,
    artist,
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album: '未知专辑',
    album_artist: artist,
    album_key: `未知专辑-${artist}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration,
    source_type: isRemote ? 'remote' : 'local',
  };

  return song;
}