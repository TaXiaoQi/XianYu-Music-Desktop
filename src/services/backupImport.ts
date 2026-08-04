/**
 * 备份文件导入服务
 *
 * 支持以下格式：
 * 1. BakaMusic 备份格式 (schema: "bakamusic.music-sheet-backup")
 *    - 结构: { schema, version, createdAt, data: { musicSheets: [...] } }
 *    - 每首歌包含: title, artist, album, duration, url, localPath, platform, id, rawLrc, artwork
 *
 * 2. MusicFree 备份格式 (version: 1)
 *    - 结构: { version, createdAt, musicSheets: [...] }
 *    - 每首歌包含: platform, id, title, artist, album, duration, url, localPath, folder
 *
 * 3. M3U / M3U8 播放列表 (.m3u / .m3u8)
 *    - 标准 M3U 格式，#EXTM3U 头部，#EXTINF:duration,artist - title 元信息
 *    - 每个文件导入为单个歌单，歌单名 = 文件名（不含扩展名）
 *
 * 4. 椒盐音乐导出格式 (.txt)
 *    - 纯文本，每行一个文件路径
 *    - 从文件名 "title-artist.ext" 模式提取标题和歌手
 *    - 每个文件导入为单个歌单，歌单名 = 文件名（不含扩展名）
 */

import type { Song } from '../types';

// ==================== 类型定义 ====================

export interface ImportedPlaylist {
  name: string;
  songs: Song[];
}

type BackupFormat = 'bakamusic' | 'musicfree' | 'unknown';

// ==================== 工具函数 ====================

function log(msg: string) {
  console.log(`[BackupImport] ${msg}`);
}

/**
 * 将 file:/// URL 解码为本地文件路径
 * 例如: file:///C:/Users/%E5%B0%8F%E5%A5%87/Music/song.flac → C:\Users\小奇\Music\song.flac
 */
function decodeFileUrl(url: string): string {
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
function resolveLocalPath(rawSong: any): string {
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
function convertBackupSong(rawSong: any): Song | null {
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
    log(`Skipping song "${title}" - no local file path found`);
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

// ==================== 格式检测 ====================

/**
 * 检测备份文件格式
 */
function detectFormat(data: any): BackupFormat {
  // BakaMusic: 有 schema 字段且为 "bakamusic.music-sheet-backup"
  if (data?.schema === 'bakamusic.music-sheet-backup') {
    return 'bakamusic';
  }
  // BakaMusic: data.musicSheets 存在
  if (data?.data?.musicSheets && Array.isArray(data.data.musicSheets)) {
    return 'bakamusic';
  }
  // MusicFree: 顶层有 musicSheets 且有 version 字段
  if (data?.musicSheets && Array.isArray(data.musicSheets)) {
    return 'musicfree';
  }
  return 'unknown';
}

// ==================== 解析逻辑 ====================

/**
 * 从 BakaMusic 备份中提取歌单列表
 */
function parseBakaMusic(data: any): ImportedPlaylist[] {
  const sheets = data?.data?.musicSheets || [];
  if (!Array.isArray(sheets)) return [];

  const playlists: ImportedPlaylist[] = [];

  for (const sheet of sheets) {
    const name = sheet.title || sheet.name || '未命名歌单';
    const rawSongs = sheet.musicList || [];
    if (!Array.isArray(rawSongs)) continue;

    const songs: Song[] = [];
    for (const rawSong of rawSongs) {
      const song = convertBackupSong(rawSong);
      if (song) songs.push(song);
    }

    if (songs.length > 0) {
      playlists.push({ name, songs });
    } else {
      log(`Playlist "${name}" has no valid local songs, skipped`);
    }
  }

  return playlists;
}

/**
 * 从 MusicFree 备份中提取歌单列表
 */
function parseMusicFree(data: any): ImportedPlaylist[] {
  const sheets = data?.musicSheets || [];
  if (!Array.isArray(sheets)) return [];

  const playlists: ImportedPlaylist[] = [];

  for (const sheet of sheets) {
    const name = sheet.title || sheet.name || '未命名歌单';
    const rawSongs = sheet.musicList || [];
    if (!Array.isArray(rawSongs)) continue;

    const songs: Song[] = [];
    for (const rawSong of rawSongs) {
      const song = convertBackupSong(rawSong);
      if (song) songs.push(song);
    }

    if (songs.length > 0) {
      playlists.push({ name, songs });
    } else {
      log(`Playlist "${name}" has no valid local songs, skipped`);
    }
  }

  return playlists;
}

// ==================== M3U / M3U8 解析 ====================

const AUDIO_EXTENSIONS = /\.(flac|mp3|wav|ape|ogg|opus|m4a|aac|wv|dsf|dff|webm|mp4)$/i;

/**
 * 从文件路径提取文件名（不含扩展名）
 */
function extractBaseName(filePath: string): string {
  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  return fileName.replace(/\.[^.]+$/, '');
}

/**
 * 从文件路径创建 Song 对象
 * 如果有 EXTINF 元信息则优先使用，否则从文件名 "title-artist.ext" 模式解析
 */
function createSongFromPath(
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

/**
 * 解析 M3U / M3U8 播放列表内容
 *
 * 格式：
 *   #EXTM3U
 *   #EXTINF:duration,artist - title
 *   /path/to/song.flac
 *   #EXTINF:212,Aaron Carter - Sooner Or Later
 *   /path/to/another.mp3
 *
 * @param content M3U 文件文本
 * @param filePath 文件路径（用于提取歌单名）
 */
function parseM3UContent(content: string, filePath: string): ImportedPlaylist[] {
  const playlistName = extractBaseName(filePath) || '导入的歌单';

  const lines = content.split(/\r?\n/);
  const songs: Song[] = [];

  let pendingDuration = 0;
  let pendingTitle = '';
  let pendingArtist = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      // 解析 #EXTINF:duration,artist - title
      const rest = line.slice('#EXTINF:'.length);
      const commaIdx = rest.indexOf(',');
      if (commaIdx >= 0) {
        pendingDuration = parseInt(rest.slice(0, commaIdx), 10) || 0;
        const info = rest.slice(commaIdx + 1);
        // 用最后一个 " - " 分割 artist 和 title
        const dashIdx = info.lastIndexOf(' - ');
        if (dashIdx >= 0) {
          pendingArtist = info.slice(0, dashIdx).trim();
          pendingTitle = info.slice(dashIdx + 3).trim();
        } else {
          pendingTitle = info.trim();
          pendingArtist = '';
        }
      }
    } else if (line.startsWith('#')) {
      // 其他指令（#EXTM3U, #PLAYLIST 等）忽略
      continue;
    } else {
      // 文件路径行
      const song = createSongFromPath(line, pendingTitle, pendingArtist, pendingDuration);
      if (song) songs.push(song);

      pendingDuration = 0;
      pendingTitle = '';
      pendingArtist = '';
    }
  }

  if (songs.length === 0) {
    throw new Error('M3U 文件中未找到有效的歌曲条目');
  }

  log(`Parsed M3U playlist "${playlistName}" with ${songs.length} songs`);
  return [{ name: playlistName, songs }];
}

// ==================== 椒盐音乐 TXT 解析 ====================

/**
 * 解析椒盐音乐导出的纯文本格式
 * 每行一个文件路径，从文件名 "title-artist.ext" 提取元信息
 *
 * @param content TXT 文件文本
 * @param filePath 文件路径（用于提取歌单名）
 */
function parseSaltPlayerContent(content: string, filePath: string): ImportedPlaylist[] {
  const playlistName = extractBaseName(filePath) || '导入的歌单';

  const lines = content.split(/\r?\n/);
  const songs: Song[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // 必须看起来像文件路径（包含扩展名或路径分隔符）
    if (!AUDIO_EXTENSIONS.test(line) && !/[\\/]/.test(line)) continue;

    const song = createSongFromPath(line, '', '', 0);
    if (song) songs.push(song);
  }

  if (songs.length === 0) {
    throw new Error('文件中未找到有效的歌曲路径');
  }

  log(`Parsed SaltPlayer playlist "${playlistName}" with ${songs.length} songs`);
  return [{ name: playlistName, songs }];
}

// ==================== 主入口 ====================

/**
 * 解析 JSON 备份文件内容 (BakaMusic / MusicFree)
 *
 * @param jsonContent JSON 文件文本内容
 * @returns 导入的歌单列表 (每个歌单包含名称和歌曲数组)
 * @throws 如果格式不支持或解析失败
 */
export function parseBackupContent(jsonContent: string): ImportedPlaylist[] {
  let data: any;
  try {
    data = JSON.parse(jsonContent);
  } catch {
    throw new Error('文件不是有效的 JSON 格式');
  }

  const format = detectFormat(data);
  log(`Detected backup format: ${format}`);

  let playlists: ImportedPlaylist[];

  switch (format) {
    case 'bakamusic':
      playlists = parseBakaMusic(data);
      break;
    case 'musicfree':
      playlists = parseMusicFree(data);
      break;
    default:
      throw new Error('无法识别的备份格式，支持 BakaMusic 和 MusicFree 备份文件');
  }

  if (playlists.length === 0) {
    throw new Error('备份文件中未找到可导入的歌单（可能所有歌曲都没有本地文件路径）');
  }

  const totalSongs = playlists.reduce((sum, p) => sum + p.songs.length, 0);
  log(`Imported ${playlists.length} playlists, ${totalSongs} songs total`);

  return playlists;
}

/** 支持导入的文件扩展名 */
export const SUPPORTED_IMPORT_EXTENSIONS = ['json', 'm3u', 'm3u8', 'txt'];

/**
 * 读取备份/播放列表文件并解析
 * 根据文件扩展名自动路由到对应解析器：
 * - .json → BakaMusic / MusicFree JSON 备份
 * - .m3u / .m3u8 → M3U 播放列表
 * - .txt → 椒盐音乐导出格式（或 M3U，自动检测）
 *
 * @param filePath 文件路径
 * @returns 导入的歌单列表
 */
export async function importBackupFile(filePath: string): Promise<ImportedPlaylist[]> {
  const { readPluginFile } = await import('./tauri/pluginApi');
  const content = await readPluginFile(filePath);

  const ext = filePath.toLowerCase().match(/\.([^.]+)$/)?.[1] || '';

  switch (ext) {
    case 'm3u':
    case 'm3u8':
      return parseM3UContent(content, filePath);

    case 'txt':
      // .txt 可能是 M3U 格式（有 #EXTM3U 头部）或椒盐音乐纯文本格式
      if (content.trim().startsWith('#EXTM3U')) {
        return parseM3UContent(content, filePath);
      }
      return parseSaltPlayerContent(content, filePath);

    case 'json':
      return parseBackupContent(content);

    default:
      // 未知扩展名：依次尝试 JSON → M3U → 纯文本
      try {
        return parseBackupContent(content);
      } catch {
        if (content.trim().startsWith('#EXTM3U')) {
          return parseM3UContent(content, filePath);
        }
        return parseSaltPlayerContent(content, filePath);
      }
  }
}
