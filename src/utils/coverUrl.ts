import md5 from 'blueimp-md5';

export function encryptNeteasePicId(picId: string | number): string {
  const id = String(picId);
  const magic = '3go8&$8*3*3h0k(2)2';
  let xored = '';
  for (let i = 0; i < id.length; i++) {
    xored += String.fromCharCode(id.charCodeAt(i) ^ magic.charCodeAt(i % magic.length));
  }
  const hex = md5(xored);
  const bytes = (hex.match(/.{2}/g) || []).map((h) => parseInt(h, 16));
  return btoa(String.fromCharCode(...bytes)).replace(/\//g, '_').replace(/\+/g, '-');
}

export function isReliableNeteasePicId(picId: string | number | null | undefined): picId is string | number {
  if (picId === null || picId === undefined) return false;
  if (typeof picId === 'number') {
    return Number.isSafeInteger(picId) && picId !== 0;
  }
  const id = String(picId).trim();
  if (!id || id === '0') return false;
  return /^\d+$/.test(id);
}

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

export function extractNeteasePicId(item: any): string | number | null {
  if (!item || typeof item !== 'object') return null;
  const candidates = [
    item.al?.picId_str,
    item.al?.pic_str,
    item.al?.picId,
    item.album?.picId_str,
    item.album?.pic_str,
    item.album?.picId,
    item.picId_str,
    item.pic_str,
    item.picId,
    item.al?.pic,
    item.album?.pic,
    item.pic,
  ];
  for (const c of candidates) {
    if (isReliableNeteasePicId(c)) return c;
  }
  return null;
}

export function buildKuwoAlbumCoverUrl(
  webAlbumpicShort: string | null | undefined,
  size: number = 500,
): string {
  if (!webAlbumpicShort || typeof webAlbumpicShort !== 'string') return '';
  const short = webAlbumpicShort.trim().replace(/^\/+/, '');
  if (!short) return '';
  const sized = short.replace(/^\d+\//, `${size}/`);
  return `https://img3.kuwo.cn/star/albumcover/${sized}`;
}

export function normalizeKuwoCoverUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let out = url.trim();
  if (!out) return null;
  out = out.replace(/^http:\/\//i, 'https://');
  out = out.replace(
    /^https:\/\/[^/]+\.kuwo\.cn\/(.+)$/i,
    (_m, path: string) => `https://img3.kuwo.cn/${path}`,
  );
  return out;
}
