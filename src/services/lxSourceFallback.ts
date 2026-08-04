/**
 * 落雪音源自动换源服务
 *
 * 当 lx:// 歌曲在某个音源起播失败时，在其余落雪平台搜索同名同歌手的歌曲，
 * 构造新的 Song 对象返回，供 playerPlayback 递归调用 playSong 重试。
 *
 * 匹配规则：歌名归一化相等 + 歌手有交集 + 时长接近（±5s 辅助）
 * 搜索策略：串行（按平台优先级 kw > tx > wy > kg > mg），找到即返回
 */

import type { Song } from '../types';
import {
  lxSearch,
  LX_SOURCE_NAMES,
  type LxSourceId,
  type LxSearchResultItem,
} from './lxMusicSdk';
import { cacheLxSong } from './lxSongCache';
import { cacheLxSongInfo } from './lxLyricFetcher';
import { parseIntervalToSeconds } from '../utils/remoteSong';

/** 平台尝试优先级（kw 优先，与落雪默认顺序一致） */
const SOURCE_PRIORITY: LxSourceId[] = ['kw', 'tx', 'wy', 'kg', 'mg'];

/** 时长匹配容差（秒） */
const DURATION_TOLERANCE_SEC = 5;

/**
 * 归一化歌名：trim + toLowerCase + 去除首尾标点/空白
 */
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '');
}

/**
 * 拆分歌手名：支持 、,/& 等分隔符，返回小写数组
 */
function splitArtists(singer: string): string[] {
  return singer
    .split(/[、,/&]|\s+feat\.\s+/i)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * 判断两个歌手集合是否有交集
 */
function artistsIntersect(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const setB = new Set(b);
  return a.some(x => setB.has(x));
}

/**
 * 判断搜索结果是否匹配原歌曲
 * - 歌名归一化相等（必须）
 * - 歌手有交集（原曲歌手已知时必须；为空时跳过）
 * - 时长接近 ±5s（原曲时长已知时辅助校验）
 */
function isMatch(
  item: LxSearchResultItem,
  targetName: string,
  targetArtists: string[],
  targetDuration: number,
): boolean {
  if (normalizeName(item.name) !== targetName) return false;
  // 原曲歌手已知时要求交集；未知时仅靠歌名+时长
  if (targetArtists.length > 0) {
    const itemArtists = splitArtists(item.singer || '');
    if (!artistsIntersect(targetArtists, itemArtists)) return false;
  }
  // 时长辅助校验（原曲时长已知时）
  if (targetDuration > 0) {
    const itemDuration = parseIntervalToSeconds(item.interval);
    if (itemDuration > 0 && Math.abs(itemDuration - targetDuration) > DURATION_TOLERANCE_SEC) {
      return false;
    }
  }
  return true;
}

/**
 * 从 LxSearchResultItem 构造 Song 对象
 * 参考 Search.vue handlePlaySong 的构造方式
 */
function buildSongFromLxItem(item: LxSearchResultItem): Song {
  const songDuration = parseIntervalToSeconds(item.interval);
  const artistNames = item.singer
    ? item.singer.split('、').filter(Boolean)
    : ['未知歌手'];

  const song: Song = {
    name: item.name,
    title: item.name,
    path: `lx://${item.source}/${item.songmid}`,
    artist: item.singer || '未知歌手',
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album: item.albumName || '未知专辑',
    album_artist: item.singer || '未知歌手',
    album_key: `${item.albumName || '未知专辑'}-${item.singer || '未知歌手'}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: songDuration,
    cover_thumb_path: item.img || '',
    source_type: 'remote',
    remote_source_id: `lx://${item.source}/${item.songmid}`,
  } as any;

  // 挂载 LX 解析所需元信息（与 Search.vue 一致）
  (song as any)._hash = item.hash;
  (song as any)._types = item._types;
  (song as any)._copyrightId = item.copyrightId;
  (song as any)._songmid = item.songmid;
  (song as any)._source = item.source;

  return song;
}

/**
 * 缓存搜索结果（供 playerPlayback 解析 URL 和歌词时使用）
 */
function cacheLxItem(item: LxSearchResultItem): void {
  cacheLxSong(item);
  const songDuration = parseIntervalToSeconds(item.interval);
  cacheLxSongInfo(item.source, item.songmid, {
    songmid: item.songmid,
    hash: item.hash,
    name: item.name,
    singer: item.singer,
    albumName: item.albumName,
    interval: item.interval,
    _interval: songDuration > 0 ? Math.round(songDuration) : undefined,
    songId: item.songId,
    strMediaMid: item.strMediaMid,
    albumMid: item.albumMid,
    albumId: item.albumId,
    copyrightId: item.copyrightId,
    source: item.source,
  });
}

/**
 * 从 Song 提取首个有效歌手名作为搜索关键词的一部分
 */
function extractPrimaryArtist(song: Song): string {
  const names = song.effective_artist_names?.length
    ? song.effective_artist_names
    : song.artist_names?.length
      ? song.artist_names
      : [];
  if (names.length > 0 && names[0] && names[0] !== '未知歌手') {
    return names[0];
  }
  // 回退到 artist 字段（可能是 "歌手A、歌手B" 形式）
  if (song.artist && song.artist !== '未知歌手') {
    return song.artist.split(/[、,/&]/)[0].trim();
  }
  return '';
}

/**
 * 查找替代落雪音源
 *
 * @param song 失败的原歌曲
 * @param failedSources 已失败的音源集合（包含当前音源）
 * @returns 新的 Song 对象，或 null（未找到匹配）
 */
export async function findAlternativeLxSource(
  song: Song,
  failedSources: Set<string>,
): Promise<Song | null> {
  // 提取搜索关键词
  const targetName = normalizeName(song.name);
  if (!targetName) return null;

  const primaryArtist = extractPrimaryArtist(song);
  // 歌手为空或"未知歌手"时，仅用歌名搜索（匹配精度降低，但仍尝试）
  const keyword = primaryArtist ? `${song.name} ${primaryArtist}` : song.name;

  const targetArtists = splitArtists(
    song.effective_artist_names?.join('、') || song.artist || '',
  );
  const targetDuration = song.duration || 0;

  // 按优先级串行搜索剩余平台
  const candidates = SOURCE_PRIORITY.filter(s => !failedSources.has(s));

  for (const source of candidates) {
    try {
      const result = await lxSearch(source, keyword, 1);
      // 在搜索结果中查找匹配项
      const matched = result.list.find(item =>
        item.source === source && isMatch(item, targetName, targetArtists, targetDuration),
      );
      if (matched) {
        cacheLxItem(matched);
        return buildSongFromLxItem(matched);
      }
    } catch (e: any) {
      // 单个平台搜索失败（网络异常/接口限流）不中断整体流程，继续尝试下一平台
      console.warn(`[lxSourceFallback] 搜索 ${source} 失败: ${e?.message || e}`);
    }
  }

  return null;
}

/**
 * 获取音源的显示名称（供 toast 提示使用）
 */
export function getLxSourceDisplayName(source: string): string {
  return LX_SOURCE_NAMES[source as LxSourceId] ?? '在线';
}
