// 移植自移动端 lib/src/cloud/direct_link_cache.dart
// 网盘直链内存缓存。
//
// key = cloud:// path（provider/account/file 唯一标识）；值 = 直链 + 失效
// 时刻。失效判定：expireAt（provider 给出）或默认 TTL 兜底。播放中直链
// 异常（起播失败/时长异常）由播放层主动 invalidate 后重取一次。

import { CloudDirectLink } from './cloudTypes';

interface DirectLinkCacheEntry {
  link: CloudDirectLink;
  cachedAt: number;
}

export class DirectLinkCache {
  private static _instance: DirectLinkCache | null = null;

  static get instance(): DirectLinkCache {
    if (!DirectLinkCache._instance) {
      DirectLinkCache._instance = new DirectLinkCache();
    }
    return DirectLinkCache._instance;
  }

  private _map = new Map<string, DirectLinkCacheEntry>();

  private constructor() {}

  async get(
    key: string,
    defaultTtlMs: number,
    opts: { allowExpired?: boolean } = {},
  ): Promise<CloudDirectLink | null> {
    const e = this._map.get(key);
    if (!e) return null;
    const expireMs = e.link.expireAt != null ? e.link.expireAt.getTime() : e.cachedAt + defaultTtlMs;
    if (Date.now() > expireMs) {
      if (!opts.allowExpired) return null;
    }
    return e.link;
  }

  put(key: string, link: CloudDirectLink): void {
    this._map.set(key, { link, cachedAt: Date.now() });
  }

  /** 直链失效后清缓存重取（重取失败保留旧值做一次兜底重试由调用方决定）。 */
  invalidate(key: string): void {
    this._map.delete(key);
  }

  clear(): void {
    this._map.clear();
  }
}
