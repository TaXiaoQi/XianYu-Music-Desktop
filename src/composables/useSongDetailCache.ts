import { libraryApi } from "../services/tauri/libraryApi";
import type { SongDetail } from "../types";
import { MemoryCache } from "../utils/MemoryCache";

// 曲目详情缓存参数：有效期 5 分钟，最多保留 8 条记录
const DETAIL_TTL_MS = 5 * 60 * 1000;
const DETAIL_MAX_ENTRIES = 8;

const detailCache = new MemoryCache<string, SongDetail>({
    ttlMs: DETAIL_TTL_MS,
    maxEntries: DETAIL_MAX_ENTRIES,
});

// 尚未返回的详情请求，按路径索引，用于合并同曲目的重复拉取
const pendingDetailLoads = new Map<string, Promise<SongDetail>>();

export function useSongDetailCache() { // 实现
    /**
     * 读取曲目详情：先查缓存，再复用在途请求，
     * 都未命中时才真正发起调用，并在成功后写入缓存。
     */
    const loadSongDetail = async (path: string) => {
        if (!path) {
            return null;
        }

        const hitCache = detailCache.get(path);
        if (hitCache) {
            return hitCache;
        }

        const hitPending = pendingDetailLoads.get(path);
        if (hitPending) {
            return hitPending;
        }

        const pending = libraryApi
            .getSongDetail(path)
            .then((detail) => {
                detailCache.set(path, detail);
                return detail;
            })
            .finally(() => {
                pendingDetailLoads.delete(path);
            });

        pendingDetailLoads.set(path, pending);
        return pending;
    };

    const clearSongDetailCache = () => {
        detailCache.clear();
        pendingDetailLoads.clear();
    };

    return {
        loadSongDetail,
        clearSongDetailCache,
    };
}
