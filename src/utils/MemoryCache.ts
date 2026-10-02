/**
 * 进程内 LRU + TTL 缓存。
 * Map 保持插入序：命中即重新插入实现「最近使用」语义；
 * 清理时先剔除过期项，再按插入序逐出最老的条目直至容量达标。
 */

type MemoryCacheOptions = { // 实现
    maxEntries: number;
    ttlMs: number;
};

type CacheCell<V> = {
    value: V;
    expiresAt: number;
};

type MemoryCacheStats = { // 实现
    size: number;
    hits: number;
    misses: number;
    evictions: number;
    expired: number;
    maxEntries: number;
    ttlMs: number;
};

class MemoryCache<K, V> {
    private readonly entries = new Map<K, CacheCell<V>>();
    private readonly capacity: number;
    private readonly lifetimeMs: number;
    private hitCount = 0;
    private missCount = 0;
    private evictionCount = 0;
    private expiryCount = 0;

    constructor({ maxEntries, ttlMs }: MemoryCacheOptions) {
        this.capacity = Math.max(0, maxEntries);
        this.lifetimeMs = Math.max(0, ttlMs);
    }

    /** 是否已越过过期时刻。 */
    private stale(cell: CacheCell<V>, now: number): boolean {
        return cell.expiresAt <= now;
    }

    /** 取出仍有效的条目；过期条目顺带清除并视为不存在。 */
    private take(key: K): CacheCell<V> | null {
        const cell = this.entries.get(key);
        if (cell === undefined) {
            return null;
        }

        if (this.stale(cell, Date.now())) {
            this.entries.delete(key);
            this.expiryCount += 1;
            return null;
        }

        return cell;
    }

    /** 重新插入，把该键挪到「最近使用」位置。 */
    private touch(cell: CacheCell<V>, key: K): void {
        this.entries.delete(key);
        this.entries.set(key, cell);
    }

    get(key: K) {
        const cell = this.take(key);
        if (cell !== null) {
            this.touch(cell, key);
            this.hitCount += 1;
        } else {
            this.missCount += 1;
        }
        return cell?.value;
    }

    set(key: K, value: V) {
        // 先删后插：覆盖旧值的同时刷新插入序。
        this.entries.delete(key);
        this.entries.set(key, {
            value,
            expiresAt: Date.now() + this.lifetimeMs,
        });

        this.prune();
    }

    has(key: K) {
        return this.take(key) !== null;
    }

    delete(key: K) {
        return this.entries.delete(key);
    }

    clear() {
        this.entries.clear();
    }

    /** 惰性清理：先去过期项，再把规模压回容量上限内。 */
    prune(): void {
        const cutoff = Date.now();

        for (const [key, cell] of this.entries) {
            if (this.stale(cell, cutoff)) {
                this.entries.delete(key);
                this.expiryCount += 1;
            }
        }

        while (this.entries.size > this.capacity) {
            const eldest = this.entries.keys().next();
            if (eldest.done === true) {
                break;
            }

            this.entries.delete(eldest.value);
            this.evictionCount += 1;
        }
    }

    size() {
        this.prune();
        return this.entries.size;
    }

    snapshot(): Map<K, V> {
        this.prune();
        const view = new Map<K, V>();
        this.entries.forEach((cell, key) => {
            view.set(key, cell.value);
        });
        return view;
    }

    stats() {
        this.prune();
        const summary: MemoryCacheStats = {
            size: this.entries.size,
            hits: this.hitCount,
            misses: this.missCount,
            evictions: this.evictionCount,
            expired: this.expiryCount,
            maxEntries: this.capacity,
            ttlMs: this.lifetimeMs,
        };
        return summary;
    }
}

export { MemoryCache };
