export const localStore = {
  getString(key: string) {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  },

  setString(key: string, value: string) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  },

  remove(key: string) {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
  },

  clear() {
    if (typeof localStorage === 'undefined') return;
    localStorage.clear();
  },

  getJson<T>(key: string): T | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  setJson(key: string, value: unknown) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e: any) {
      // QuotaExceededError: localStorage 容量超限。
      // 尝试清理已知的大体积键后重试一次，仍失败则静默跳过，不影响播放。
      if (e?.name === 'QuotaExceededError' || e?.code === 22) {
        const disposableKeys = [
          'player_recent_song_meta',
          'player_queue_song_meta',
          'player_favorite_song_meta',
          'player_recent_online_history',
        ];
        for (const dk of disposableKeys) {
          if (dk !== key && localStorage.getItem(dk)) {
            localStorage.removeItem(dk);
          }
        }
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch {
          // 仍然超限，静默跳过
          console.warn(`[localStore] localStorage 容量超限，跳过写入: ${key}`);
        }
      } else {
        throw e;
      }
    }
  },
};
