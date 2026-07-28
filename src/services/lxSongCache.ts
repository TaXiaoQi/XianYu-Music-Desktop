/**
 * LX 搜索结果缓存
 *
 * 搜索结果中的歌曲包含 hash/strMediaMid/copyrightId 等字段，
 * 播放时 lxPluginGetMusicUrl 需要这些字段才能正确解析 URL。
 * 此缓存确保切歌/队列播放时仍能获取到完整的歌曲元信息。
 */
import type { LxSearchResultItem } from './lxMusicSdk';

const _cache = new Map<string, LxSearchResultItem>();

function makeKey(source: string, songmid: string): string {
  return `${source}/${songmid}`;
}

export function cacheLxSong(item: LxSearchResultItem): void {
  _cache.set(makeKey(item.source, item.songmid), item);
}

export function getCachedLxSong(source: string, songmid: string): LxSearchResultItem | null {
  return _cache.get(makeKey(source, songmid)) ?? null;
}

export function clearLxSongCache(): void {
  _cache.clear();
}
