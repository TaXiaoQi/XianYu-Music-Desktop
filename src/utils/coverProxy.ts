/**
 * 在线封面代理
 *
 * 部分平台的封面 URL 无法在渲染进程直接 <img> 加载：
 * - http:// 协议：混合内容被 WebView2 阻止
 * - B站（hdslb.com / bilivideo.com）：需特殊 Referer / 服务端拉取（渲染进程 CORS 受限）
 *
 * 通过 Rust 后端 proxy_image 服务端拉取并转成 data: URL。
 * 提供带缓存的共享代理入口，供搜索列表、播放底栏、歌词页等复用，保证各入口行为一致。
 */
import { pluginApi } from '../services/tauri/pluginApi';

/** 需要走后端代理的封面域名 */
const PROXY_COVER_DOMAINS = [
  'hdslb.com',
  'bilivideo.com',
  'y.gtimg.cn',
  'qpic.cn',
  'sycdn.kuwo.cn',
  // 网易云 CDN 在 WebView2 内直连经常 403/加载失败（应用 Origin 不在其白名单），
  // 必须走后端 proxy_image（带 Referer: https://music.163.com/）才能稳定显示
  'music.126.net',
  '163.com',
];

/** 封面代理缓存（原始 URL → data: URL） */
const coverProxyCache = new Map<string, string>();
/** 已尝试代理且失败的 URL（避免对失败项重复请求） */
const coverProxyAttempted = new Set<string>();
/** 正在代理中的 URL（避免重复发起请求） */
const proxyPending = new Set<string>();

/** 判断封面 URL 是否需要走后端代理 */
export function needsCoverProxy(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('data:') || url.startsWith('asset:')) return false;
  if (url.startsWith('http://')) return true;
  return PROXY_COVER_DOMAINS.some(domain => url.includes(domain));
}

/**
 * 获取可直接用于 <img src> 的封面 URL。
 *
 * 缓存检查在最前面：无论是否需要代理，已缓存的 data: URL 优先返回。
 *
 * - 已有缓存：返回缓存的 data: URL。
 * - 无需代理且无缓存：原样返回，不触发回调。
 * - 需要代理且无缓存：返回 ''（不渲染 <img>，显示占位 SVG），
 *   同时异步发起代理，完成后调用 onReady(dataUrl) 刷新视图。
 *   代理成功后 getDisplayCoverUrl 命中缓存返回 data: URL，<img> 才渲染。
 *   代理失败后返回 '' 永久占位。
 *
 * 返回 '' 而非原始 URL 的原因：代理域名（music.126.net 等）直连必 403，
 * 返回原始 URL 会导致 <img> 渲染后加载失败、显示破碎图标且反复触发 @error。
 *
 * @param url 原始封面 URL
 * @param onReady 代理完成回调（仅在需要代理且异步成功时触发）
 * @returns 当前可用于 <img> 的 URL
 */
export function getDisplayCoverUrl(url: string, onReady?: (dataUrl: string) => void): string {
  if (!url) return '';

  // 缓存检查在最前面：无论是否需要代理，已缓存的 data: URL 优先返回
  const cached = coverProxyCache.get(url);
  if (cached) return cached;

  if (!needsCoverProxy(url)) return url;

  // 代理中或已失败：返回 '' 显示占位，不渲染 <img> 避免破碎图标
  if (proxyPending.has(url) || coverProxyAttempted.has(url)) return '';

  proxyPending.add(url);

  (async () => {
    try {
      const dataUrl = await pluginApi.proxyImage(url);
      coverProxyCache.set(url, dataUrl);
      onReady?.(dataUrl);
    } catch {
      coverProxyAttempted.add(url);
    } finally {
      proxyPending.delete(url);
    }
  })();

  return '';
}

/**
 * 尝试通过后端代理加载图片 URL（供 @error 兜底使用）。
 * 成功后返回 data: URL，失败返回 null。
 * 已在代理中或已失败的 URL 不会重复请求。
 */
export async function tryProxyImage(url: string): Promise<string | null> {
  if (!url || url.startsWith('data:') || url.startsWith('asset:')) return null;

  // 先查缓存
  const cached = coverProxyCache.get(url);
  if (cached) return cached;

  // 已在代理中或已失败，不重复请求
  if (proxyPending.has(url) || coverProxyAttempted.has(url)) return null;

  proxyPending.add(url);
  try {
    const dataUrl = await pluginApi.proxyImage(url);
    coverProxyCache.set(url, dataUrl);
    return dataUrl;
  } catch {
    coverProxyAttempted.add(url);
    return null;
  } finally {
    proxyPending.delete(url);
  }
}

/** 清除代理缓存和失败记录（用于切换搜索/重新搜索时重置状态） */
export function clearCoverProxyCache(): void {
  coverProxyCache.clear();
  coverProxyAttempted.clear();
  proxyPending.clear();
}