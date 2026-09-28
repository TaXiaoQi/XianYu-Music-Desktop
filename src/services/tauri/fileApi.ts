import type { Song } from '../../types';
import { tauriInvoke } from './invoke';

// 文件系统域：目录/文件操作命令逐一封装为具名函数，再聚合成对外对象。

function deleteFolder(path: string): Promise<void> {
  return tauriInvoke('delete_folder', { path });
}

function moveFileToFolder(sourcePath: string, targetFolder: string) {
  return tauriInvoke('move_file_to_folder', { sourcePath, targetFolder });
}

function batchMoveMusicFiles(paths: string[], targetFolder: string) {
  return tauriInvoke('batch_move_music_files', { paths, targetFolder });
}

function getFolderFirstSong(folderPath: string) {
  return tauriInvoke('get_folder_first_song', { folderPath });
}

function scanMusicFolder(folderPath: string, minimumDurationSeconds = 0) {
  return tauriInvoke('scan_music_folder', { folderPath, minimumDurationSeconds });
}

function moveMusicFile(oldPath: string, newPath: string) {
  return tauriInvoke('move_music_file', { oldPath, newPath });
}

function showInFolder(path: string): Promise<void> {
  return tauriInvoke('show_in_folder', { path });
}

function deleteMusicFile(path: string): Promise<void> {
  return tauriInvoke('delete_music_file', { path });
}

function isDirectory(path: string): Promise<boolean> {
  return tauriInvoke('is_directory', { path });
}

function parseAudioFiles(paths: string[], minimumDurationSeconds = 0): Promise<Song[]> {
  return tauriInvoke('parse_audio_files', { paths, minimumDurationSeconds });
}

function parseMusicFolder(folderPath: string, minimumDurationSeconds = 0): Promise<Song[]> {
  return tauriInvoke('parse_music_folder', { folderPath, minimumDurationSeconds });
}

function saveSongBackground(songPath: string, backgroundPath: string): Promise<string> {
  return tauriInvoke('save_song_background', { songPath, backgroundPath });
}

function getSongBackground(songPath: string): Promise<string | null> {
  return tauriInvoke('get_song_background', { songPath });
}

function clearSongBackground(songPath: string): Promise<void> {
  return tauriInvoke('clear_song_background', { songPath });
}

function getSongCover(path: string): Promise<string> {
  return tauriInvoke('get_song_cover', { path });
}

function getSongCoverThumbnail(path: string): Promise<string> {
  return tauriInvoke('get_song_cover_thumbnail', { path });
}

function extractPalette(
  source: string,
  count: number,
  colorBoost: number,
  depth: number,
): Promise<string[]> {
  return tauriInvoke('extract_palette', { source, count, colorBoost, depth });
}

export const fileApi = {
  deleteFolder,
  moveFileToFolder,
  batchMoveMusicFiles,
  getFolderFirstSong,
  scanMusicFolder,
  moveMusicFile,
  showInFolder,
  deleteMusicFile,
  isDirectory,
  parseAudioFiles,
  parseMusicFolder,
  saveSongBackground,
  getSongBackground,
  clearSongBackground,
  getSongCover,
  getSongCoverThumbnail,
  extractPalette,
};
