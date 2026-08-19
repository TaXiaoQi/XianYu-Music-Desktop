/**
 * 清洗插件返回的媒体 URL。
 *
 * 一些插件会返回被反引号/引号包裹、尾部带逗号或分号的 URL，例如：
 * `https://example.com/api?level=hires,`
 *
 * 实现策略：用 indexOf 定位 http(s):// 起点，用 while+charCodeAt 逐字符
 * 剥离尾部非 URL 字符。不依赖正则字符类，避免编码/转义歧义。
 */

/** charCode 是否为需要剥离的尾部脏字符 */
const isTrailingDirtyChar = (code: number): boolean =>
  code === 0x2c        // , (半角逗号)
  || code === 0x3b     // ; (分号)
  || code === 0x60     // ` (反引号)
  || code === 0x27     // ' (单引号)
  || code === 0x22     // " (双引号)
  || code === 0x3e     // > (尖括号)
  || code === 0x3c     // <
  || code === 0x2018   // ‘ (左单引号)
  || code === 0x2019   // ’ (右单引号)
  || code === 0x201c   // “ (左双引号)
  || code === 0x201d   // ” (右双引号)
  || code === 0x201b   // ‛ (反向单引号)
  || code === 0x201f   // ‟ (反向双引号)
  || code === 0x2033   // ″ (双撇号)
  || code === 0x02b9   // ʹ (修饰字母素)
  || code === 0x02ca   // ʊ (修饰字母重力)
  || code === 0xff0c   // ，(全角逗号)
  || code === 0xff1b   // ；(全角分号)
  || code === 0xff02   // ＂(全角引号)
  || code === 0xff07   // ＇(全角单引号)
  || code === 0xff1e   // ＞(全角大于号)
  || code === 0xff1c   // ＜(全角小于号)
  || code <= 0x20;     // 所有空白控制字符

/** 从尾部逐字符剥离脏字符 */
const stripTrailingDirty = (s: string): string => {
  let end = s.length;
  while (end > 0 && isTrailingDirtyChar(s.charCodeAt(end - 1))) {
    end--;
  }
  return end > 0 ? s.substring(0, end) : '';
};

export const sanitizeMediaUrl = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw) return '';

  // 用 indexOf 定位 http:// 或 https:// 的起始位置（不依赖正则）
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

  // 从起点截取到末尾，再从尾部剥离脏字符
  let url = stripTrailingDirty(raw.substring(start));

  if (!url) return '';

  // 清理查询参数值末尾的标点
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

/**
 * 为插件直链补齐通用请求头。
 *
 * 插件有时只返回 URL，不返回防盗链 headers。酷狗等第三方代理接口在浏览器/客户端
 * UA 与 Referer 缺失时可能返回错误页或空响应，最终表现为“加载但不播放”。
 */
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

    // B站 CDN：bilivideo.com / bilivideo.cn / hdslb.com（封面图）
    // 防盗链要求 Referer + Origin，缺失时 CDN 只返回 3-4 秒预览片段
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
