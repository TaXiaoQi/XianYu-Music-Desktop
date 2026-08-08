/**
 * 插件 Cookie & Storage 管理 —— 从 pluginEngine.ts 提取
 *
 * 统一管理插件的 Cookie 和 Storage 操作，供主线程和沙箱代理共用。
 * Cookie 存储在 localStorage 的 __plugin_cookies key 下，
 * Storage 存储在 __plugin_storage_{key} key 下。
 */

// ==================== Cookie 管理 ====================

/** 从 HTTP 响应头中捕获 Set-Cookie，自动存储到 localStorage */
export function captureCookiesFromResponse(url: string, responseHeaders: Record<string, string>): void {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const cookieStore = JSON.parse(localStorage.getItem('__plugin_cookies') || '{}');
    const setCookie = responseHeaders['set-cookie'] || responseHeaders['Set-Cookie'];
    if (setCookie) {
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      for (const c of cookies) {
        const parts = c.split(';')[0].split('=');
        if (parts.length >= 2) {
          const name = parts[0].trim();
          const value = parts.slice(1).join('=').trim();
          cookieStore[name] = { value, domain };
        }
      }
      localStorage.setItem('__plugin_cookies', JSON.stringify(cookieStore));
    }
  } catch { /* ignore */ }
}

/** 手动设置 Cookie（对应 @react-native-cookies/cookies.set） */
export function setCookie(url: string, cookie: { name: string; value: string; domain?: string }): boolean {
  try {
    const urlObj = new URL(url);
    const domain = cookie.domain || urlObj.hostname;
    const store = JSON.parse(localStorage.getItem('__plugin_cookies') || '{}');
    store[cookie.name] = { ...cookie, domain };
    localStorage.setItem('__plugin_cookies', JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

/** 获取指定 URL 的所有 Cookie（对应 @react-native-cookies/cookies.get） */
export function getCookies(url: string): Record<string, any> {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const store = JSON.parse(localStorage.getItem('__plugin_cookies') || '{}');
    const result: Record<string, any> = {};
    for (const [name, info] of Object.entries(store)) {
      const c = info as any;
      if (c.domain && (domain.includes(c.domain) || c.domain.includes(domain))) {
        result[name] = c;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** 清空所有 Cookie（对应 @react-native-cookies/cookies.flush） */
export function flushCookies(): void {
  // localStorage 中的 cookie store 是即时写入的，无需额外 flush
}

// ==================== Storage 管理 ====================

/** 设置插件存储项（对应 musicfree/storage.setItem） */
export function setStorageItem(key: string, value: unknown): void {
  localStorage.setItem(`__plugin_storage_${key}`, typeof value === 'string' ? value : JSON.stringify(value));
}

/** 获取插件存储项（对应 musicfree/storage.getItem） */
export function getStorageItem(key: string): string | null {
  return localStorage.getItem(`__plugin_storage_${key}`);
}

/** 删除插件存储项（对应 musicfree/storage.removeItem） */
export function removeStorageItem(key: string): void {
  localStorage.removeItem(`__plugin_storage_${key}`);
}
