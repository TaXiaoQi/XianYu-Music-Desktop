/**
 * localStorage 薄封装。
 * 每个入口都自带「非浏览器环境」守卫（SSR / 测试期 window 未注入时静默降级），
 * 并统一处理 JSON 编解码；写满时按预定的可丢弃缓存键腾出容量后重试一次。
 */

/** 判定异常是否为存储配额超限（不同浏览器暴露方式不一致）。 */
function isQuotaExceeded(error: unknown): boolean {
  const named = error as { name?: unknown; code?: unknown } | null | undefined;
  return named?.name === 'QuotaExceededError' || named?.code === 22;
}

/**
 * 容量不足时允许优先清除的派生缓存键。
 * 这些键均可由应用数据重建，丢掉后不影响用户数据本身。
 */
const DISPOSABLE_DERIVED_KEYS = [
  'player_recent_song_meta',
  'player_queue_song_meta',
  'player_favorite_song_meta',
  'player_recent_online_history',
] as const;

export const localStore = {
  getString(key: string) {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    const box = localStorage;
    return box.getItem(key);
  },

  setString(key: string, value: string) {
    if (typeof localStorage === 'undefined') {
      return;
    }
    localStorage.setItem(key, value);
  },

  remove(key: string) {
    if (typeof localStorage === 'undefined') {
      return;
    }
    localStorage.removeItem(key);
  },

  clear() {
    if (typeof localStorage === 'undefined') {
      return;
    }
    localStorage.clear();
  },

  getJson<T>(key: string): T | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    const raw = localStorage.getItem(key);
    if (raw === null || raw === '') {
      return null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  setJson(key: string, value: unknown) {
    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error: any) {
      if (!isQuotaExceeded(error)) {
        throw error;
      }

      // 先腾容量：丢弃派生缓存（跳过当前正在写的键），随后重试一次。
      for (const candidate of DISPOSABLE_DERIVED_KEYS) {
        if (candidate !== key && localStorage.getItem(candidate)) {
          localStorage.removeItem(candidate);
        }
      }

      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        console.warn(`[localStore] localStorage 容量超限，跳过写入: ${key}`);
      }
    }
  },
};
