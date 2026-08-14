/**
 * 应用备份导出/导入服务
 *
 * 支持将歌单（在线/本地/混合）、插件、本地设置导出为 JSON 文件，
 * 并可从 JSON 文件快速导入恢复。
 *
 * 备份格式：
 * {
 *   schema: "xianyu-music.app-backup",
 *   version: 1,
 *   createdAt: ISOString,
 *   data: {
 *     playlists: [...],
 *     plugins: [...],
 *     settings: {...}
 *   }
 * }
 */

import type { Playlist, PluginSource, Song, AppSettings, LibrarySong } from '../types';
import { getStoredPlugins, getPluginScript, addPluginSource, loadPluginFromScript, pluginsVersion } from './pluginEngine';
import { playerStorage } from './storage/playerStorage';

// ==================== 类型定义 ====================

const APP_BACKUP_SCHEMA = 'xianyu-music.app-backup';
const APP_BACKUP_VERSION = 1;

type PlaylistType = 'local' | 'online' | 'mixed';

interface BackupPlaylistEntry {
  name: string;
  type: PlaylistType;
  songs: Song[];
  createdAt?: string;
  isFavorite?: boolean;
}

interface BackupPluginEntry {
  source: PluginSource;
  script: string;
}

interface AppBackupData {
  playlists: BackupPlaylistEntry[];
  plugins: BackupPluginEntry[];
  settings: AppSettings | null;
}

interface AppBackup {
  schema: string;
  version: number;
  createdAt: string;
  data: AppBackupData;
}

interface AppBackupSummary {
  playlistCount: number;
  localPlaylistCount: number;
  onlinePlaylistCount: number;
  mixedPlaylistCount: number;
  totalSongs: number;
  localSongs: number;
  onlineSongs: number;
  pluginCount: number;
  hasSettings: boolean;
}

interface AppBackupExportResult {
  json: string;
  summary: AppBackupSummary;
}

export interface AppBackupImportResult {
  summary: AppBackupSummary;
  importedPlaylists: number;
  importedPlugins: number;
  skippedPlugins: number;
  settingsApplied: boolean;
  errors: string[];
}

function log(_msg: string) {
}

/**
 * 判断歌曲来源类型
 * - path 以 plugin:// 或 lx:// 开头 → online
 * - path 以 file:/// 或普通文件路径开头 → local
 * - source_type 字段优先判断
 */
function classifySong(song: Song): 'local' | 'online' {
  if (song.source_type === 'local') return 'local';
  if (song.source_type === 'remote' || song.source_type === 'plugin') return 'online';

  const path = song.path || '';
  if (path.startsWith('plugin://') || path.startsWith('lx://') || path.startsWith('http://') || path.startsWith('https://')) {
    return 'online';
  }
  return 'local';
}

/**
 * 对歌单进行类型分类
 */
function classifyPlaylist(songs: Song[]): PlaylistType {
  if (songs.length === 0) return 'local';
  const types = new Set(songs.map(classifySong));
  if (types.size === 1) {
    return types.has('local') ? 'local' : 'online';
  }
  return 'mixed';
}

// ==================== 导出 ====================

/**
 * 导出完整应用备份
 * @param playlists 歌单列表
 * @param options 可选配置：是否导出插件、是否导出设置、歌曲路径解析器
 */
export async function exportAppBackup(
  playlists: Playlist[],
  options: {
    includePlugins?: boolean;
    includeSettings?: boolean;
    resolveSongsByPaths?: (paths: string[], fallbackSongs?: Song[]) => Song[];
  } = {},
): Promise<AppBackupExportResult> {
  const { includePlugins = true, includeSettings = true, resolveSongsByPaths } = options;

  // 1. 收集歌单数据
  const backupPlaylists: BackupPlaylistEntry[] = [];
  let totalSongs = 0;
  let localSongs = 0;
  let onlineSongs = 0;

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

  // 2. 收集插件数据
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

  // 3. 收集设置数据
  let settings: AppSettings | null = null;
  if (includeSettings) {
    settings = playerStorage.readSettings<AppSettings>();
  }

  const data: AppBackupData = {
    playlists: backupPlaylists,
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
    pluginCount: backupPlugins.length,
    hasSettings: !!settings,
  };

  return { json, summary };
}

// ==================== 导入 ====================

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
  const { playlists, plugins, settings } = backup.data;
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
    pluginCount: plugins.length,
    hasSettings: !!settings,
  };
}

/**
 * 导入应用备份
 * @param backup 解析后的备份对象
 * @param collectionsStore 歌单 store（需提供 createPlaylist 方法）
 * @param libraryStore 本地库 store（需提供 setExtraSong / setExtraSongs 方法）
 * @param settingsStore 设置 store（需提供 patchSettings / replaceSettings 方法）
 * @param options 导入选项：是否导入歌单、插件、设置
 */
export async function importAppBackup(
  backup: AppBackup,
  collectionsStore: {
    createPlaylist: (name: string, initialSongs?: string[], fullSongs?: Song[]) => string | null;
  },
  libraryStore: {
    setExtraSong: (song: LibrarySong) => void;
    setExtraSongs: (songs: LibrarySong[]) => void;
  },
  settingsStore: {
    patchSettings: (patch: Partial<AppSettings>) => void;
    replaceSettings: (settings: AppSettings) => void;
  },
  options: { includePlaylists?: boolean; includePlugins?: boolean; includeSettings?: boolean } = {},
): Promise<AppBackupImportResult> {
  const {
    includePlaylists = true,
    includePlugins = true,
    includeSettings = true,
  } = options;

  const summary = getBackupSummary(backup);
  const errors: string[] = [];
  let importedPlaylists = 0;
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

  // 3. 导入设置
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
    importedPlugins,
    skippedPlugins,
    settingsApplied,
    errors,
  };
}
