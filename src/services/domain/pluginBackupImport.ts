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

/**
 * 插件备份导出导入 —— 门面（Facade）。
 *
 * 汇聚 re-export 拆分后的子模块并保留主编排，保持既有消费者
 * （pluginBackupImport.test.ts / pluginBackupImport.realdata.test.ts 等）
 * 的入口路径不变。已拆分的子模块：
 *   - pluginBackupTypes    类型与版本常量（叶子）
 *   - pluginBackupFormat   格式/版本检测（BakaMusic / MusicFree / 洛雪）
 *   - pluginBackupSong     歌曲字段提取、平台描述/插件匹配、Song 规范化
 *
 * 能力：解析 BakaMusic / MusicFree / 洛雪(lxmc) 三种备份的文件/JSON，
 * 自动识别格式与版本、匹配在线插件或本地路径，构造可导入的歌单与失败明细。
 */

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

/**
 * 主编排：解析备份 JSON，识别格式与插件，逐歌单构造可导入歌曲与失败明细。
 */
export function preparePluginBackupImport(
  jsonContent: string,
  installedPlugins: PluginSource[],
): PreparedPluginBackupImport {
  let data: any;
  try {
    data = JSON.parse(jsonContent);
  } catch {
    throw new Error('文件不是有效的 JSON 格式');
  }

  const { format, sheets, version, restoreStringifiedIds } = detectBackup(data);
  const playlists: PluginBackupPlaylist[] = [];
  const failures: PluginBackupFailedSong[] = [];
  const associationMap = new Map<string, PluginBackupAssociation>();
  const missingPluginMap = new Map<string, { platform: string; songCount: number }>();
  let totalSongCount = 0;
  let importedSongCount = 0;
  let migratedTrackIdCount = 0;

  for (const [sheetIndex, sheet] of sheets.entries()) {
    const playlistName = String(sheet?.title ?? sheet?.name ?? `未命名歌单 ${sheetIndex + 1}`).trim()
      || `未命名歌单 ${sheetIndex + 1}`;
    const rawSongs = Array.isArray(sheet?.musicList) ? sheet.musicList : [];
    const songs: Song[] = [];
    totalSongCount += rawSongs.length;

    for (const rawSong of rawSongs) {
      const title = extractTitle(rawSong);
      const artist = extractArtist(rawSong);
      const id = extractSongId(rawSong);
      const platform = describePlatform(rawSong?.platform ?? rawSong?.source);

      if (!title) {
        failures.push({
          playlist: playlistName,
          title: '未命名歌曲',
          artist,
          platform: platform.displayName,
          reason: '歌曲缺少标题',
          reasonCode: 'invalid-song',
        });
        continue;
      }

      // 优先检测本地文件路径：有本地路径的歌曲直接作为本地歌曲导入
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

      // 无本地路径：尝试匹配在线插件
      if (!id || !platform.normalized) {
        failures.push({
          playlist: playlistName,
          title,
          artist,
          platform: platform.displayName,
          reason: !platform.normalized ? '歌曲缺少来源平台' : '歌曲缺少平台歌曲 ID',
          reasonCode: 'invalid-song',
        });
        continue;
      }

      const plugin = findMatchingPlugin(platform, installedPlugins, format);
      if (!plugin) {
        failures.push({
          playlist: playlistName,
          title,
          artist,
          platform: platform.displayName,
          reason: `缺少可处理“${platform.displayName}”的插件`,
          reasonCode: 'missing-plugin',
        });
        const missing = missingPluginMap.get(platform.canonical);
        if (missing) missing.songCount += 1;
        else missingPluginMap.set(platform.canonical, { platform: platform.displayName, songCount: 1 });
        continue;
      }

      // lx 协议的 songmid 本身就是字符串语义，无需 ID 类型还原
      const song = plugin.format === 'lx' && platform.lxSource
        ? createLxSong(rawSong, plugin, { ...platform, lxSource: platform.lxSource })
        : createMusicFreeSong(
            rawSong,
            plugin,
            platform,
            restoreStringifiedIds,
            () => { migratedTrackIdCount += 1; },
          );
      songs.push(song);
      importedSongCount += 1;

      const associationKey = `${plugin.id}\u0000${platform.canonical}`;
      const association = associationMap.get(associationKey);
      if (association) association.songCount += 1;
      else {
        associationMap.set(associationKey, {
          pluginId: plugin.id,
          pluginName: plugin.name,
          pluginFormat: plugin.format,
          enabled: plugin.enabled,
          platform: platform.displayName,
          songCount: 1,
        });
      }
    }

    if (songs.length > 0) {
      playlists.push({
        name: playlistName,
        songs,
        originalSongCount: rawSongs.length,
      });
    }
  }

  return {
    format,
    sourcePlaylistCount: sheets.length,
    totalSongCount,
    importedSongCount,
    playlists,
    failures,
    associations: [...associationMap.values()],
    missingPlugins: [...missingPluginMap.values()],
    backupVersion: version,
    migratedTrackIds: restoreStringifiedIds,
    migratedTrackIdCount,
  };
}

/**
 * 生成备份版本的用户可读描述，供导入结果 toast 使用。
 *
 * v2 会额外说明已还原数字 ID —— 这直接关系到用户能否感知
 * 「为什么导入后逐字歌词恢复了」。
 */
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

export async function preparePluginBackupFile(
  filePath: string,
  installedPlugins: PluginSource[],
): Promise<PreparedPluginBackupImport> {
  const content = await readPluginFile(filePath);
  return preparePluginBackupImport(content, installedPlugins);
}

/**
 * 读取备份文件并准备导入。
 * - .json 直接读取明文
 * - .zip 解压后提取其中的 JSON 备份
 * - .lxmc 洛雪音乐备份（gzip 压缩的 JSON）
 * 与 preparePluginBackupFile 相同，但额外支持压缩包格式。
 */
export async function preparePluginBackupFileContent(
  filePath: string,
  installedPlugins: PluginSource[],
): Promise<PreparedPluginBackupImport> {
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