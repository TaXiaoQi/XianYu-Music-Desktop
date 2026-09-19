
import type { Song, AppSettings, LibrarySong } from '../../types';
import { getStoredPlugins, addPluginSource, loadPluginFromScript, persistPluginScriptToDataDir, pluginsVersion } from './pluginEngine';
import { playerStorage } from '../storage/playerStorage';
import { classifySong } from './appBackupTypes';
import type { AppBackup, AppBackupImportResult, AppBackupSummary } from './appBackupTypes';
import { APP_BACKUP_SCHEMA } from './appBackupTypes';

function log(_msg: string) {
}

export function parseAppBackup(jsonContent: string): AppBackup {
  let data: any;
  try {
    data = JSON.parse(jsonContent);
  } catch {
    throw new Error('文件不是有效的 JSON 格式');
  }

  if (data?.schema !== APP_BACKUP_SCHEMA) {
    throw new Error('无法识别的备份格式，请选择本应用导出的备份文件');
  }

  if (!data?.data || typeof data.data !== 'object') {
    throw new Error('备份文件数据结构无效');
  }

  return data as AppBackup;
}

function getBackupSummary(backup: AppBackup): AppBackupSummary {
  const { playlists, favorites, plugins, settings } = backup.data;
  let totalSongs = 0;
  let localSongs = 0;
  let onlineSongs = 0;

  for (const pl of playlists) {
    totalSongs += pl.songs.length;
    for (const song of pl.songs) {
      if (classifySong(song) === 'local') localSongs++;
      else onlineSongs++;
    }
  }

  return {
    playlistCount: playlists.length,
    localPlaylistCount: playlists.filter(p => p.type === 'local').length,
    onlinePlaylistCount: playlists.filter(p => p.type === 'online').length,
    mixedPlaylistCount: playlists.filter(p => p.type === 'mixed').length,
    totalSongs,
    localSongs,
    onlineSongs,
    favoriteCount: favorites?.length ?? 0,
    pluginCount: plugins.length,
    hasSettings: !!settings,
  };
}

export async function importAppBackup(
  backup: AppBackup,
  collectionsStore: {
    createPlaylist: (name: string, initialSongs?: string[], fullSongs?: Song[]) => string | null;
    setFavoritePaths: (paths: string[]) => void;
    setFavoriteSongMetaMap: (map: Record<string, Song>) => void;
  },
  libraryStore: {
    setExtraSong: (song: LibrarySong) => void;
    setExtraSongs: (songs: LibrarySong[]) => void;
  },
  settingsStore: {
    patchSettings: (patch: Partial<AppSettings>) => void;
    replaceSettings: (settings: AppSettings) => void;
  },
  options: { includePlaylists?: boolean; includeFavorites?: boolean; includePlugins?: boolean; includeSettings?: boolean } = {},
): Promise<AppBackupImportResult> {
  const {
    includePlaylists = true,
    includeFavorites = true,
    includePlugins = true,
    includeSettings = true,
  } = options;

  const summary = getBackupSummary(backup);
  const errors: string[] = [];
  let importedPlaylists = 0;
  let importedFavorites = 0;
  let importedPlugins = 0;
  let skippedPlugins = 0;
  let settingsApplied = false;

  if (includePlugins && backup.data.plugins.length > 0) {
    const existingPlugins = getStoredPlugins();
    const existingIds = new Set(existingPlugins.map(p => p.id));

    for (const entry of backup.data.plugins) {
      try {
        if (existingIds.has(entry.source.id)) {
          log(`插件 "${entry.source.name}" 已存在，跳过`);
          skippedPlugins++;
          continue;
        }

        const loaded = await loadPluginFromScript(entry.script, entry.source.filePath);
        if (loaded) {
          const savedPath = await persistPluginScriptToDataDir(loaded, entry.script);
          if (savedPath) {
            loaded.filePath = savedPath;
          }
          addPluginSource({
            ...loaded,
            enabled: entry.source.enabled,
            sortOrder: entry.source.sortOrder,
          });
          importedPlugins++;
        } else {
          errors.push(`插件 "${entry.source.name}" 加载失败`);
          skippedPlugins++;
        }
      } catch (e: any) {
        errors.push(`插件 "${entry.source.name}" 导入失败: ${e?.message || e}`);
        skippedPlugins++;
      }
    }

    pluginsVersion.value++;
  }

  if (includePlaylists) {
    for (const pl of backup.data.playlists) {
      if (pl.songs.length === 0) continue;

      libraryStore.setExtraSongs(pl.songs);

      const songPaths = pl.songs.map(s => s.path);
      const playlistId = collectionsStore.createPlaylist(pl.name, songPaths, pl.songs);
      if (playlistId) {
        importedPlaylists++;
      } else {
        errors.push(`歌单 "${pl.name}" 创建失败`);
      }
    }
  }

  if (includeFavorites && backup.data.favorites && backup.data.favorites.length > 0) {
    const favSongs = backup.data.favorites;
    libraryStore.setExtraSongs(favSongs);

    const savedPaths: string[] = [];
    const metaMap: Record<string, Song> = {};
    for (const song of favSongs) {
      if (!song?.path) continue;
      savedPaths.push(song.path);
      if (classifySong(song) === 'online') {
        metaMap[song.path] = song;
      }
    }
    collectionsStore.setFavoritePaths(savedPaths);
    if (Object.keys(metaMap).length > 0) {
      collectionsStore.setFavoriteSongMetaMap(metaMap);
    }
    importedFavorites = savedPaths.length;
  }

  if (includeSettings && backup.data.settings) {
    try {
      settingsStore.replaceSettings(backup.data.settings);
      playerStorage.writeSettings(backup.data.settings);
      settingsApplied = true;
    } catch (e: any) {
      errors.push(`设置导入失败: ${e?.message || e}`);
    }
  }

  return {
    summary,
    importedPlaylists,
    importedFavorites,
    importedPlugins,
    skippedPlugins,
    settingsApplied,
    errors,
  };
}