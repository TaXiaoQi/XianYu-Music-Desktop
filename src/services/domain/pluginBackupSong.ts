import { markRaw } from 'vue';

import type { PluginSearchResult, PluginSource, Song } from '../../types';
import type { LxSearchResultItem } from './lxMusicSdk';
import {
  type PlatformDescriptor,
  type SupportedPluginBackupFormat,
} from './pluginBackupTypes';

/**
 * 插件备份导出导入 · 歌曲规范化。
 * 歌曲字段提取、平台描述/插件匹配、以及把备份歌曲构造为本应用 Song 对象
 * （本地 / MusicFree / 洛雪 LX 三种）。被 pluginBackupImport 门面编排复用。
 */

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
  if (plugin.format !== 'musicfree' && plugin.format !== 'lx') return 0;

  // 洛雪备份的歌曲用 LX source code（如 'wy'）标识来源，
  // LX 插件原生支持这些 code，应优先于 MusicFree 插件匹配。
  // 提升到 150 确保 LX 插件击败 MusicFree 的 canonical 匹配（130）和精确匹配（140）。
  if (plugin.format === 'lx' && platform.lxSource && plugin.sources.includes(platform.lxSource)) {
    return format === 'lxmusic' ? 150 : 120;
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
      // 洛雪备份优先选择 LX 插件，其他备份优先 MusicFree 插件
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

/** 按优先级取出歌曲 ID 的原始值（未做类型转换） */
function pickRawSongId(rawSong: any): unknown {
  return rawSong.id
    ?? rawSong.songmid
    ?? rawSong.songId
    ?? rawSong.songid
    ?? rawSong.musicId
    ?? rawSong.hash
    ?? '';
}

/**
 * 歌曲 ID 的字符串形式，用于构造 `plugin://` / `lx://` 路径与非空校验。
 * 路径是 URL，必须字符串化。
 */
export function extractSongId(rawSong: any): string {
  return String(pickRawSongId(rawSong)).trim();
}

/**
 * 保留原始标量类型的歌曲 ID，用于写入传给插件的 musicItem.id。
 *
 * 插件把该字段原样发给上游 API，其 JSON 标量类型属于契约的一部分：
 * 部分歌词接口只在收到 number 时才返回逐字歌词。因此这里不能一律 String()。
 *
 * @param restoreStringifiedNumber 是否尝试把字符串化的数字还原为 number（导入 v2 备份时启用）
 * @returns 归一化后的 ID，无有效 ID 时返回 null
 */
function normalizeTrackId(
  value: unknown,
  restoreStringifiedNumber: boolean,
): string | number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  // bigint 超出 Number 安全范围，只能以字符串承载
  if (typeof value === 'bigint') {
    const text = String(value);
    return text.length > 0 ? text : null;
  }
  if (typeof value !== 'string') return null;

  const text = value.trim();
  if (!text.length) return null;
  if (!restoreStringifiedNumber) return text;

  // 双重校验避免误转：Number.isSafeInteger 排除精度不可靠的超大值，
  // String(n) === text 排除前导零（"007"）、正号、小数、科学计数法等
  // 往返不一致的情形。酷狗的 hex hash 与 bilibili 的 BV 号因此不受影响。
  const numericId = Number(text);
  return Number.isSafeInteger(numericId) && String(numericId) === text
    ? numericId
    : text;
}

export function extractTitle(rawSong: any): string {
  return String(rawSong.title ?? rawSong.name ?? rawSong.songname ?? '').trim();
}

/**
 * 从备份歌曲对象中提取本地文件路径
 * 优先使用 localPath，其次解码 file:// URL，最后检查 qualities 中的本地路径
 */
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

/** 为带有本地文件路径的歌曲创建 Song 对象 */
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
    // rawData 包含完整的插件搜索结果（含 qualities/privilege/singerList 等深层嵌套对象），
    // 这些数据仅用于播放时传给插件引擎，不需要响应式追踪。
    // 使用 markRaw 阻止 Vue 为每个嵌套属性创建代理，避免大量歌曲时界面卡顿。
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

  // musicItem 会原样传给插件，其 id 必须保留原始标量类型（详见 normalizeTrackId）。
  // 回退到字符串 id 以保证字段始终存在。
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