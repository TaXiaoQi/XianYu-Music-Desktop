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
