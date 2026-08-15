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

/** 需要走后端代理的 B站封面域名 */
const PROXY_COVER_DOMAINS = ['hdslb.com', 'bilivideo.com'];

/** 封面代理缓存（原始 URL → data: URL） */
const coverProxyCache = new Map<string, string>();
/** 已发起过代理请求的 URL（避免对失败项重复请求） */
const coverProxyAttempted = new Set<string>();

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
 * - 无需代理：原样返回，不触发回调。
 * - 需要代理且已有缓存：返回缓存的 data: URL。
 * - 需要代理且无缓存：先返回原始 URL（避免空封面闪烁），同时异步发起代理，
 *   完成后调用 onReady(dataUrl)。onReady 应负责把新值写入对应的响应式状态。
 *
 * @param url 原始封面 URL
 * @param onReady 代理完成回调（仅在需要代理且异步完成时触发）
 * @returns 当前可用于 <img> 的 URL
 */
export function getDisplayCoverUrl(url: string, onReady?: (dataUrl: string) => void): string {
  if (!url) return '';
  if (!needsCoverProxy(url)) return url;

  const cached = coverProxyCache.get(url);
  if (cached) return cached;

  if (onReady && !coverProxyAttempted.has(url)) {
    coverProxyAttempted.add(url);
    (async () => {
      try {
        const dataUrl = await pluginApi.proxyImage(url);
        coverProxyCache.set(url, dataUrl);
        onReady(dataUrl);
      } catch {
        // 代理失败：保持原始 URL，交由 <img> onerror 兜底
      }
    })();
  }

  return url;
}