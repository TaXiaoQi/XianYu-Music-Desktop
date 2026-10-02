import type { LxSearchResultItem } from "./lxMusicSdk";
const _cache = new Map<string, LxSearchResultItem>(); // 实现
function makeKey(source: string, songmid: string): string { // 实现
    return `${source}/${songmid}`;
} // 实现
export function cacheLxSong(item: LxSearchResultItem): void { // 实现
    _cache.set(makeKey(item.source, item.songmid), item);
} // 实现
export function getCachedLxSong(
    source: string,
    songmid: string,
): LxSearchResultItem | null {
    return _cache.get(makeKey(source, songmid)) ?? null;
} // 实现
