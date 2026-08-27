import type { Song } from '../../types';

/**
 * 备份文件导入服务 · 歌曲/路径转换。
 * file:// URL 解码、本地路径解析，以及将备份/M3U/TXT 中的歌曲条目
 * 构造成本应用 Song 对象。被 backupImportParse 与门面 backupImport 复用。
 */

/**
 * 将 file:/// URL 解码为本地文件路径
 * 例如: file:///C:/Users/%E5%B0%8F%E5%A5%87/Music/song.flac → C:\Users\小奇\Music\song.flac
 */
export function decodeFileUrl(url: string): string {
  try {
    let path = url;
    // 移除 file:/// 前缀
    if (path.startsWith('file:///')) {
      path = path.slice('file:///'.length);
    } else if (path.startsWith('file://')) {
      path = path.slice('file://'.length);
    }
    // URL 解码
    path = decodeURIComponent(path);
    // 统一为当前系统路径分隔符 (Windows)
    path = path.replace(/\//g, '\\');
    return path;
  } catch {
    return url;
  }
}

/**
 * 从备份歌曲对象中提取本地文件路径
 * 优先使用 localPath，其次解码 url
 */
export function resolveLocalPath(rawSong: any): string {
  if (rawSong.localPath && typeof rawSong.localPath === 'string') {
    return rawSong.localPath;
  }
  if (rawSong.url && typeof rawSong.url === 'string' && rawSong.url.startsWith('file:')) {
    return decodeFileUrl(rawSong.url);
  }
  // BakaMusic 的 qualities 字段中可能包含 url
  if (rawSong.qualities && typeof rawSong.qualities === 'object') {
    for (const quality of Object.values(rawSong.qualities) as any[]) {
      if (quality?.url && typeof quality.url === 'string' && quality.url.startsWith('file:')) {
        return decodeFileUrl(quality.url);
      }
    }
  }
  return '';
}

/**
 * 将备份歌曲对象转换为 Song 对象
 */
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

  // 如果没有本地路径，跳过该歌曲（无法播放）
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

  // 歌词
  if (rawSong.rawLrc && typeof rawSong.rawLrc === 'string') {
    song.lyrics_raw = rawSong.rawLrc;
  }

  // 封面 (BakaMusic 的 artwork 是 data URI)
  if (rawSong.artwork && typeof rawSong.artwork === 'string') {
    song.cover_thumb_path = rawSong.artwork;
  }

  return song;
}

/**
 * 从文件路径创建 Song 对象
 * 如果有 EXTINF 元信息则优先使用，否则从文件名 "title-artist.ext" 模式解析
 */
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

  // 无元信息时从文件名解析 "title-artist" 模式
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