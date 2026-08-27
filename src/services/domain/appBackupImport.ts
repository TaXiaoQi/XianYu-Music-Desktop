/**
 * 应用备份 · 解析/摘要/导入。
 */

import type { Song, AppSettings, LibrarySong } from '../../types';
import { getStoredPlugins, addPluginSource, loadPluginFromScript, persistPluginScriptToDataDir, pluginsVersion } from './pluginEngine';
import { playerStorage } from '../storage/playerStorage';
import { classifySong } from './appBackupTypes';
import type { AppBackup, AppBackupImportResult, AppBackupSummary } from './appBackupTypes';
import { APP_BACKUP_SCHEMA } from './appBackupTypes';

function log(_msg: string) {
}

/**
 * 解析备份 JSON 字符串
 */
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

/**
 * 从备份中计算摘要信息
 */
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

/**
 * 导入应用备份
 * @param backup 解析后的备份对象
 * @param collectionsStore 歌单 store（需提供 createPlaylist / setFavoritePaths / setFavoriteSongMetaMap 方法）
 * @param libraryStore 本地库 store（需提供 setExtraSong / setExtraSongs 方法）
 * @param settingsStore 设置 store（需提供 patchSettings / replaceSettings 方法）
 * @param options 导入选项：是否导入歌单、收藏、插件、设置
 */
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

  // 1. 导入插件（先于歌单，确保在线歌曲能匹配到插件）
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

        // 通过脚本重新加载插件，自动生成 PluginSource
        const loaded = await loadPluginFromScript(entry.script, entry.source.filePath);
        if (loaded) {
          // 本地文件路径的插件：保存副本到数据目录，避免原文件移动后失效
          const savedPath = await persistPluginScriptToDataDir(loaded, entry.script);
          if (savedPath) {
            loaded.filePath = savedPath;
          }
          // 保留原始排序和启用状态
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

    // 触发插件版本刷新
    pluginsVersion.value++;
  }

  // 2. 导入歌单
  if (includePlaylists) {
    for (const pl of backup.data.playlists) {
      if (pl.songs.length === 0) continue;

      // 注册歌曲到 libraryStore
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

  // 3. 导入收藏（独立于歌单；在线歌曲需保留完整元信息供展示与播放）
  if (includeFavorites && backup.data.favorites && backup.data.favorites.length > 0) {
    const favSongs = backup.data.favorites;
    // 注册歌曲到 libraryStore，确保本地/在线歌曲都能被解析
    libraryStore.setExtraSongs(favSongs);

    const savedPaths: string[] = [];
    const metaMap: Record<string, Song> = {};
    for (const song of favSongs) {
      if (!song?.path) continue;
      savedPaths.push(song.path);
      // 本地歌曲由本地库还原；在线歌曲不在本地库中，需额外保存完整元信息
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

  // 4. 导入设置
  if (includeSettings && backup.data.settings) {
    try {
      // 使用 replaceSettings 完全替换设置
      settingsStore.replaceSettings(backup.data.settings);
      // 持久化
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