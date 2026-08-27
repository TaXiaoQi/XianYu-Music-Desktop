import { readFileBytes, readPluginFile } from '../tauri/pluginApi';
import { extractJsonFromZip } from '../zipReader';
import { gunzipSync } from '../pureInflate';
import {
  parseBackupContent,
  parseM3UContent,
  parseSaltPlayerContent,
} from './backupImportParse';
import type { ImportedPlaylist } from './backupImportTypes';

/**
 * 备份文件导入服务 —— 门面（Facade）。
 *
 * 汇聚 re-export 拆分后的子模块并保留文件读取与主入口路由，保持既有消费者
 * （PlaylistModal / Sidebar 等）的入口路径不变。已拆分的子模块：
 *   - backupImportTypes    类型定义（叶子）
 *   - backupImportSong     歌曲/路径转换（file:// 解码、Song 构造）
 *   - backupImportParse    格式检测 + BakaMusic/MusicFree/M3U/椒盐(TXT) 解析
 *   - backupImportMatch    导入歌曲到本地库的匹配替换
 *
 * 支持格式：
 * 1. BakaMusic 备份格式 (schema: "bakamusic.music-sheet-backup")
 * 2. MusicFree 备份格式 (version: 1)
 * 3. M3U / M3U8 播放列表 (.m3u / .m3u8)
 * 4. 椒盐音乐导出格式 (.txt)
 * 5. ZIP 压缩包、洛雪音乐 .lxmc（gzip JSON）
 */

export type { ImportedPlaylist } from './backupImportTypes';
export type { BackupFormat } from './backupImportTypes';
export { matchSongsToLocalLibrary } from './backupImportMatch';

/** 支持导入的文件扩展名 */
export const SUPPORTED_IMPORT_EXTENSIONS = ['json', 'm3u', 'm3u8', 'txt', 'zip', 'lxmc'];

/**
 * 读取备份文件内容。
 * - .json 直接读取明文
 * - .zip 解压后提取其中的 JSON 备份
 * - .lxmc 洛雪音乐备份（gzip 压缩的 JSON）
 * @param filePath 文件路径
 * @returns 备份文件文本内容
 */
export async function readBackupFileContent(filePath: string): Promise<string> {
  const ext = filePath.toLowerCase().match(/\.([^.]+)$/)?.[1] || '';
  if (ext === 'zip') {
    const bytes = await readFileBytes(filePath);
    return extractJsonFromZip(bytes);
  }
  if (ext === 'lxmc') {
    const bytes = await readFileBytes(filePath);
    return decodeLxmc(bytes);
  }
  return readPluginFile(filePath);
}

/** 洛雪音乐 .lxmc 备份：gzip 解压后返回 UTF-8 文本 */
function decodeLxmc(bytes: Uint8Array): string {
  const inflated = gunzipSync(bytes);
  return new TextDecoder().decode(inflated);
}

/**
 * 读取备份/播放列表文件并解析
 * 根据文件扩展名自动路由到对应解析器：
 * - .json → BakaMusic / MusicFree JSON 备份
 * - .m3u / .m3u8 → M3U 播放列表
 * - .txt → 椒盐音乐导出格式（或 M3U，自动检测）
 *
 * @param filePath 文件路径
 * @returns 导入的歌单列表
 */
export async function importBackupFile(filePath: string): Promise<ImportedPlaylist[]> {
  const ext = filePath.toLowerCase().match(/\.([^.]+)$/)?.[1] || '';

  // ZIP 压缩包：解压后提取其中的 JSON 备份再解析
  if (ext === 'zip') {
    const jsonContent = await readBackupFileContent(filePath);
    return parseBackupContent(jsonContent);
  }
  // 洛雪音乐 .lxmc：gzip 解压为 JSON 备份再解析
  if (ext === 'lxmc') {
    const jsonContent = await readBackupFileContent(filePath);
    return parseBackupContent(jsonContent);
  }

  const content = await readPluginFile(filePath);

  switch (ext) {
    case 'm3u':
    case 'm3u8':
      return parseM3UContent(content, filePath);

    case 'txt':
      // .txt 可能是 M3U 格式（有 #EXTM3U 头部）或椒盐音乐纯文本格式
      if (content.trim().startsWith('#EXTM3U')) {
        return parseM3UContent(content, filePath);
      }
      return parseSaltPlayerContent(content, filePath);

    case 'json':
      return parseBackupContent(content);

    default:
      // 未知扩展名：依次尝试 JSON → M3U → 纯文本
      try {
        return parseBackupContent(content);
      } catch {
        if (content.trim().startsWith('#EXTM3U')) {
          return parseM3UContent(content, filePath);
        }
        return parseSaltPlayerContent(content, filePath);
      }
  }
}