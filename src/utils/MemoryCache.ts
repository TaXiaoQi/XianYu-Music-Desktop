type MemoryCacheOptions = {
  maxEntries: number;
  ttlMs: number;
};

type CacheEntry<V> = {
  value: V;
  expiresAt: number;
};

type MemoryCacheStats = {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  expired: number;
  maxEntries: number;
  ttlMs: number;
};

export class MemoryCache<K, V> {
  private readonly store = new Map<K, CacheEntry<V>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private expired = 0;

  constructor({ maxEntries, ttlMs }: MemoryCacheOptions) {
    this.maxEntries = Math.max(0, maxEntries);
    this.ttlMs = Math.max(0, ttlMs);
  }

  private isExpired(entry: CacheEntry<V>, now: number) {
    return entry.expiresAt <= now;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }

    const now = Date.now();
    if (this.isExpired(entry, now)) {
      this.store.delete(key);
      this.expired += 1;
      this.misses += 1;
      return undefined;
    }

    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  set(key: K, value: V) {
    if (this.store.has(key)) {
      this.store.delete(key);
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });

    this.prune();
  }

  has(key: K) {
    const entry = this.store.get(key);
    if (!entry) {
      return false;
    }

    if (this.isExpired(entry, Date.now())) {
      this.store.delete(key);
      this.expired += 1;
      return false;
    }

    return true;
  }

  delete(key: K) {
    return this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  prune() {
    const now = Date.now();

    for (const [key, entry] of this.store) {
      if (this.isExpired(entry, now)) {
        this.store.delete(key);
        this.expired += 1;
      }
    }

    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value as K | undefined;
      if (oldestKey === undefined) {
        break;
      }

      this.store.delete(oldestKey);
      this.evictions += 1;
    }
  }

  size() {
    this.prune();
    return this.store.size;
  }

  snapshot() {
    this.prune();
    return new Map(
      Array.from(this.store.entries(), ([key, entry]) => [key, entry.value] as const),
    );
  }

  stats(): MemoryCacheStats {
    this.prune();
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      expired: this.expired,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
    };
  }
}
