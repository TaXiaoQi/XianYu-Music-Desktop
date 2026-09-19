
import type { Playlist, Song, AppSettings } from '../../types';
import { getStoredPlugins, getPluginScript, getPluginUserVariableValues } from './pluginEngine';
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

export async function exportAppBackup(
  playlists: Playlist[],
  options: {
    includePlaylists?: boolean;
    includePlugins?: boolean;
    includeSettings?: boolean;
    includeFavorites?: boolean;
    favorites?: { paths: string[]; songMeta: Record<string, Song> };
    resolveSongsByPaths?: (paths: string[], fallbackSongs?: Song[]) => Song[];
    /** 提供则对备份整体加密（口令派生密钥） */
    encryptionPassword?: string;
  } = {},
): Promise<AppBackupExportResult> {
  const {
    includePlaylists = true,
    includePlugins = true,
    includeSettings = true,
    includeFavorites = true,
    favorites,
    resolveSongsByPaths,
    encryptionPassword,
  } = options;

  const backupPlaylists: BackupPlaylistEntry[] = [];
  let totalSongs = 0;
  let localSongs = 0;
  let onlineSongs = 0;

  if (includePlaylists) {
    for (const pl of playlists) {
      if (pl.isFavorite) continue;

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

  let backupFavorites: Song[] = [];
  if (includeFavorites && favorites && favorites.paths.length > 0) {
    backupFavorites = buildFavoriteSongs(favorites.paths, favorites.songMeta, resolveSongsByPaths);
  }

  const backupPlugins: BackupPluginEntry[] = [];
  if (includePlugins) {
    const storedPlugins = getStoredPlugins();
    for (const source of storedPlugins) {
      if (source.filePath.startsWith('builtin://')) continue;

      const script = await getPluginScript(source.id);
      if (script) {
        backupPlugins.push({
          source: {
            ...source,
            updateAvailable: undefined,
          },
          script,
          // 用户变量值随备份迁移（跨端恢复卡密等配置）
          userVariables: getPluginUserVariableValues(source.id),
        });
      } else {
        log(`跳过插件 "${source.name}"：无法获取脚本内容`);
      }
    }
  }

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
  const finalJson = encryptionPassword
    ? await encryptBackupJson(json, encryptionPassword)
    : json;

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
    encrypted: !!encryptionPassword,
  };

  return { json: finalJson, summary };
}

// ==================== 备份加密（与云同步用户变量同构：AES-CBC/PKCS7，密钥 sha256(口令)） ====================

function b64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function bytesFromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function aesKeyFor(password: string): Promise<CryptoKey> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(password),
  );
  return globalThis.crypto.subtle.importKey('raw', digest, { name: 'AES-CBC' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/** 判断备份 JSON 是否为加密备份 */
export function isEncryptedBackupJson(raw: unknown): boolean {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return !!parsed && parsed.encrypted === true && typeof parsed.data === 'string';
  } catch {
    return false;
  }
}

/** 将已序列化的备份 JSON 加密为加密备份外壳 */
export async function encryptBackupJson(json: string, password: string): Promise<string> {
  const key = await aesKeyFor(password);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const ct = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: 'AES-CBC', iv },
      key,
      new TextEncoder().encode(json),
    ),
  );
  return JSON.stringify({
    schema: APP_BACKUP_SCHEMA,
    version: APP_BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    encrypted: true,
    kdf: 'sha256',
    cipher: 'aes-cbc-pkcs7',
    iv: b64FromBytes(iv),
    data: b64FromBytes(ct),
  });
}

/** 解密加密备份外壳，返回内部备份 JSON 字符串；密码错误抛异常 */
export async function decryptBackupJson(raw: unknown, password: string): Promise<string> {
  let parsed: any;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new Error('备份文件不是有效的 JSON');
  }
  if (!parsed || parsed.encrypted !== true || typeof parsed.data !== 'string' || typeof parsed.iv !== 'string') {
    throw new Error('不是有效的加密备份文件');
  }
  const key = await aesKeyFor(password);
  const pt = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: bytesFromB64(parsed.iv) },
    key,
    bytesFromB64(parsed.data),
  );
  return new TextDecoder().decode(pt);
}