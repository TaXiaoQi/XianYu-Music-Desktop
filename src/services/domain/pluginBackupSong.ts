import { markRaw } from 'vue';

import type { PluginSearchResult, PluginSource, Song } from '../../types';
import type { LxSearchResultItem } from './lxMusicSdk';
import {
  type PlatformDescriptor,
  type SupportedPluginBackupFormat,
} from './pluginBackupTypes';


const PLATFORM_ALIASES: Array<{
  canonical: string;
  displayName: string;
  lxSource?: LxSearchResultItem['source'];
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

export function describePlatform(value: unknown): PlatformDescriptor {
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

function pluginMatchScore(
  plugin: PluginSource,
  platform: PlatformDescriptor,
  format?: SupportedPluginBackupFormat,
): number {
  if (plugin.format !== 'musicfree' && plugin.format !== 'anime' && plugin.format !== 'lx') return 0;

  if (plugin.format === 'lx' && platform.lxSource && plugin.sources.includes(platform.lxSource)) {
    return format === 'lxmusic' ? 150 : 120;
  }

  let best = 0;
  const labels = [plugin.name, ...plugin.sources];
  for (const label of labels) {
    const normalized = normalizePlatformLabel(label);
    if (!normalized) continue;
    if (normalized === platform.normalized) {
      best = Math.max(best, plugin.format === 'lx' ? 110 : 140);
    }
    const descriptor = describePlatform(label);
    if (descriptor.canonical && descriptor.canonical === platform.canonical) {
      best = Math.max(best, plugin.format === 'lx' ? 100 : 130);
    }
  }

  return best;
}

export function findMatchingPlugin(
  platform: PlatformDescriptor,
  installedPlugins: PluginSource[],
  format?: SupportedPluginBackupFormat,
): PluginSource | null {
  return installedPlugins
    .map(plugin => ({ plugin, score: pluginMatchScore(plugin, platform, format) }))
    .filter(item => item.score > 0)
    .sort((a, b) => {
      if (a.plugin.enabled !== b.plugin.enabled) return a.plugin.enabled ? -1 : 1;
      if (a.score !== b.score) return b.score - a.score;
      if (a.plugin.format !== b.plugin.format) {
        if (format === 'lxmusic') return a.plugin.format === 'lx' ? -1 : 1;
        return a.plugin.format === 'musicfree' ? -1 : 1;
      }
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

export function formatInterval(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export function extractArtist(rawSong: any): string {
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

export function extractAlbum(rawSong: any): string {
  if (typeof rawSong.album === 'string' && rawSong.album.trim()) return rawSong.album.trim();
  if (rawSong.album?.name) return String(rawSong.album.name);
  if (rawSong.albumName) return String(rawSong.albumName);
  if (rawSong.al?.name) return String(rawSong.al.name);
  return '未知专辑';
}

function pickRawSongId(rawSong: any): unknown {
  return rawSong.id
    ?? rawSong.songmid
    ?? rawSong.songId
    ?? rawSong.songid
    ?? rawSong.musicId
    ?? rawSong.hash
    ?? '';
}

export function extractSongId(rawSong: any): string {
  return String(pickRawSongId(rawSong)).trim();
}

function normalizeTrackId(
  value: unknown,
  restoreStringifiedNumber: boolean,
): string | number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'bigint') {
    const text = String(value);
    return text.length > 0 ? text : null;
  }
  if (typeof value !== 'string') return null;

  const text = value.trim();
  if (!text.length) return null;
  if (!restoreStringifiedNumber) return text;

  const numericId = Number(text);
  return Number.isSafeInteger(numericId) && String(numericId) === text
    ? numericId
    : text;
}

export function extractTitle(rawSong: any): string {
  return String(rawSong.title ?? rawSong.name ?? rawSong.songname ?? '').trim();
}

export function resolveLocalPath(rawSong: any): string {
  if (typeof rawSong.localPath === 'string' && rawSong.localPath.trim()) {
    return rawSong.localPath.trim();
  }
  if (typeof rawSong.url === 'string' && rawSong.url.startsWith('file:')) {
    try {
      let p = rawSong.url;
      if (p.startsWith('file:///')) p = p.slice('file:///'.length);
      else if (p.startsWith('file://')) p = p.slice('file://'.length);
      return decodeURIComponent(p).replace(/\//g, '\\');
    } catch { /* ignore */ }
  }
  if (rawSong.qualities && typeof rawSong.qualities === 'object') {
    for (const quality of Object.values(rawSong.qualities) as any[]) {
      if (typeof quality?.url === 'string' && quality.url.startsWith('file:')) {
        try {
          let p = quality.url;
          if (p.startsWith('file:///')) p = p.slice('file:///'.length);
          else if (p.startsWith('file://')) p = p.slice('file://'.length);
          return decodeURIComponent(p).replace(/\//g, '\\');
        } catch { /* ignore */ }
      }
    }
  }
  return '';
}

export function createLocalSong(rawSong: any, localPath: string): Song {
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
    path: localPath,
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
    source_type: 'local',
  };

  if (typeof rawSong.rawLrc === 'string' && rawSong.rawLrc.trim()) {
    song.lyrics_raw = rawSong.rawLrc;
  }

  return song;
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
    rawData: markRaw(rawData),
  };

  if (typeof rawSong.rawLrc === 'string' && rawSong.rawLrc.trim()) {
    song.lyrics_raw = rawSong.rawLrc;
  }

  return song;
}

export function createMusicFreeSong(
  rawSong: any,
  plugin: PluginSource,
  platform: PlatformDescriptor,
  restoreStringifiedIds: boolean,
  onTrackIdMigrated?: () => void,
): Song {
  const id = extractSongId(rawSong);
  const title = extractTitle(rawSong);
  const artist = extractArtist(rawSong);
  const album = extractAlbum(rawSong);
  const durationSeconds = parseDurationSeconds(rawSong.duration ?? rawSong.interval ?? rawSong.dt);

  const rawId = pickRawSongId(rawSong);
  const normalizedId = normalizeTrackId(rawId, restoreStringifiedIds) ?? id;
  if (typeof rawId === 'string' && typeof normalizedId === 'number') {
    onTrackIdMigrated?.();
  }

  const musicItem = {
    ...rawSong,
    id: normalizedId,
    title,
    artist,
    album,
    platform: rawSong.platform || platform.displayName || plugin.name,
  };
  const staleUrl = (musicItem as Record<string, unknown>).url;
  if (typeof staleUrl === 'string' && staleUrl.startsWith('http')) {
    delete (musicItem as Record<string, unknown>).url;
  }
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

export function createLxSong(
  rawSong: any,
  plugin: PluginSource,
  platform: PlatformDescriptor & { lxSource: LxSearchResultItem['source'] },
): Song {
  const meta: any = rawSong?.meta && typeof rawSong.meta === 'object' ? rawSong.meta : {};
  const rawId = String(rawSong.songmid ?? rawSong.mid ?? meta.songId ?? meta.songid ?? rawSong.id ?? rawSong.hash ?? meta.hash ?? '').trim();
  const lxPrefix = `${platform.lxSource}_`;
  const id = rawId.startsWith(lxPrefix) ? rawId.slice(lxPrefix.length) : rawId;
  const durationSeconds = parseDurationSeconds(rawSong.duration ?? rawSong.interval ?? rawSong.dt ?? meta.interval);
  const qualitySource = rawSong.qualities ?? meta.qualitys;
  const qualityEntries = qualitySource && typeof qualitySource === 'object'
    ? Object.entries(qualitySource)
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
    albumId: String(meta.albumId ?? rawSong.albumId ?? rawSong.album_id ?? rawSong.albumid ?? ''),
    songmid: id,
    source: platform.lxSource,
    interval: typeof rawSong.interval === 'string' ? rawSong.interval : formatInterval(durationSeconds),
    img: String(meta.picUrl ?? rawSong.artwork ?? rawSong.coverUrl ?? rawSong.img ?? '') || null,
    types,
    _types: qualityMap,
    hash: meta.hash ?? rawSong.hash ?? rawSong['320hash'],
    strMediaMid: String(meta.strMediaMid ?? rawSong.strMediaMid ?? rawSong.songmid ?? rawSong.mid ?? id),
    songId: Number(meta.songId ?? meta.songid ?? rawSong.songId ?? rawSong.songid) || undefined,
    albumMid: meta.albumMid ?? rawSong.albumMid ?? rawSong.albummid,
    copyrightId: meta.copyrightId ?? rawSong.copyrightId,
  };
  const path = `lx://${platform.lxSource}/${encodeURIComponent(id)}`;
  return buildBaseSong(rawSong, path, plugin, lxItem);
}