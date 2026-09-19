import { readFileBytes, readPluginFile } from '../tauri/pluginApi';
import { extractJsonFromZip } from '../zipReader';
import { gunzipSync } from '../pureInflate';
import {
  parseBackupContent,
  parseM3UContent,
  parseSaltPlayerContent,
} from './backupImportParse';
import type { ImportedPlaylist } from './backupImportTypes';


export type { ImportedPlaylist } from './backupImportTypes';
export type { BackupFormat } from './backupImportTypes';
export { matchSongsToLocalLibrary } from './backupImportMatch';

export const SUPPORTED_IMPORT_EXTENSIONS = ['json', 'm3u', 'm3u8', 'txt', 'zip', 'lxmc'];

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

function decodeLxmc(bytes: Uint8Array): string {
  const inflated = gunzipSync(bytes);
  return new TextDecoder().decode(inflated);
}

export async function importBackupFile(filePath: string): Promise<ImportedPlaylist[]> {
  const ext = filePath.toLowerCase().match(/\.([^.]+)$/)?.[1] || '';

  if (ext === 'zip') {
    const jsonContent = await readBackupFileContent(filePath);
    return parseBackupContent(jsonContent);
  }
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
      if (content.trim().startsWith('#EXTM3U')) {
        return parseM3UContent(content, filePath);
      }
      return parseSaltPlayerContent(content, filePath);

    case 'json':
      return parseBackupContent(content);

    default:
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