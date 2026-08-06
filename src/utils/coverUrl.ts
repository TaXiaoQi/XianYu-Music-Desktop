/**
 * 在线音源封面 URL 构造。
 *
 * 部分平台搜索接口不直接返回可用封面：
 * - 网易云：只有 album.picId / picId_str，没有 picUrl
 * - 酷我：只有 web_albumpic_short 相对路径
 *
 * 在搜索结果映射阶段直接拼出 URL，避免逐条再打详情接口。
 */
import md5 from 'blueimp-md5';

/** 网易云 picId 加密路径段（与官方 CDN 路径一致） */
export function encryptNeteasePicId(picId: string | number): string {
  const id = String(picId);
  const magic = '3go8&$8*3*3h0k(2)2';
  let xored = '';
  for (let i = 0; i < id.length; i++) {
    xored += String.fromCharCode(id.charCodeAt(i) ^ magic.charCodeAt(i % magic.length));
  }
  // blueimp-md5 按 charCode&0xff 处理二进制串；官方 CDN 路径段是 URL-safe Base64(MD5)
  const hex = md5(xored);
  const bytes = (hex.match(/.{2}/g) || []).map((h) => parseInt(h, 16));
  return btoa(String.fromCharCode(...bytes)).replace(/\//g, '_').replace(/\+/g, '-');
}

/**
 * 网易云 picId 常超过 Number.MAX_SAFE_INTEGER。
 * JSON 解析成 number 时会丢精度，拼出的 CDN 路径错误；
 * 只有字符串或安全整数才可用来拼 URL。
 */
export function isReliableNeteasePicId(picId: string | number | null | undefined): picId is string | number {
  if (picId === null || picId === undefined) return false;
  if (typeof picId === 'number') {
    return Number.isSafeInteger(picId) && picId !== 0;
  }
  const id = String(picId).trim();
  if (!id || id === '0') return false;
  // 纯数字字符串可完整保留大整数
  return /^\d+$/.test(id);
}

/** 由 picId 生成网易云封面 CDN URL */
export function neteasePicIdToUrl(picId: string | number | null | undefined): string {
  if (!isReliableNeteasePicId(picId)) return '';
  const id = String(picId).trim();
  try {
    const enc = encryptNeteasePicId(id);
    return `https://p1.music.126.net/${enc}/${id}.jpg`;
  } catch {
    return '';
  }
}

/**
 * 从对象上尽力提取网易云 picId（搜索接口常见字段）。
 * 优先 *_str 字符串字段，避免 number 精度丢失。
 */
export function extractNeteasePicId(item: any): string | number | null {
  if (!item || typeof item !== 'object') return null;
  const candidates = [
    item.al?.picId_str,
    item.al?.pic_str,
    item.album?.picId_str,
    item.album?.pic_str,
    item.picId_str,
    item.pic_str,
    item.al?.picId,
    item.album?.picId,
    item.picId,
  ];
  for (const c of candidates) {
    if (isReliableNeteasePicId(c)) return c;
  }
  return null;
}

/**
 * 酷我搜索结果的 web_albumpic_short → 可用 HTTPS 封面。
 * 例：`120/s3s94/93/xxx.jpg` → `https://img3.kuwo.cn/star/albumcover/500/s3s94/93/xxx.jpg`
 *
 * 优先 img3/img4（img1.kwcdn 部分网络环境不可达）。
 */
export function buildKuwoAlbumCoverUrl(
  webAlbumpicShort: string | null | undefined,
  size: number = 500,
): string {
  if (!webAlbumpicShort || typeof webAlbumpicShort !== 'string') return '';
  const short = webAlbumpicShort.trim().replace(/^\/+/, '');
  if (!short) return '';
  // 把开头的尺寸段换成目标尺寸（120/xxx → 500/xxx）
  const sized = short.replace(/^\d+\//, `${size}/`);
  return `https://img3.kuwo.cn/star/albumcover/${sized}`;
}

/**
 * 把酷我旧 CDN 域名换成更稳定的 img3.kuwo.cn。
 * artistpicserver 仍可能返回 img1.kwcdn.kuwo.cn，前端/代理侧更容易失败。
 */
export function normalizeKuwoCoverUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let out = url.trim();
  if (!out) return null;
  out = out.replace(/^http:\/\//i, 'https://');
  out = out.replace(
    /^https:\/\/img\d+\.kwcdn\.kuwo\.cn\//i,
    'https://img3.kuwo.cn/',
  );
  return out;
}
