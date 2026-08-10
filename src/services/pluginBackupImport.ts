import { markRaw } from 'vue';

import type { PluginSearchResult, PluginSource, Song } from '../types';
import type { LxSearchResultItem } from './lxMusicSdk';
import { readPluginFile } from './tauri/pluginApi';

export type SupportedPluginBackupFormat = 'bakamusic' | 'musicfree';

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
function extractSongId(rawSong: any): string {
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

function extractTitle(rawSong: any): string {
  return String(rawSong.title ?? rawSong.name ?? rawSong.songname ?? '').trim();
}

/**
 * 从备份歌曲对象中提取本地文件路径
 * 优先使用 localPath，其次解码 file:// URL，最后检查 qualities 中的本地路径
 */
function resolveLocalPath(rawSong: any): string {
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
function createLocalSong(rawSong: any, localPath: string): Song {
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

function createMusicFreeSong(
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

interface DetectedBackup {
  format: SupportedPluginBackupFormat;
  sheets: any[];
  /** 备份声明的版本号；缺失或非数字时为 null */
  version: number | null;
  /** 是否需要还原被字符串化的数字 ID */
  restoreStringifiedIds: boolean;
}

/**
 * 通过分析歌曲数据中的字段特征来推断备份来源。
 *
 * BakaMusic 歌曲倾向使用：artist, title, album
 * MusicFree 歌曲倾向使用：singer, name, albumName
 *
 * 通过统计这些特征字段的出现比例来判断格式。
 */
function inferFormatFromSongFields(sheets: any[]): SupportedPluginBackupFormat | null {
  let bakaScore = 0;
  let mfScore = 0;
  let sampleCount = 0;
  const MAX_SAMPLES = 50; // 只采样前 50 首歌曲，避免大文件解析过慢

  for (const sheet of sheets) {
    const musicList = Array.isArray(sheet?.musicList) ? sheet.musicList : [];
    for (const song of musicList) {
      if (sampleCount >= MAX_SAMPLES) break;
      sampleCount++;

      // BakaMusic 特征：使用 artist（而非 singer）
      if (typeof song.artist === 'string' && song.artist.trim()) bakaScore += 2;
      // BakaMusic 特征：使用 title（而非 name）作为歌曲名
      if (typeof song.title === 'string' && song.title.trim() && !song.name) bakaScore += 1;
      // BakaMusic 特征：使用 album（而非 albumName）
      if (typeof song.album === 'string' && song.album.trim() && !song.albumName) bakaScore += 1;

      // MusicFree 特征：使用 singer（而非 artist）
      if (typeof song.singer === 'string' && song.singer.trim()) mfScore += 2;
      // MusicFree 特征：使用 name（而非 title）作为歌曲名
      if (typeof song.name === 'string' && song.name.trim() && !song.title) mfScore += 1;
      // MusicFree 特征：使用 albumName（而非 album）
      if (typeof song.albumName === 'string' && song.albumName.trim()) mfScore += 1;
      // MusicFree 特征：使用 musicId（BakaMusic 用 id）
      if (song.musicId !== undefined && song.id === undefined) mfScore += 2;
    }
    if (sampleCount >= MAX_SAMPLES) break;
  }

  // 需要明显的差异才做判断，避免误判
  if (sampleCount === 0) return null;
  const threshold = Math.max(sampleCount * 0.3, 2); // 至少有 30% 的差异或 2 分
  if (bakaScore > mfScore + threshold) return 'bakamusic';
  if (mfScore > bakaScore + threshold) return 'musicfree';
  return null;
}

/**
 * 检测备份数据中是否包含 Toskysun 标识（BakaMusic 的开发者）。
 * 如果存在则一定是 BakaMusic 格式。
 */
function getBackupIdentityFields(data: any): string[] {
  return [
    data?.author,
    data?.creator,
    data?.exportedBy,
    data?.appName,
    data?.app,
    data?.data?.author,
    data?.data?.creator,
    data?.schema,
  ]
    .filter((field): field is string => typeof field === 'string')
    .map(field => field.normalize('NFKC').trim().toLowerCase());
}

function hasToskysunSignature(data: any): boolean {
  return getBackupIdentityFields(data).some(field => field.includes('toskysun'));
}

/**
 * 检测明确的 MusicFree 作者标识。
 * 时迁酱的插件可能带有类似 Baka 的音质字段，因此身份标识应优先于结构和字段推断。
 */
function hasMusicFreeAuthorSignature(data: any): boolean {
  return getBackupIdentityFields(data).some(field => field.includes('时迁酱'));
}

/**
 * 识别备份格式与版本。
 *
 * 检测策略（按优先级）：
 * 1. schema 字段明确标识 BakaMusic
 * 2. 作者身份：Toskysun → BakaMusic；时迁酱 → MusicFree
 * 3. 结构特征：data.musicSheets（嵌套）→ 倾向 BakaMusic；顶层 musicSheets → 倾向 MusicFree
 * 4. 歌曲字段特征：通过 artist/singer、title/name 等字段的使用模式区分
 *
 * 版本策略：只用于决定是否还原字符串化的数字 ID，不做版本白名单拦截。
 * 作为导入方应尽量宽容——遇到未知版本仍照常解析，只是不做迁移，
 * 而不是因为版本号不认识就拒绝用户的文件。
 */
function detectBackup(data: any): DetectedBackup {
  const version = typeof data?.version === 'number' ? data.version : null;

  // 1. BakaMusic: schema 字段存在时优先判定（最可靠的标识）
  if (typeof data?.schema === 'string' && data.schema.startsWith('bakamusic')) {
    const sheets = Array.isArray(data?.data?.musicSheets) ? data.data.musicSheets
      : Array.isArray(data?.musicSheets) ? data.musicSheets
      : [];
    return {
      format: 'bakamusic',
      sheets,
      version,
      restoreStringifiedIds: version === STRINGIFIED_TRACK_ID_BACKUP_VERSION,
    };
  }

  // 2. 作者身份标识优先于结构和歌曲字段推断
  const nestedSheets = Array.isArray(data?.data?.musicSheets) ? data.data.musicSheets : null;
  const topLevelSheets = Array.isArray(data?.musicSheets) ? data.musicSheets : null;
  const identifiedSheets = nestedSheets ?? topLevelSheets ?? [];

  // Toskysun 是 BakaMusic 开发者，有此标识则必为 BakaMusic
  if (hasToskysunSignature(data)) {
    return {
      format: 'bakamusic',
      sheets: identifiedSheets,
      version,
      restoreStringifiedIds: version === STRINGIFIED_TRACK_ID_BACKUP_VERSION,
    };
  }

  // 时迁酱是 MusicFree 作者，即使结构或歌曲字段像 Baka 也强制按 MusicFree 处理
  if (hasMusicFreeAuthorSignature(data)) {
    return {
      format: 'musicfree',
      sheets: identifiedSheets,
      version,
      restoreStringifiedIds: false,
    };
  }

  // 3. 按结构特征初步判断，再用歌曲字段特征验证/修正

  if (nestedSheets) {
    // 结构上像 BakaMusic（嵌套在 data 下），但用歌曲字段验证
    const inferred = inferFormatFromSongFields(nestedSheets);
    // 如果歌曲字段明确指向 MusicFree，则修正判断
    if (inferred === 'musicfree') {
      return { format: 'musicfree', sheets: nestedSheets, version, restoreStringifiedIds: false };
    }
    // 否则保持 BakaMusic 判断
    return {
      format: 'bakamusic',
      sheets: nestedSheets,
      version,
      restoreStringifiedIds: version === STRINGIFIED_TRACK_ID_BACKUP_VERSION,
    };
  }

  if (topLevelSheets) {
    // 结构上像 MusicFree（顶层 musicSheets），但用歌曲字段验证
    const inferred = inferFormatFromSongFields(topLevelSheets);
    // 如果歌曲字段明确指向 BakaMusic，则修正判断
    if (inferred === 'bakamusic') {
      return {
        format: 'bakamusic',
        sheets: topLevelSheets,
        version,
        restoreStringifiedIds: version === STRINGIFIED_TRACK_ID_BACKUP_VERSION,
      };
    }
    // 否则保持 MusicFree 判断
    return { format: 'musicfree', sheets: topLevelSheets, version, restoreStringifiedIds: false };
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

  const { format, sheets, version, restoreStringifiedIds } = detectBackup(data);
  const playlists: PluginBackupPlaylist[] = [];
  const failures: PluginBackupFailedSong[] = [];
  const associationMap = new Map<string, PluginBackupAssociation>();
  const missingPluginMap = new Map<string, MissingBackupPlugin>();
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
  const formatName = prepared.format === 'bakamusic' ? 'BakaMusic' : 'MusicFree';
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
