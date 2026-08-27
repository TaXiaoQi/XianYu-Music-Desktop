/**
 * 应用备份 · 导出。
 */

import type { Playlist, Song, AppSettings } from '../../types';
import { getStoredPlugins, getPluginScript } from './pluginEngine';
import { playerStorage } from '../storage/playerStorage';
import {
  classifyPlaylist,
  classifySong,
} from './appBackupTypes';
import type {
  AppBackup,
  AppBackupData,
  AppBackupExportResult,
  AppBackupSummary,
  BackupPlaylistEntry,
  BackupPluginEntry,
} from './appBackupTypes';
import { APP_BACKUP_SCHEMA, APP_BACKUP_VERSION } from './appBackupTypes';

function log(_msg: string) {
}

/**
 * 构建收藏歌曲列表：优先使用收藏元信息，缺失时经 resolveSongsByPaths 从本地库解析
 */
function buildFavoriteSongs(
  paths: string[],
  songMeta: Record<string, Song>,
  resolveSongsByPaths?: (paths: string[], fallbackSongs?: Song[]) => Song[],
): Song[] {
  const out: Song[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const song = songMeta[path] ?? resolveSongsByPaths?.([path])[0];
    if (song?.path) out.push(song);
  }
  return out;
}

/**
 * 导出完整应用备份
 * @param playlists 歌单列表
 * @param options 可选配置：是否导出插件、设置、收藏，收藏数据，歌曲路径解析器
 */
export async function exportAppBackup(
  playlists: Playlist[],
  options: {
    includePlaylists?: boolean;
    includePlugins?: boolean;
    includeSettings?: boolean;
    includeFavorites?: boolean;
    favorites?: { paths: string[]; songMeta: Record<string, Song> };
    resolveSongsByPaths?: (paths: string[], fallbackSongs?: Song[]) => Song[];
  } = {},
): Promise<AppBackupExportResult> {
  const {
    includePlaylists = true,
    includePlugins = true,
    includeSettings = true,
    includeFavorites = true,
    favorites,
    resolveSongsByPaths,
  } = options;

  // 1. 收集歌单数据
  const backupPlaylists: BackupPlaylistEntry[] = [];
  let totalSongs = 0;
  let localSongs = 0;
  let onlineSongs = 0;

  if (includePlaylists) {
    for (const pl of playlists) {
      // 跳过收藏歌单（收藏作为独立数据，不纳入歌单导出）
      if (pl.isFavorite) continue;

      // 优先使用内联歌曲；若无则从本地库解析
      let songs = pl.songs ?? [];
      if (songs.length === 0 && pl.songPaths.length > 0 && resolveSongsByPaths) {
        songs = resolveSongsByPaths(pl.songPaths);
      }
      if (songs.length === 0) continue;

      const type = classifyPlaylist(songs);
      backupPlaylists.push({
        name: pl.name,
        type,
        songs,
        createdAt: pl.createdAt,
      });

      totalSongs += songs.length;
      for (const song of songs) {
        if (classifySong(song) === 'local') localSongs++;
        else onlineSongs++;
      }
    }
  }

  // 2. 收集收藏歌曲（独立于歌单，含本地与在线元信息）
  let backupFavorites: Song[] = [];
  if (includeFavorites && favorites && favorites.paths.length > 0) {
    backupFavorites = buildFavoriteSongs(favorites.paths, favorites.songMeta, resolveSongsByPaths);
  }

  // 3. 收集插件数据
  const backupPlugins: BackupPluginEntry[] = [];
  if (includePlugins) {
    const storedPlugins = getStoredPlugins();
    for (const source of storedPlugins) {
      // 跳过内置插件（无法通过脚本恢复）
      if (source.filePath.startsWith('builtin://')) continue;

      const script = await getPluginScript(source.id);
      if (script) {
        backupPlugins.push({
          source: {
            ...source,
            // 清除运行时字段
            updateAvailable: undefined,
          },
          script,
        });
      } else {
        log(`跳过插件 "${source.name}"：无法获取脚本内容`);
      }
    }
  }

  // 4. 收集设置数据
  let settings: AppSettings | null = null;
  if (includeSettings) {
    settings = playerStorage.readSettings<AppSettings>();
  }

  const data: AppBackupData = {
    playlists: backupPlaylists,
    favorites: backupFavorites,
    plugins: backupPlugins,
    settings,
  };

  const backup: AppBackup = {
    schema: APP_BACKUP_SCHEMA,
    version: APP_BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    data,
  };

  const json = JSON.stringify(backup, null, 2);

  const summary: AppBackupSummary = {
    playlistCount: backupPlaylists.length,
    localPlaylistCount: backupPlaylists.filter(p => p.type === 'local').length,
    onlinePlaylistCount: backupPlaylists.filter(p => p.type === 'online').length,
    mixedPlaylistCount: backupPlaylists.filter(p => p.type === 'mixed').length,
    totalSongs,
    localSongs,
    onlineSongs,
    favoriteCount: backupFavorites.length,
    pluginCount: backupPlugins.length,
    hasSettings: !!settings,
  };

  return { json, summary };
}