import type { Song } from '../../types';
import { convertBackupSong, createSongFromPath } from './backupImportSong';
import { type BackupFormat, type ImportedPlaylist } from './backupImportTypes';


// ==================== 格式检测 ====================

function detectFormat(data: any): BackupFormat {
  if (data?.schema === 'bakamusic.music-sheet-backup') {
    return 'bakamusic';
  }
  if (data?.data?.musicSheets && Array.isArray(data.data.musicSheets)) {
    return 'bakamusic';
  }
  if (data?.musicSheets && Array.isArray(data.musicSheets)) {
    return 'musicfree';
  }
  return 'unknown';
}

// ==================== JSON 备份解析 ====================

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

function parseBakaMusic(data: any): ImportedPlaylist[] {
  const sheets = data?.data?.musicSheets || [];
  if (!Array.isArray(sheets)) return [];
  return parseSheets(sheets);
}

function parseMusicFree(data: any): ImportedPlaylist[] {
  const sheets = data?.musicSheets || [];
  if (!Array.isArray(sheets)) return [];
  return parseSheets(sheets);
}

// ==================== M3U / M3U8 解析 ====================

const AUDIO_EXTENSIONS = /\.(flac|mp3|wav|ape|ogg|opus|m4a|aac|wv|dsf|dff|webm|mp4)$/i;

function extractBaseName(filePath: string): string {
  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  return fileName.replace(/\.[^.]+$/, '');
}

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
      const rest = line.slice('#EXTINF:'.length);
      const commaIdx = rest.indexOf(',');
      if (commaIdx >= 0) {
        pendingDuration = parseInt(rest.slice(0, commaIdx), 10) || 0;
        const info = rest.slice(commaIdx + 1);
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

export function parseSaltPlayerContent(content: string, filePath: string): ImportedPlaylist[] {
  const playlistName = extractBaseName(filePath) || '导入的歌单';

  const lines = content.split(/\r?\n/);
  const songs: Song[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (!AUDIO_EXTENSIONS.test(line) && !/[\\/]/.test(line)) continue;

    const song = createSongFromPath(line, '', '', 0);
    if (song) songs.push(song);
  }

  if (songs.length === 0) {
    throw new Error('文件中未找到有效的歌曲路径');
  }

  return [{ name: playlistName, songs }];
}

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