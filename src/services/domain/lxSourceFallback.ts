/**
 * 落雪音源自动换源服务
 *
 * 当 lx:// 歌曲在某个音源起播失败时，由 Rust 后端在其余落雪平台搜索同名同歌手的歌曲，
 * 构造新的 Song 对象返回，供 playerPlayback 递归调用 playSong 重试。
 *
 * [项4 源回退集中] 搜索、匹配、URL 解析均由 Rust 后端完成，前端只上报失败集和参数。
 * Rust 后端自带搜索结果缓存（5 分钟）+ URL 缓存（10 分钟）+ 主备 API 自动切换。
 */

import type { Song } from '../../types';
import { LX_SOURCE_NAMES, type LxSourceId } from './lxMusicSdk';
import { cacheLxSong } from './lxSongCache';
import { cacheLxSongInfo } from './lxLyricFetcher';
import { parseIntervalToSeconds } from '../../utils/remoteSong';
import { pluginApi } from '../tauri/pluginApi';
import type { AlternativeSourceResultContract } from '../tauri/contracts';

/**
 * 将 Rust 返回的换源结果转换为 Song 对象
 * 参考 Search.vue handlePlaySong 的构造方式
 */
function buildSongFromRustResult(result: AlternativeSourceResultContract): Song {
  const songDuration = parseIntervalToSeconds(result.interval);
  const artistNames = result.singer
    ? result.singer.split('、').filter(Boolean)
    : ['未知歌手'];

  const song: Song = {
    name: result.name,
    title: result.name,
    path: `lx://${result.source}/${result.songmid}`,
    artist: result.singer || '未知歌手',
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album: result.albumName || '未知专辑',
    album_artist: result.singer || '未知歌手',
    album_key: `${result.albumName || '未知专辑'}-${result.singer || '未知歌手'}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: songDuration,
    cover_thumb_path: result.img || '',
    source_type: 'remote',
    remote_source_id: `lx://${result.source}/${result.songmid}`,
  } as any;

  // 挂载 LX 解析所需元信息（与 Search.vue 一致）
  (song as any)._hash = result.hash;
  (song as any)._types = result.lxTypes;
  (song as any)._copyrightId = result.copyrightId;
  (song as any)._songmid = result.songmid;
  (song as any)._source = result.source;

  return song;
}

/**
 * 缓存换源结果（供 playerPlayback 解析 URL 和歌词时使用）
 */
function cacheLxItemFromRustResult(result: AlternativeSourceResultContract): void {
  // 构造 LxSearchResultItem 兼容格式供 cacheLxSong / cacheLxSongInfo 使用
  const songDuration = parseIntervalToSeconds(result.interval);
  cacheLxSong({
    name: result.name,
    singer: result.singer,
    albumName: result.albumName,
    albumId: result.albumId,
    songmid: result.songmid,
    source: result.source as LxSourceId,
    interval: result.interval,
    img: result.img ?? null,
    types: [],
    _types: Object.fromEntries(
      Object.entries(result.lxTypes || {}).map(([k, v]) => [
        k,
        { size: v.size ?? null, hash: v.hash },
      ]),
    ),
    hash: result.hash || undefined,
    strMediaMid: result.strMediaMid || undefined,
    songId: typeof result.songId === 'number' ? result.songId : undefined,
    albumMid: result.albumMid || undefined,
    copyrightId: result.copyrightId || undefined,
  });
  cacheLxSongInfo(result.source as LxSourceId, result.songmid, {
    songmid: result.songmid,
    hash: result.hash || undefined,
    name: result.name,
    singer: result.singer,
    albumName: result.albumName,
    interval: result.interval,
    _interval: songDuration > 0 ? Math.round(songDuration) : undefined,
    songId: typeof result.songId === 'number' ? result.songId : undefined,
    strMediaMid: result.strMediaMid || undefined,
    albumMid: result.albumMid || undefined,
    albumId: result.albumId,
    copyrightId: result.copyrightId || undefined,
    source: result.source,
  });
}

/**
 * 查找替代落雪音源
 *
 * [项4 源回退集中] 搜索、匹配、URL 解析全部由 Rust 后端完成。
 * 前端只上报失败源集合和音质候选列表，Rust 负责串行搜索 → 匹配 → URL 解析。
 *
 * @param song 失败的原歌曲
 * @param failedSources 已失败的音源集合（包含当前音源）
 * @param qualities 音质候选列表（从高到低），传给 Rust 一并解析 URL
 * @returns 新的 Song 对象，或 null（未找到匹配）
 */
export async function findAlternativeLxSource(
  song: Song,
  failedSources: Set<string>,
  qualities: string[] = [],
): Promise<Song | null> {
  // 提取歌手名用于搜索关键词
  const artistStr = song.effective_artist_names?.length
    ? song.effective_artist_names.join('、')
    : song.artist || '';

  try {
    const result = await pluginApi.findAlternativeLxSource(
      song.name,
      artistStr,
      song.duration || 0,
      Array.from(failedSources),
      qualities,
    );

    if (!result) return null;

    // 缓存搜索结果（供后续 URL 解析和歌词获取使用）
    cacheLxItemFromRustResult(result);

    return buildSongFromRustResult(result);
  } catch (e: any) {
    console.warn(`[lxSourceFallback] Rust 换源失败: ${e?.message || e}`);
    return null;
  }
}

/**
 * 获取音源的显示名称（供 toast 提示使用）
 */
export function getLxSourceDisplayName(source: string): string {
  return LX_SOURCE_NAMES[source as LxSourceId] ?? '在线';
}
