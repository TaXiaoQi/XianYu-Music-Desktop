import { getAuthBaseUrl } from '../../services/auth/authSession';
import { signedRequest } from '../../services/auth/authService';

/** 服务端 list_themes 单条记录（仅声明客户端用到的字段）。 */
export interface ThemeSquareItem {
  id: number;
  name: string;
  /** 完整 v2 主题包：payload 内联在列表条目里，下载/应用无需二次请求。 */
  theme: unknown;
  previewUrl: string;
  thumbnailUrl: string;
  uploaderNickname: string;
}

/**
 * 服务端资源相对路径（/uploads/...）补全为绝对地址。
 * 与 utils/update.ts 的 absoluteDownloadUrl 同一规则：base 可能以 /api 结尾，
 * 资源挂在站点根下。桌面 WebView 里相对路径会指向应用内部源，必须先补全。
 */
export function squareAbsoluteUrl(url: string): string {
  if (!url) return url;
  if (/^(https?:\/\/|data:image\/)/i.test(url)) return url;
  const base = getAuthBaseUrl();
  const parsed = /^([a-z]+:\/\/([^/]+))(\/.*)?$/i.exec(base);
  if (!parsed) return url;
  let root = parsed[3] || '';
  if (root.endsWith('/api')) root = root.slice(0, -'/api'.length);
  return `${parsed[1]}${root}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** 广场列表。data 是数组，signedRequest 的泛型透传可直接接住。 */
export async function listThemeSquare(): Promise<ThemeSquareItem[]> {
  const list = await signedRequest<ThemeSquareItem[]>('list_themes', {
    platform: 'desktop',
  });
  return Array.isArray(list) ? list : [];
}

/** 卡片展示图：优先服务端缩略图，缺省回落预览图。 */
export function squareItemPreview(item: ThemeSquareItem): string {
  return squareAbsoluteUrl(item.thumbnailUrl || item.previewUrl || '');
}

/**
 * 把服务端条目里的资源 URL 补全后返回主题包原文（结构不变），
 * 交给 applyDesktopThemePackage 走既有校验/应用链路。
 */
export function squareItemPackage(item: ThemeSquareItem): unknown {
  const pkg = (item.theme ?? {}) as Record<string, unknown>;
  const rewrite = (input: unknown): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
    for (const [slot, value] of Object.entries(input as Record<string, unknown>)) {
      out[slot] = typeof value === 'string' ? squareAbsoluteUrl(value) : value;
    }
    return out;
  };
  const payload = (pkg.payload ?? {}) as Record<string, unknown>;
  return {
    ...pkg,
    preview: squareAbsoluteUrl(typeof pkg.preview === 'string' ? pkg.preview : ''),
    payload: {
      ...payload,
      icons: rewrite(payload.icons),
      stickers: rewrite(payload.stickers),
    },
  };
}
