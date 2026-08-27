import type { PluginSource, Song } from '../../types';
import type { LxSearchResultItem } from './lxMusicSdk';

/**
 * 插件备份导出导入 · 类型与常量（叶子）。
 * 供 pluginBackupFormat / pluginBackupSong / pluginBackupImport 门面共用。
 */

export type SupportedPluginBackupFormat = 'bakamusic' | 'musicfree' | 'lxmusic';

/**
 * BakaMusic 备份格式版本。
 *
 * v2 把所有歌曲 ID 无差别字符串化；v3 保留原始标量类型。
 * 歌曲 ID 的 JSON 标量类型是插件契约的一部分——部分歌词 API 只在
 * 收到 JSON number 形式的数字 ID 时才返回逐字歌词，因此 v2 备份
 * 恢复后会丢失逐字歌词。导入 v2 时需还原数字 ID。
 *
 * 经 1773 首真实数据双版本对照验证：v2 全部为 string，
 * v3 中网易云/QQ 为 number，酷狗（hex hash）与 bilibili（BV 号）仍为 string。
 */
export const STRINGIFIED_TRACK_ID_BACKUP_VERSION = 2;
export const CURRENT_TRACK_ID_BACKUP_VERSION = 3;

export interface PluginBackupPlaylist {
  name: string;
  songs: Song[];
  originalSongCount: number;
}

export interface PluginBackupFailedSong {
  playlist: string;
  title: string;
  artist: string;
  platform: string;
  reason: string;
  reasonCode: 'missing-plugin' | 'invalid-song';
}

export interface PluginBackupAssociation {
  pluginId: string;
  pluginName: string;
  pluginFormat: PluginSource['format'];
  enabled: boolean;
  platform: string;
  songCount: number;
}

export interface MissingBackupPlugin {
  platform: string;
  songCount: number;
}

export interface PreparedPluginBackupImport {
  format: SupportedPluginBackupFormat;
  sourcePlaylistCount: number;
  totalSongCount: number;
  importedSongCount: number;
  playlists: PluginBackupPlaylist[];
  failures: PluginBackupFailedSong[];
  associations: PluginBackupAssociation[];
  missingPlugins: MissingBackupPlugin[];
  /** 备份声明的格式版本；缺失或无法识别时为 null */
  backupVersion: number | null;
  /** 是否对该备份执行了字符串化数字 ID 还原（仅 BakaMusic v2） */
  migratedTrackIds: boolean;
  /** 实际被还原为数字的歌曲 ID 数量 */
  migratedTrackIdCount: number;
}

export type LxSourceKey = LxSearchResultItem['source'];

export interface PlatformDescriptor {
  displayName: string;
  normalized: string;
  canonical: string;
  lxSource?: LxSourceKey;
}