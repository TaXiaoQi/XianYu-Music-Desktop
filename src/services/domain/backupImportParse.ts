import type { Song } from '../../types';
import { convertBackupSong, createSongFromPath } from './backupImportSong';
import { type BackupFormat, type ImportedPlaylist } from './backupImportTypes';

/**
 * 备份文件导入服务 · 格式解析。
 * 格式检测（BakaMusic / MusicFree）与 BakaMusic / MusicFree / M3U /
 * 椒盐音乐(TXT) 的解析入口。被门面 backupImport 编排复用。
 */

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

// ==================== JSON 备份解析 ====================

/**
 * 通用的 BakaMusic / MusicFree 歌单提取（两者结构一致：顶层歌单数组，
 * 每项 { title/name, musicList }）。
 */
function parseSheets(sheets: any[]): ImportedPlaylist[] {
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
    }
  }

  return playlists;
}

/**
 * 从 BakaMusic 备份中提取歌单列表（歌单嵌套在 data.musicSheets）
 */
function parseBakaMusic(data: any): ImportedPlaylist[] {
  const sheets = data?.data?.musicSheets || [];
  if (!Array.isArray(sheets)) return [];
  return parseSheets(sheets);
}

/**
 * 从 MusicFree 备份中提取歌单列表（歌单位于顶层 musicSheets）
 */
function parseMusicFree(data: any): ImportedPlaylist[] {
  const sheets = data?.musicSheets || [];
  if (!Array.isArray(sheets)) return [];
  return parseSheets(sheets);
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
export function parseM3UContent(content: string, filePath: string): ImportedPlaylist[] {
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
export function parseSaltPlayerContent(content: string, filePath: string): ImportedPlaylist[] {
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

  return [{ name: playlistName, songs }];
}

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

  return playlists;
}