
import type { Song, AppSettings, LibrarySong } from '../../types';
import { getStoredPlugins, addPluginSource, loadPluginFromScript, persistPluginScriptToDataDir, pluginsVersion, setPluginUserVariableValues } from './pluginEngine';
import { playerStorage } from '../storage/playerStorage';
import { classifySong, classifyPlaylist } from './appBackupTypes';
import { historyApi } from '../tauri/historyApi';
import type { AppBackup, AppBackupImportResult, AppBackupSummary, BackupPlaylistEntry } from './appBackupTypes';
import { APP_BACKUP_SCHEMA, BACKUP_DESKTOP_SETTING_SLOT } from './appBackupTypes';

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
  const { favorites, plugins, recentHistory, settings } = backup.data;
  // 移动端导出按需开关，未勾选的键会整体省略（如 playlists/plugins 缺失）
  const playlists = backup.data.playlists ?? [];
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

  // 移动端备份无 type 字段，按歌曲来源兜底归类
  const playlistType = (pl: BackupPlaylistEntry) => pl.type ?? classifyPlaylist(pl.songs);

  return {
    playlistCount: playlists.length,
    localPlaylistCount: playlists.filter(p => playlistType(p) === 'local').length,
    onlinePlaylistCount: playlists.filter(p => playlistType(p) === 'online').length,
    mixedPlaylistCount: playlists.filter(p => playlistType(p) === 'mixed').length,
    totalSongs,
    localSongs,
    onlineSongs,
    favoriteCount: favorites?.length ?? 0,
    pluginCount: plugins?.length ?? 0,
    hasSettings: getSelfSettings(settings) !== null,
    recentCount: recentHistory?.length ?? 0,
  };
}

// ==================== 移动端备份歌曲归一化 ====================

/**
 * 移动端导出的歌曲为 camelCase 结构（pluginId / musicInfo / durationMs /
 * coverThumbPath），且收藏的在线歌曲用 onlineSongJson（JSON 字符串）承载
 * 原始信息；桌面端播放在线歌曲依赖 plugin_id + rawData（lx 依赖 rawData 的
 * source/_types/hash）。此处统一归一化为桌面端 Song；桌面端导出的歌曲
 * （snake_case + rawData）原样透传，重复调用无副作用。
 */
function normalizeBackupSong(raw: any): Song | null {
  if (!raw || typeof raw !== 'object') return null;
  const path = typeof raw.path === 'string' && raw.path ? raw.path : (typeof raw.localPath === 'string' ? raw.localPath : '');
  if (!path) return null;

  const musicInfo: Record<string, unknown> | undefined = raw.musicInfo && typeof raw.musicInfo === 'object'
    ? raw.musicInfo
    : (typeof raw.onlineSongJson === 'string' ? tryParseJson(raw.onlineSongJson) : undefined);
  const pluginId: string | undefined = raw.plugin_id ?? raw.pluginId ?? (typeof musicInfo?.pluginId === 'string' ? musicInfo.pluginId : undefined);
  const isOnlinePath = /^(plugin|lx|remote|cloud):\/\//.test(path) || /^https?:/.test(path);
  const sourceType = raw.source_type === 'local' || raw.source_type === 'remote' || raw.source_type === 'plugin'
    ? raw.source_type
    : undefined;

  return {
    ...raw,
    name: raw.name ?? raw.title ?? path,
    artist: raw.artist ?? '',
    artist_names: Array.isArray(raw.artist_names) ? raw.artist_names : (raw.artist ? [raw.artist] : []),
    effective_artist_names: Array.isArray(raw.effective_artist_names) ? raw.effective_artist_names : (raw.artist ? [raw.artist] : []),
    album: raw.album ?? '',
    album_artist: raw.album_artist ?? '',
    album_key: raw.album_key ?? '',
    is_various_artists_album: raw.is_various_artists_album ?? false,
    collapse_artist_credits: raw.collapse_artist_credits ?? false,
    duration: typeof raw.duration === 'number'
      ? raw.duration
      : (typeof raw.durationMs === 'number' ? Math.round(raw.durationMs / 1000) : 0),
    cover_thumb_path: raw.cover_thumb_path ?? raw.coverThumbPath ?? undefined,
    source_type: sourceType ?? (isOnlinePath ? 'plugin' : 'local'),
    plugin_id: pluginId,
    // 插件歌曲 rawData 需携带 pluginId 供播放定位；lx 歌曲保留 musicInfo
    // 的 source/_types/hash 结构供 resolveLxCachedInfo 使用
    rawData: raw.rawData ?? (musicInfo ? { ...musicInfo, ...(pluginId ? { pluginId } : {}) } : undefined),
    path,
  };
}

function tryParseJson(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 取出写给「本端」的 settings 槽位。v2 起设置按端分槽；旧 v1 备份的 settings
 * 是扁平对象（无端概念），视为旧结构、不导入设置（提示可见但跳过写入），
 * 与移动端行为保持一致，避免把其他端设置写成桌面设置。
 */
function getSelfSettings(settings: AppBackup['data']['settings']): AppSettings | null {
  if (!settings || typeof settings !== 'object') return null;
  const slot = settings[BACKUP_DESKTOP_SETTING_SLOT];
  return slot && typeof slot === 'object' ? (slot as AppSettings) : null;
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
  options: { includePlaylists?: boolean; includeFavorites?: boolean; includePlugins?: boolean; includeSettings?: boolean; includeRecent?: boolean } = {},
): Promise<AppBackupImportResult> {
  const {
    includePlaylists = true,
    includeFavorites = true,
    includePlugins = true,
    includeSettings = true,
    includeRecent = true,
  } = options;

  const summary = getBackupSummary(backup);
  const errors: string[] = [];
  let importedPlaylists = 0;
  let importedFavorites = 0;
  let importedPlugins = 0;
  let skippedPlugins = 0;
  let settingsApplied = false;
  let importedRecent = 0;

  if (includePlugins && (backup.data.plugins ?? []).length > 0) {
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
          // 恢复备份中的用户变量值（跨端迁移卡密等配置）
          const userVars = entry.userVariables;
          if (userVars && Object.keys(userVars).length > 0) {
            setPluginUserVariableValues(loaded.id, { ...userVars });
          }
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
    for (const pl of backup.data.playlists ?? []) {
      // 移动端备份歌曲为 camelCase 结构，先归一化为桌面端 Song
      const songs = (pl.songs ?? []).map(normalizeBackupSong).filter((s): s is Song => !!s);
      if (songs.length === 0) continue;

      libraryStore.setExtraSongs(songs);

      const songPaths = songs.map(s => s.path);
      const playlistId = collectionsStore.createPlaylist(pl.name, songPaths, songs);
      if (playlistId) {
        importedPlaylists++;
      } else {
        errors.push(`歌单 "${pl.name}" 创建失败`);
      }
    }
  }

  if (includeFavorites && backup.data.favorites && backup.data.favorites.length > 0) {
    // 移动端收藏为 FavoriteEntry 结构（durationMs / onlineSongJson），归一化为桌面端 Song
    const favSongs = backup.data.favorites.map(normalizeBackupSong).filter((s): s is Song => !!s);
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

  if (includeSettings) {
    const selfSettings = getSelfSettings(backup.data.settings);
    if (selfSettings) {
      try {
        settingsStore.replaceSettings(selfSettings);
        playerStorage.writeSettings(selfSettings);
        settingsApplied = true;
      } catch (e: any) {
        errors.push(`设置导入失败: ${e?.message || e}`);
      }
    }
  }

  if (includeRecent && backup.data.recentHistory && backup.data.recentHistory.length > 0) {
    try {
      // 与现有历史按 path 合并（保留较新的时间戳），再整体写入，保持相对顺序。
      const existing = await historyApi.getRecentHistory(5000);
      const merged: Record<string, number> = {};
      for (const e of existing) {
        if (e.songPath) merged[e.songPath] = Math.max(merged[e.songPath] ?? 0, e.playedAt);
      }
      for (const e of backup.data.recentHistory) {
        if (!e.path) continue;
        // 桌面导出统一为秒，移动导出为毫秒：>1e11 视为毫秒（1e11 秒约合公元 5138 年）
        const rawPlayedAt = typeof e.playedAt === 'number' ? e.playedAt : 0;
        const playedAtMs = rawPlayedAt >= 1e11 ? Math.round(rawPlayedAt) : Math.round(rawPlayedAt * 1000);
        merged[e.path] = Math.max(merged[e.path] ?? 0, playedAtMs);
      }
      const entries = Object.entries(merged).map(([songPath, playedAt]) => ({
        songPath,
        playedAt,
      }));
      await historyApi.importRecentHistory(entries);
      importedRecent = backup.data.recentHistory.length;
    } catch (e: any) {
      errors.push(`最近播放导入失败: ${e?.message || e}`);
    }
  }

  return {
    summary,
    importedPlaylists,
    importedFavorites,
    importedPlugins,
    skippedPlugins,
    settingsApplied,
    importedRecent,
    errors,
  };
}