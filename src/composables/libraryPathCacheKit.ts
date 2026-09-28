import { ref } from 'vue';
import type { Ref } from 'vue';

import type { HistoryItem } from '../types';
import type { FolderSortMode, LocalSortMode } from '../services/storage/playerStorage';
import { MemoryCache } from '../utils/MemoryCache';

/** 「全部音乐」视图的取数请求形状。 */
export type AllViewPathDemand = {
  query?: string;
  artistFilter?: string;
  albumFilter?: string;
  sortMode: BackendLocalSortMode;
};

/** 文件夹视图的取数请求形状。 */
export type FolderViewPathDemand = {
  folderPath: string;
  query?: string;
  sortMode: BackendFolderSortMode;
};

/** 歌手/专辑二选一的详情过滤条件，null 表示不过滤。 */
export type CollectionDetailFace = { type: 'artist' | 'album'; name: string } | null;

/** 收藏视图的取数请求形状。 */
export type FavoritePathDemand = {
  favoritePaths: string[];
  query?: string;
  sortMode: BackendLocalSortMode;
  detailFilter?: CollectionDetailFace;
};

/** 最近播放视图的取数请求形状。 */
export type RecentPathDemand = {
  recentSongs: HistoryItem[];
  query?: string;
  sortMode: BackendLocalSortMode;
};

/** 以「路径+播放时间」指纹概括整份历史，避免逐条展开成超长键。 */
export const historyFingerprint = (entries: HistoryItem[]) =>
  entries.map(entry => `${entry.path}\u0002${entry.playedAt}`).join('\u0003');

/** 后端检索接口接受的「本地音乐」排序值（custom 排序完全由前端完成，不下发）。 */
export type BackendLocalSortMode = Exclude<LocalSortMode, 'custom'>;

/** 后端检索接口接受的「文件夹」排序值。 */
export type BackendFolderSortMode = Exclude<FolderSortMode, 'custom'>;

/** 请求过期错误携带的标记码，调用方用它区分「数据已过期」与真实故障。 */
export const STALE_PATH_REQUEST_CODE = 'STALE_LIBRARY_PATH_REQUEST';

/**
 * 一致性守卫：发起请求前用 capture 记录数据版本快照，
 * 回填时用 retains 复核；快照过期则拒绝写入缓存并抛出过期错误。
 */
export interface PathFreshnessGuard {
  capture: () => unknown;
  retains: (token: unknown) => boolean;
}

interface SongPathChannelOptions {
  /** 条目存活时长（毫秒），到期即视为未命中。 */
  ttlMs: number;
  /** 条目容量上限，超出后按最旧先出淘汰，默认 96。 */
  capacity?: number;
  /** 命中后端回填时是否推进版本号，默认推进。 */
  countFillAsChange?: boolean;
}

export interface SongPathChannel {
  /** 版本计数：回填或 reset 时推进，视图层可 watch 它触发重查。 */
  changes: Ref<number>;
  /** 取数入口：命中缓存或未决请求时直接复用，否则发起 loader 并登记。 */
  enqueue: (
    lookupKey: string,
    loader: () => Promise<string[]>,
    freshness?: PathFreshnessGuard,
  ) => Promise<string[]>;
  /** 丢弃全部缓存条目与未决请求，并推进版本号。 */
  reset: () => void;
}

const staleRequestError = () =>
  Object.assign(new Error('Stale library path request'), {
    code: STALE_PATH_REQUEST_CODE,
  });

export const isStalePathRequest = (candidate: unknown): boolean =>
  typeof candidate === 'object'
  && candidate !== null
  && (candidate as { code?: string }).code === STALE_PATH_REQUEST_CODE;

/**
 * 组装「内存缓存 + 未决去重 + 版本计数」三件套的路径检索通道。
 * 各库视图（全部/收藏/最近/歌手/专辑/文件夹）各自持有一个通道实例。
 */
export function createSongPathChannel({
  ttlMs,
  capacity = 96,
  countFillAsChange = true,
}: SongPathChannelOptions): SongPathChannel {
  const entries = new MemoryCache<string, string[]>({ maxEntries: capacity, ttlMs });
  const pending = new Map<string, Promise<string[]>>();
  const changes = ref(0);

  const enqueue = async (
    lookupKey: string,
    loader: () => Promise<string[]>,
    freshness?: PathFreshnessGuard,
  ): Promise<string[]> => {
    const ready = entries.get(lookupKey);
    if (ready) {
      return ready;
    }

    const ongoing = pending.get(lookupKey);
    if (ongoing) {
      return ongoing;
    }

    // 快照必须先于 loader 执行，否则会漏掉请求期间发生的数据变更。
    const token = freshness?.capture();

    const task = loader()
      .then((paths) => {
        if (freshness && !freshness.retains(token)) {
          throw staleRequestError();
        }
        entries.set(lookupKey, paths);
        if (countFillAsChange) {
          changes.value += 1;
        }
        return paths;
      })
      .finally(() => {
        pending.delete(lookupKey);
      });

    pending.set(lookupKey, task);
    return task;
  };

  const reset = () => {
    entries.clear();
    pending.clear();
    changes.value += 1;
  };

  return { changes, enqueue, reset };
}
