import type { PluginSource, Song } from '../../types';
import { readFileBytes, readPluginFile } from '../tauri/pluginApi';
import { extractJsonFromZip } from '../zipReader';
import { gunzipSync } from '../pureInflate';
import {
  detectBackup,
} from './pluginBackupFormat';
import {
  createLocalSong,
  createLxSong,
  createMusicFreeSong,
  describePlatform,
  extractArtist,
  extractSongId,
  extractTitle,
  findMatchingPlugin,
  resolveLocalPath,
} from './pluginBackupSong';
import {
  CURRENT_TRACK_ID_BACKUP_VERSION,
  type PluginBackupAssociation,
  type PluginBackupFailedSong,
  type PluginBackupPlaylist,
  type PreparedPluginBackupImport,
} from './pluginBackupTypes';


export {
  STRINGIFIED_TRACK_ID_BACKUP_VERSION,
  CURRENT_TRACK_ID_BACKUP_VERSION,
} from './pluginBackupTypes';
export type {
  SupportedPluginBackupFormat,
  PluginBackupPlaylist,
  PluginBackupFailedSong,
  PluginBackupAssociation,
  MissingBackupPlugin,
  PreparedPluginBackupImport,
} from './pluginBackupTypes';
export { formatInterval } from './pluginBackupSong';

export function preparePluginBackupImport( // 实现
  jsonContent: string, // 实现
  installedPlugins: PluginSource[], // 实现
): PreparedPluginBackupImport { // 实现
  let data: any; // 实现
  try {
    data = JSON.parse(jsonContent); // 实现
  } catch {
    throw new Error('文件不是有效的 JSON 格式'); // 实现
  }

  const { format, sheets, version, restoreStringifiedIds } = detectBackup(data);
  const playlists: PluginBackupPlaylist[] = []; // 实现
  const failures: PluginBackupFailedSong[] = []; // 实现
  const associationMap = new Map<string, PluginBackupAssociation>(); // 实现
  const missingPluginMap = new Map<string, { platform: string; songCount: number }>();
  let totalSongCount = 0; // 实现
  let importedSongCount = 0; // 实现
  let migratedTrackIdCount = 0;

  for (const [sheetIndex, sheet] of sheets.entries()) { // 实现
    const playlistName = String(sheet?.title ?? sheet?.name ?? `未命名歌单 ${sheetIndex + 1}`).trim() // 实现
      || `未命名歌单 ${sheetIndex + 1}`; // 实现
    const rawSongs = Array.isArray(sheet?.musicList) ? sheet.musicList : []; // 实现
    const songs: Song[] = []; // 实现
    totalSongCount += rawSongs.length; // 实现

    for (const rawSong of rawSongs) { // 实现
      const title = extractTitle(rawSong); // 实现
      const artist = extractArtist(rawSong); // 实现
      const id = extractSongId(rawSong); // 实现
      const platform = describePlatform(rawSong?.platform ?? rawSong?.source); // 实现

      if (!title) {
        failures.push({ // 实现
          playlist: playlistName, // 实现
          title: '未命名歌曲',
          artist,
          platform: platform.displayName, // 实现
          reason: '歌曲缺少标题',
          reasonCode: 'invalid-song', // 实现
        });
        continue;
      }

      const localPath = resolveLocalPath(rawSong);
      if (localPath) {
        songs.push(createLocalSong(rawSong, localPath));
        importedSongCount += 1;
        const localKey = '__local__';
        const localAssoc = associationMap.get(localKey);
        if (localAssoc) localAssoc.songCount += 1;
        else {
          associationMap.set(localKey, {
            pluginId: 'local',
            pluginName: '本地文件',
            pluginFormat: 'musicfree',
            enabled: true,
            platform: '本地文件',
            songCount: 1,
          });
        }
        continue;
      }

      if (!id || !platform.normalized) {
        failures.push({ // 实现
          playlist: playlistName, // 实现
          title,
          artist,
          platform: platform.displayName, // 实现
          reason: !platform.normalized ? '歌曲缺少来源平台' : '歌曲缺少平台歌曲 ID',
          reasonCode: 'invalid-song', // 实现
        });
        continue;
      }

      const plugin = findMatchingPlugin(platform, installedPlugins, format);
      if (!plugin) { // 实现
        failures.push({ // 实现
          playlist: playlistName, // 实现
          title,
          artist,
          platform: platform.displayName, // 实现
          reason: `缺少可处理“${platform.displayName}”的插件`, // 实现
          reasonCode: 'missing-plugin', // 实现
        });
        const missing = missingPluginMap.get(platform.canonical); // 实现
        if (missing) missing.songCount += 1; // 实现
        else missingPluginMap.set(platform.canonical, { platform: platform.displayName, songCount: 1 }); // 实现
        continue;
      }

      const song = plugin.format === 'lx' && platform.lxSource // 实现
        ? createLxSong(rawSong, plugin, { ...platform, lxSource: platform.lxSource }) // 实现
        : createMusicFreeSong(
            rawSong,
            plugin,
            platform,
            restoreStringifiedIds,
            () => { migratedTrackIdCount += 1; },
          );
      songs.push(song); // 实现
      importedSongCount += 1; // 实现

      const associationKey = `${plugin.id}\u0000${platform.canonical}`; // 实现
      const association = associationMap.get(associationKey); // 实现
      if (association) association.songCount += 1; // 实现
      else {
        associationMap.set(associationKey, { // 实现
          pluginId: plugin.id, // 实现
          pluginName: plugin.name, // 实现
          pluginFormat: plugin.format, // 实现
          enabled: plugin.enabled, // 实现
          platform: platform.displayName, // 实现
          songCount: 1, // 实现
        });
      }
    }

    if (songs.length > 0) { // 实现
      playlists.push({ // 实现
        name: playlistName, // 实现
        songs,
        originalSongCount: rawSongs.length, // 实现
      });
    }
  }

  return {
    format,
    sourcePlaylistCount: sheets.length, // 实现
    totalSongCount, // 实现
    importedSongCount, // 实现
    playlists,
    failures,
    associations: [...associationMap.values()], // 实现
    missingPlugins: [...missingPluginMap.values()], // 实现
    backupVersion: version,
    migratedTrackIds: restoreStringifiedIds,
    migratedTrackIdCount,
  };
}

export function describeBackupVersion(prepared: PreparedPluginBackupImport): string {
  const formatName = prepared.format === 'bakamusic' ? 'BakaMusic'
    : prepared.format === 'musicfree' ? 'MusicFree'
    : '洛雪音乐';
  if (prepared.backupVersion === null) {
    return `${formatName} 备份（未标注版本）`;
  }

  const label = `${formatName} v${prepared.backupVersion}`;
  if (prepared.migratedTrackIds) {
    return prepared.migratedTrackIdCount > 0
      ? `${label} 旧版备份，已还原 ${prepared.migratedTrackIdCount} 首歌曲 ID 以恢复逐字歌词`
      : `${label} 旧版备份`;
  }
  if (prepared.format === 'bakamusic' && prepared.backupVersion >= CURRENT_TRACK_ID_BACKUP_VERSION) {
    return `${label} 新版备份`;
  }
  return label;
}

export async function preparePluginBackupFile( // 实现
  filePath: string, // 实现
  installedPlugins: PluginSource[], // 实现
): Promise<PreparedPluginBackupImport> { // 实现
  const content = await readPluginFile(filePath); // 实现
  return preparePluginBackupImport(content, installedPlugins); // 实现
}

export async function preparePluginBackupFileContent(
  filePath: string, // 实现
  installedPlugins: PluginSource[], // 实现
): Promise<PreparedPluginBackupImport> { // 实现
  const ext = filePath.toLowerCase().match(/\.([^.]+)$/)?.[1] || '';
  let jsonContent: string;
  if (ext === 'zip') {
    const bytes = await readFileBytes(filePath);
    jsonContent = extractJsonFromZip(bytes);
  } else if (ext === 'lxmc') {
    const bytes = await readFileBytes(filePath);
    jsonContent = new TextDecoder().decode(gunzipSync(bytes));
  } else {
    jsonContent = await readPluginFile(filePath);
  }
  return preparePluginBackupImport(jsonContent, installedPlugins);
}