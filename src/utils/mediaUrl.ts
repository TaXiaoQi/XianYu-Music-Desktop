
const isTrailingDirtyChar = (code: number): boolean =>
  code === 0x2c
  || code === 0x3b
  || code === 0x60
  || code === 0x27
  || code === 0x22
  || code === 0x3e
  || code === 0x3c
  || code === 0x2018
  || code === 0x2019
  || code === 0x201c
  || code === 0x201d
  || code === 0x201b
  || code === 0x201f
  || code === 0x2033
  || code === 0x02b9
  || code === 0x02ca
  || code === 0xff0c
  || code === 0xff1b
  || code === 0xff02
  || code === 0xff07
  || code === 0xff1e
  || code === 0xff1c
  || code <= 0x20;

const stripTrailingDirty = (s: string): string => {
  let end = s.length;
  while (end > 0 && isTrailingDirtyChar(s.charCodeAt(end - 1))) {
    end--;
  }
  return end > 0 ? s.substring(0, end) : '';
};

export const sanitizeMediaUrl = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw) return '';

  const httpsIdx = raw.indexOf('https://');
  const httpIdx = raw.indexOf('http://');
  let start: number;
  if (httpsIdx >= 0 && (httpIdx < 0 || httpsIdx <= httpIdx)) {
    start = httpsIdx;
  } else if (httpIdx >= 0) {
    start = httpIdx;
  } else {
    return '';
  }

  let url = stripTrailingDirty(raw.substring(start));

  if (!url) return '';

  try {
    const parsed = new URL(url);
    let changed = false;
    for (const [key, value] of Array.from(parsed.searchParams.entries())) {
      const cleaned = stripTrailingDirty(value);
      if (cleaned !== value) {
        parsed.searchParams.set(key, cleaned);
        changed = true;
      }
    }
    return changed ? parsed.toString() : url;
  } catch {
    return url;
  }
};

const hasHeader = (headers: Record<string, string>, name: string): boolean => {
  const lowerName = name.toLowerCase();
  return Object.keys(headers).some(key => key.toLowerCase() === lowerName);
};

const setHeaderIfMissing = (
  headers: Record<string, string>,
  name: string,
  value: string,
): void => {
  if (!hasHeader(headers, name)) {
    headers[name] = value;
  }
};

export const normalizeMediaRequestHeaders = (
  url: unknown,
  rawHeaders?: Record<string, string> | null,
): Record<string, string> | null => {
  const cleanedUrl = sanitizeMediaUrl(url);
  if (!cleanedUrl || !/^https?:\/\//i.test(cleanedUrl)) return rawHeaders ?? null;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawHeaders ?? {})) {
    if (key.trim() && String(value).trim()) {
      headers[key] = String(value);
    }
  }

  setHeaderIfMissing(headers, 'Accept', 'audio/*,*/*;q=0.8');

  try {
    const parsed = new URL(cleanedUrl);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const isKugouLike = host.includes('kugou')
      || host.includes('kg.')
      || host.includes('haitangw.cc')
      || path.includes('/kgqq/')
      || path.includes('/kugou/');
    const isNeteaseLike = host.includes('music.126.net')
      || host.includes('music.163.com')
      || host.includes('netease')
      || path.includes('/netease/')
      || path.includes('/wy/');
    const isKuwoLike = host.includes('kuwo.cn')
      || host.includes('kuwo.com')
      || host.includes('kuwo')
      || path.includes('/kuwo/')
      || path.includes('/kw/');
    const isJooxLike = host.includes('joox.com')
      || host.includes('music.joox.com')
      || path.includes('/joox/');
    const isQishuiLike = host.includes('douyin.com')
      || host.includes('pglstatp-toutiao.com')
      || host.includes('pangolin-sdk-toutiao.com')
      || host.includes('bytescm.com')
      || host.includes('pstatp.com')
      || host.includes('bytecdn.cn')
      || host.includes('toutiao.com')
      || path.includes('/qishui/');

    const isBilibiliLike = host.includes('bilivideo.com')
      || host.includes('bilivideo.cn')
      || host.includes('hdslb.com')
      || host.includes('bilibili.com');

    if (isKugouLike) {
      const referer = host.includes('haitangw.cc')
        ? `${parsed.protocol}//${parsed.host}/`
        : 'https://www.kugou.com/';
      setHeaderIfMissing(headers, 'Referer', referer);
      setHeaderIfMissing(headers, 'Origin', referer.replace(/\/$/, ''));
    } else if (isNeteaseLike) {
      const referer = 'https://music.163.com/';
      setHeaderIfMissing(headers, 'Referer', referer);
      setHeaderIfMissing(headers, 'Origin', referer.replace(/\/$/, ''));
    } else if (isKuwoLike) {
      const referer = 'http://www.kuwo.cn/';
      setHeaderIfMissing(headers, 'Referer', referer);
      setHeaderIfMissing(headers, 'Origin', referer.replace(/\/$/, ''));
    } else if (isJooxLike) {
      const referer = 'https://www.joox.com/';
      setHeaderIfMissing(headers, 'Referer', referer);
      setHeaderIfMissing(headers, 'Origin', referer.replace(/\/$/, ''));
    } else if (isBilibiliLike) {
      setHeaderIfMissing(headers, 'Referer', 'https://www.bilibili.com');
      setHeaderIfMissing(headers, 'Origin', 'https://www.bilibili.com');
    } else if (isQishuiLike) {
      const referer = 'https://www.douyin.com/';
      setHeaderIfMissing(headers, 'Referer', referer);
      setHeaderIfMissing(headers, 'Origin', referer.replace(/\/$/, ''));
    }
  } catch {
    // URL 已经过 sanitizeMediaUrl 兜底；解析失败时只保留已有 headers 与 Accept。
  }

  return Object.keys(headers).length > 0 ? headers : null;
};
