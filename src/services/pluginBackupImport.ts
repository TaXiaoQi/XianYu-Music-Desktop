import type { PluginSearchResult, PluginSource, Song } from '../types';
import type { LxSearchResultItem } from './lxMusicSdk';

export type SupportedPluginBackupFormat = 'bakamusic' | 'musicfree';

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
}

type LxSourceKey = LxSearchResultItem['source'];

interface PlatformDescriptor {
  displayName: string;
  normalized: string;
  canonical: string;
  lxSource?: LxSourceKey;
}

const PLATFORM_ALIASES: Array<{
  canonical: string;
  displayName: string;
  lxSource?: LxSourceKey;
  aliases: string[];
}> = [
  { canonical: 'netease', displayName: '网易云音乐', lxSource: 'wy', aliases: ['wy', 'netease', '网易', '网易云', '网易云音乐'] },
  { canonical: 'qq', displayName: 'QQ音乐', lxSource: 'tx', aliases: ['tx', 'qq', 'qqmusic', '腾讯', '腾讯音乐', 'qq音乐'] },
  { canonical: 'kuwo', displayName: '酷我音乐', lxSource: 'kw', aliases: ['kw', 'kuwo', '酷我', '酷我音乐'] },
  { canonical: 'kugou', displayName: '酷狗音乐', lxSource: 'kg', aliases: ['kg', 'kugou', '酷狗', '酷狗音乐'] },
  { canonical: 'migu', displayName: '咪咕音乐', lxSource: 'mg', aliases: ['mg', 'migu', '咪咕', '咪咕音乐'] },
  { canonical: 'bilibili', displayName: '哔哩哔哩', aliases: ['bilibili', 'b站', '哔哩哔哩'] },
];

function normalizePlatformLabel(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_.\-—/\\()[\]（）【】·]+/g, '')
    .replace(/(?:音乐|music|音源|source|插件|plugin)+$/g, '');
}

function describePlatform(value: unknown): PlatformDescriptor {
  const original = String(value ?? '').trim();
  const normalized = normalizePlatformLabel(original);

  for (const definition of PLATFORM_ALIASES) {
    const aliases = definition.aliases.map(normalizePlatformLabel);
    if (aliases.some(alias => normalized === alias || (alias.length >= 2 && normalized.includes(alias)))) {
      return {
        displayName: original || definition.displayName,
        normalized,
        canonical: definition.canonical,
        lxSource: definition.lxSource,
      };
    }
  }

  return {
    displayName: original || '未知来源',
    normalized,
    canonical: normalized,
  };
}

function pluginMatchScore(plugin: PluginSource, platform: PlatformDescriptor): number {
  if (plugin.format !== 'musicfree' && plugin.format !== 'lx') return 0;

  if (plugin.format === 'lx' && platform.lxSource && plugin.sources.includes(platform.lxSource)) {
    return 120;
  }

  let best = 0;
  const labels = [plugin.name, ...plugin.sources];
  for (const label of labels) {
    const normalized = normalizePlatformLabel(label);
    if (!normalized) continue;
    if (normalized === platform.normalized) {
      best = Math.max(best, plugin.format === 'musicfree' ? 140 : 110);
    }
    const descriptor = describePlatform(label);
    if (descriptor.canonical && descriptor.canonical === platform.canonical) {
      best = Math.max(best, plugin.format === 'musicfree' ? 130 : 100);
    }
  }

  return best;
}

function findMatchingPlugin(
  platform: PlatformDescriptor,
  installedPlugins: PluginSource[],
): PluginSource | null {
  return installedPlugins
    .map(plugin => ({ plugin, score: pluginMatchScore(plugin, platform) }))
    .filter(item => item.score > 0)
    .sort((a, b) => {
      if (a.plugin.enabled !== b.plugin.enabled) return a.plugin.enabled ? -1 : 1;
      if (a.score !== b.score) return b.score - a.score;
      if (a.plugin.format !== b.plugin.format) return a.plugin.format === 'musicfree' ? -1 : 1;
      return (a.plugin.sortOrder ?? 0) - (b.plugin.sortOrder ?? 0);
    })[0]?.plugin ?? null;
}

function parseDurationSeconds(value: unknown): number {
  if (typeof value === 'string' && value.includes(':')) {
    const parts = value.split(':').map(part => Number.parseInt(part, 10));
    if (parts.length > 0 && parts.every(Number.isFinite)) {
      return Math.max(0, parts.reduce((total, part) => total * 60 + part, 0));
    }
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric > 1000 ? numeric / 1000 : numeric);
}

function formatInterval(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function extractArtist(rawSong: any): string {
  if (typeof rawSong.artist === 'string' && rawSong.artist.trim()) return rawSong.artist.trim();
  if (typeof rawSong.singer === 'string' && rawSong.singer.trim()) return rawSong.singer.trim();
  if (Array.isArray(rawSong.singerList)) {
    const names = rawSong.singerList
      .map((artist: any) => typeof artist === 'string' ? artist : artist?.name)
      .filter(Boolean);
    if (names.length > 0) return names.join(', ');
  }
  return '未知歌手';
}

function extractAlbum(rawSong: any): string {
  if (typeof rawSong.album === 'string' && rawSong.album.trim()) return rawSong.album.trim();
  if (rawSong.album?.name) return String(rawSong.album.name);
  if (rawSong.albumName) return String(rawSong.albumName);
  if (rawSong.al?.name) return String(rawSong.al.name);
  return '未知专辑';
}

function extractSongId(rawSong: any): string {
  return String(
    rawSong.id
      ?? rawSong.songmid
      ?? rawSong.songId
      ?? rawSong.songid
      ?? rawSong.musicId
      ?? rawSong.hash
      ?? '',
  ).trim();
}

function extractTitle(rawSong: any): string {
  return String(rawSong.title ?? rawSong.name ?? rawSong.songname ?? '').trim();
}

function buildBaseSong(
  rawSong: any,
  path: string,
  plugin: PluginSource,
  rawData: any,
): Song {
  const title = extractTitle(rawSong);
  const artist = extractArtist(rawSong);
  const album = extractAlbum(rawSong);
  const artistNames = artist
    .split(/[、,/&]/)
    .map(name => name.trim())
    .filter(Boolean);

  const song: Song = {
    name: title,
    title,
    path,
    artist,
    artist_names: artistNames.length > 0 ? artistNames : ['未知歌手'],
    effective_artist_names: artistNames.length > 0 ? artistNames : ['未知歌手'],
    album,
    album_artist: artist,
    album_key: `${album}-${artist}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: parseDurationSeconds(rawSong.duration ?? rawSong.interval ?? rawSong.dt),
    cover_thumb_path: String(rawSong.artwork ?? rawSong.coverUrl ?? rawSong.img ?? ''),
    source_type: 'remote',
    plugin_id: plugin.id,
    remote_source_id: path,
    rawData,
  };

  if (typeof rawSong.rawLrc === 'string' && rawSong.rawLrc.trim()) {
    song.lyrics_raw = rawSong.rawLrc;
  }

  return song;
}

function createMusicFreeSong(
  rawSong: any,
  plugin: PluginSource,
  platform: PlatformDescriptor,
): Song {
  const id = extractSongId(rawSong);
  const title = extractTitle(rawSong);
  const artist = extractArtist(rawSong);
  const album = extractAlbum(rawSong);
  const durationSeconds = parseDurationSeconds(rawSong.duration ?? rawSong.interval ?? rawSong.dt);
  const musicItem = {
    ...rawSong,
    id,
    title,
    artist,
    album,
    platform: rawSong.platform || platform.displayName || plugin.name,
  };
  const pluginResult: PluginSearchResult = {
    id,
    title,
    artist,
    album,
    coverUrl: String(rawSong.artwork ?? rawSong.coverUrl ?? rawSong.img ?? ''),
    duration: durationSeconds * 1000,
    platform: platform.displayName,
    platformId: id,
    pluginId: plugin.id,
    rawData: musicItem,
  };
  const path = `plugin://${encodeURIComponent(platform.displayName)}/${encodeURIComponent(id)}`;
  return buildBaseSong(rawSong, path, plugin, pluginResult);
}

function createLxSong(
  rawSong: any,
  plugin: PluginSource,
  platform: PlatformDescriptor & { lxSource: LxSourceKey },
): Song {
  const id = String(rawSong.songmid ?? rawSong.mid ?? rawSong.id ?? rawSong.hash ?? '').trim();
  const durationSeconds = parseDurationSeconds(rawSong.duration ?? rawSong.interval ?? rawSong.dt);
  const qualityEntries = rawSong.qualities && typeof rawSong.qualities === 'object'
    ? Object.entries(rawSong.qualities)
    : [];
  const types = qualityEntries.map(([type, value]: [string, any]) => ({
    type,
    size: value?.size != null ? String(value.size) : null,
    hash: value?.hash,
  }));
  const qualityMap = Object.fromEntries(types.map(item => [item.type, {
    size: item.size,
    hash: item.hash,
  }]));
  const lxItem: LxSearchResultItem = {
    name: extractTitle(rawSong),
    singer: extractArtist(rawSong),
    albumName: extractAlbum(rawSong),
    albumId: rawSong.albumId ?? rawSong.album_id ?? rawSong.albumid ?? '',
    songmid: id,
    source: platform.lxSource,
    interval: typeof rawSong.interval === 'string' ? rawSong.interval : formatInterval(durationSeconds),
    img: String(rawSong.artwork ?? rawSong.coverUrl ?? rawSong.img ?? '') || null,
    types,
    _types: qualityMap,
    hash: rawSong.hash ?? rawSong['320hash'],
    strMediaMid: rawSong.strMediaMid ?? rawSong.songmid ?? rawSong.mid,
    songId: Number(rawSong.songId ?? rawSong.songid) || undefined,
    albumMid: rawSong.albumMid ?? rawSong.albummid,
    copyrightId: rawSong.copyrightId,
  };
  const path = `lx://${platform.lxSource}/${encodeURIComponent(id)}`;
  return buildBaseSong(rawSong, path, plugin, lxItem);
}

function detectBackup(data: any): {
  format: SupportedPluginBackupFormat;
  sheets: any[];
} {
  if (data?.schema === 'bakamusic.music-sheet-backup' && Array.isArray(data?.data?.musicSheets)) {
    return { format: 'bakamusic', sheets: data.data.musicSheets };
  }
  if (Array.isArray(data?.musicSheets)) {
    return { format: 'musicfree', sheets: data.musicSheets };
  }
  if (Array.isArray(data?.data?.musicSheets)) {
    return { format: 'bakamusic', sheets: data.data.musicSheets };
  }
  throw new Error('无法识别备份格式，请选择 BakaMusic 或 MusicFree 导出的 JSON 文件');
}

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

  const { format, sheets } = detectBackup(data);
  const playlists: PluginBackupPlaylist[] = [];
  const failures: PluginBackupFailedSong[] = [];
  const associationMap = new Map<string, PluginBackupAssociation>();
  const missingPluginMap = new Map<string, MissingBackupPlugin>();
  let totalSongCount = 0;
  let importedSongCount = 0;

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

      if (!title || !id || !platform.normalized) {
        failures.push({
          playlist: playlistName,
          title: title || '未命名歌曲',
          artist,
          platform: platform.displayName,
          reason: !platform.normalized ? '歌曲缺少来源平台' : '歌曲缺少标题或平台歌曲 ID',
          reasonCode: 'invalid-song',
        });
        continue;
      }

      const plugin = findMatchingPlugin(platform, installedPlugins);
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

      const song = plugin.format === 'lx' && platform.lxSource
        ? createLxSong(rawSong, plugin, { ...platform, lxSource: platform.lxSource })
        : createMusicFreeSong(rawSong, plugin, platform);
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
  };
}

export async function preparePluginBackupFile(
  filePath: string,
  installedPlugins: PluginSource[],
): Promise<PreparedPluginBackupImport> {
  const { readPluginFile } = await import('./tauri/pluginApi');
  const content = await readPluginFile(filePath);
  return preparePluginBackupImport(content, installedPlugins);
}
