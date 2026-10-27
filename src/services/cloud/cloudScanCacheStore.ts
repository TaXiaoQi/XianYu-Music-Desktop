// 网盘页全量扫描结果落盘缓存（每 provider|account 一条），对应移动端反馈
// 「网盘第一次扫完之后关闭软件再次进入就空了，需要重新扫」——全量遍历是
// 几十上百次 listDir 往返，重启即丢不可接受。路径/文件 JSON 非敏感
// （不含凭据），明文 localStorage：key `xianyu_cloud_scan_cache_v1`，
// 结构 `{"<providerId>|<accountId>": { savedAt, files }}`，TTL 24h，
// 超时或手动强刷后重扫。条目数超限丢弃最旧条目，写盘失败降级为内存缓存。

import type { CloudFile } from './cloudTypes';

const K_SCAN_CACHE_KEY = 'xianyu_cloud_scan_cache_v1';

/** 缓存有效期：超过后视为过期，重新全量扫描。 */
const SCAN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** 单条目最多缓存文件数：防极端大网盘撑爆 localStorage（5MB 限额）。 */
const SCAN_CACHE_MAX_FILES = 8000;

export interface CachedScan {
  savedAt: number;
  files: CloudFile[];
}

type ScanCacheMap = Record<string, CachedScan>;

const entryKey = (providerId: string, accountId: string): string =>
  `${providerId}|${accountId}`;

/** 稳定序列化（键排序后 JSON）：内容对比用，不依赖键插入顺序。 */
function stableJson(map: ScanCacheMap): string {
  const entries = Object.entries(map).sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  );
  return JSON.stringify(Object.fromEntries(entries));
}

export class CloudScanCacheStore {
  private static _instance: CloudScanCacheStore | null = null;

  static get instance(): CloudScanCacheStore {
    if (!CloudScanCacheStore._instance) {
      CloudScanCacheStore._instance = new CloudScanCacheStore();
    }
    return CloudScanCacheStore._instance;
  }

  /** 内存缓存；首读后有效。改动即回写落盘。 */
  private _cache: ScanCacheMap | null = null;

  private constructor() {}

  private _ensureLoaded(): ScanCacheMap {
    if (this._cache) return this._cache;
    const map: ScanCacheMap = {};
    try {
      const stored = localStorage.getItem(K_SCAN_CACHE_KEY);
      if (stored) {
        const raw: unknown = JSON.parse(stored);
        if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
          for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
            if (
              typeof v === 'object' &&
              v !== null &&
              Array.isArray((v as CachedScan).files) &&
              typeof (v as CachedScan).savedAt === 'number'
            ) {
              const { savedAt, files } = v as CachedScan;
              map[k] = { savedAt, files: files.filter(Boolean) };
            }
          }
        }
      }
    } catch (e) {
      console.warn('[cloud] 网盘扫描缓存读取失败:', e);
    }
    this._cache = map;
    return map;
  }

  private _persist(): void {
    const map = this._cache;
    if (!map) return;
    try {
      localStorage.setItem(K_SCAN_CACHE_KEY, stableJson(map));
    } catch {
      // 超出 localStorage 限额：丢弃 savedAt 最旧的条目后重试一次
      const keys = Object.keys(map);
      if (keys.length > 1) {
        let oldestKey = keys[0] as string;
        for (const k of keys) {
          if ((map[k] as CachedScan).savedAt < (map[oldestKey] as CachedScan).savedAt) {
            oldestKey = k;
          }
        }
        delete map[oldestKey];
        this._persist();
      }
    }
  }

  /** 读取未过期的缓存；过期/缺失返回 null（并顺手清掉过期条目）。 */
  loadFresh(providerId: string, accountId: string): CachedScan | null {
    const map = this._ensureLoaded();
    const hit = map[entryKey(providerId, accountId)];
    if (!hit) return null;
    if (Date.now() - hit.savedAt > SCAN_CACHE_TTL_MS) {
      delete map[entryKey(providerId, accountId)];
      this._persist();
      return null;
    }
    return hit;
  }

  /** 保存扫描结果（超过单条上限时截断）。 */
  save(providerId: string, accountId: string, files: CloudFile[]): void {
    const map = this._ensureLoaded();
    map[entryKey(providerId, accountId)] = {
      savedAt: Date.now(),
      files: files.slice(0, SCAN_CACHE_MAX_FILES),
    };
    this._persist();
  }

  /** 解绑/重绑后按 provider 清理对应账号条目。 */
  invalidate(providerId: string, accountId?: string): void {
    const map = this._ensureLoaded();
    if (accountId) {
      delete map[entryKey(providerId, accountId)];
    } else {
      for (const k of Object.keys(map)) {
        if (k.startsWith(`${providerId}|`)) delete map[k];
      }
    }
    this._persist();
  }
}
