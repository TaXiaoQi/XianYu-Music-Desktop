import { pluginApi } from '../services/tauri/pluginApi';
import { fileApi } from '../services/tauri/fileApi';

const PROXY_COVER_DOMAINS = [
  'hdslb.com',
  'bilivideo.com',
  'y.gtimg.cn',
  'qpic.cn',
  'sycdn.kuwo.cn',
  'kwcdn.kuwo.cn',
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

function needsCoverProxy(url: string): boolean {
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

// ---------- 本地封面 data URL 通道 ----------

// webview 对共享数据目录封面的 asset 协议渲染不稳定（2026-10 起播实测：
// URL 合法、asset 作用域已放行、控制台无报错却仍不渲染）。data: URL
// 不经 asset/CSP/file:// 任何协议层，是封面文件在本机唯一可靠的渲染形态。
// 所有 currentCover/currentCoverFull 的写入点统一经此转换，保证无论哪个
// 异步分支后到，写入的都是可渲染值，不会再把 data URL 覆盖回 asset URL。

const ASSET_HTTP_PREFIX = 'http://asset.localhost/';
const localCoverDataUrlCache = new Map<string, Promise<string>>();

// asset URL / 本地路径 → 磁盘路径；其余形态返回 null（交由既有链路）。
function localPathFromDisplayValue(value: string): string | null {
  if (!value) return null;
  if (/^[A-Za-z]:[\\/]/.test(value)) return value;
  if (value.startsWith(ASSET_HTTP_PREFIX)) {
    try {
      const path = decodeURIComponent(value.slice(ASSET_HTTP_PREFIX.length));
      return /^[A-Za-z]:[\\/]/.test(path) ? path : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 本地封面（磁盘路径或 asset URL）读为 data URL；读失败返回 null。
 * http(s)/data: 等非本地形态返回 null，调用方维持既有显示链路。
 * 结果按磁盘路径缓存（Promise 复用，同文件多写入点只读一次盘）。
 */
export async function resolveLocalCoverDataUrl(value: string): Promise<string | null> {
  const path = localPathFromDisplayValue(value);
  if (!path) return null;
  let pending = localCoverDataUrlCache.get(path);
  if (!pending) {
    pending = fileApi.readCoverDataUrl(path);
    localCoverDataUrlCache.set(path, pending);
    // 失败不占缓存：文件随后生成（如缩略图首次构建）时可重读
    void pending.then((r) => { if (!r) localCoverDataUrlCache.delete(path); });
  }
  return (await pending) || null;
}
