// 网盘已选文件夹存储（每账号多路径），移植自移动端
// lib/src/cloud/cloud_folder_selection_store.dart。
//
// 路径不是敏感数据，明文 localStorage JSON：key `xianyu_cloud_folder_sel_v1`，
// 结构 `{"<providerId>|<accountId>": [path, ...]}`。桌面端无选择 UI，数据来自
// 跨设备同步（凭据密封串 `__fsel__` 保留键），供搜索/日推范围遍历消费。

const K_FOLDER_SEL_KEY = 'xianyu_cloud_folder_sel_v1';

/** 目录标识：`providerId|accountId`。 */
export const cloudFolderSelKey = (providerId: string, accountId: string): string =>
  `${providerId}|${accountId}`;

type FolderSelMap = Record<string, string[]>;

export class CloudFolderSelectionStore {
  private static _instance: CloudFolderSelectionStore | null = null;

  static get instance(): CloudFolderSelectionStore {
    if (!CloudFolderSelectionStore._instance) {
      CloudFolderSelectionStore._instance = new CloudFolderSelectionStore();
    }
    return CloudFolderSelectionStore._instance;
  }

  /** 内存缓存；首读后有效。改动即回写落盘。 */
  private _cache: FolderSelMap | null = null;

  private constructor() {}

  private _ensureLoaded(): FolderSelMap {
    if (this._cache) return this._cache;
    const map: FolderSelMap = {};
    try {
      const stored = localStorage.getItem(K_FOLDER_SEL_KEY);
      if (stored) {
        const raw: unknown = JSON.parse(stored);
        if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
          for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
            if (Array.isArray(v)) {
              const paths = v.filter((p): p is string => typeof p === 'string' && p !== '');
              if (paths.length > 0) map[k] = paths;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[cloud] 网盘已选文件夹读取失败:', e);
    }
    this._cache = map;
    return map;
  }

  private _persist(): void {
    const map = this._cache;
    if (!map) return;
    try {
      localStorage.setItem(K_FOLDER_SEL_KEY, JSON.stringify(map));
    } catch (e) {
      console.warn('[cloud] 网盘已选文件夹写入失败:', e);
    }
  }

  /** 某账号已选文件夹路径列表（未选过返回空）。 */
  async pathsFor(providerId: string, accountId: string): Promise<string[]> {
    const map = this._ensureLoaded();
    return map[cloudFolderSelKey(providerId, accountId)] ?? [];
  }

  /** 全量导出（跨设备同步随凭据密封串携带）。 */
  async allPaths(): Promise<FolderSelMap> {
    const map = this._ensureLoaded();
    return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v]]));
  }

  /** 合并云端目录选择（并集去重，不动本地已有条目）。 */
  async mergePaths(incoming: FolderSelMap): Promise<void> {
    if (Object.keys(incoming).length === 0) return;
    const map = this._ensureLoaded();
    let changed = false;
    for (const [k, v] of Object.entries(incoming)) {
      const paths = v.filter((p) => typeof p === 'string' && p !== '');
      if (paths.length === 0) continue;
      const merged = [...(map[k] ?? [])];
      for (const p of paths) {
        if (!merged.includes(p)) merged.push(p);
      }
      if (merged.length !== (map[k]?.length ?? 0)) {
        map[k] = merged;
        changed = true;
      }
    }
    if (!changed) return;
    this._persist();
  }
}
