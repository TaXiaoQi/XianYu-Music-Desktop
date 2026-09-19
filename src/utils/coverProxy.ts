import { pluginApi } from '../services/tauri/pluginApi';

const PROXY_COVER_DOMAINS = [
  'hdslb.com',
  'bilivideo.com',
  'y.gtimg.cn',
  'qpic.cn',
  'sycdn.kuwo.cn',
  'music.126.net',
  '163.com',
  'douyin.com',
  'pglstatp-toutiao.com',
  'pangolin-sdk-toutiao.com',
  'bytescm.com',
  'pstatp.com',
  'bytecdn.cn',
  'toutiao.com',
];

export function needsCoverProxy(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('data:') || url.startsWith('asset:')) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'asset.localhost' || host === 'localhost' || host === '127.0.0.1') {
      return false;
    }
  } catch {
    // URL 已由上层校验；解析失败时交由下方判定
  }
  if (url.startsWith('http://')) return true;
  return PROXY_COVER_DOMAINS.some(domain => url.includes(domain));
}

const coverProxyCache = new Map<string, string>();
const coverProxyAttempted = new Set<string>();
const proxyPending = new Set<string>();

export function getDisplayCoverUrl(url: string, onReady?: (dataUrl: string) => void): string {
  if (!url) return '';

  const cached = coverProxyCache.get(url);
  if (cached) return cached;

  if (!needsCoverProxy(url)) return url;

  if (proxyPending.has(url) || coverProxyAttempted.has(url)) return '';

  proxyPending.add(url);

  (async () => {
    try {
      const dataUrl = await pluginApi.proxyImage(url);
      coverProxyCache.set(url, dataUrl);
      onReady?.(dataUrl);
    } catch (e) {
      coverProxyAttempted.add(url);
      console.error('[coverProxy] getDisplayCoverUrl 代理失败', url, e);
    } finally {
      proxyPending.delete(url);
    }
  })();

  return '';
}

export async function tryProxyImage(url: string): Promise<string | null> {
  if (!url || url.startsWith('data:') || url.startsWith('asset:')) return null;

  const cached = coverProxyCache.get(url);
  if (cached) return cached;

  if (proxyPending.has(url) || coverProxyAttempted.has(url)) return null;

  proxyPending.add(url);
  try {
    const dataUrl = await pluginApi.proxyImage(url);
    coverProxyCache.set(url, dataUrl);
    return dataUrl;
  } catch (e) {
    coverProxyAttempted.add(url);
    console.error('[coverProxy] tryProxyImage 代理失败', url, e);
    return null;
  } finally {
    proxyPending.delete(url);
  }
}

export function clearCoverProxyCache(): void {
  coverProxyCache.clear();
  coverProxyAttempted.clear();
  proxyPending.clear();
}