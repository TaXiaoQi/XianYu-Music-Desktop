/**
 * 清洗插件返回的媒体 URL。
 *
 * 一些插件会返回被反引号/引号包裹、尾部带逗号或分号的 URL，例如：
 * `https://example.com/api?level=hires,`
 * 这里会提取第一个 http(s) URL，并清理首尾包装符号与查询参数值末尾的标点。
 */
export const sanitizeMediaUrl = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';

  const stripEdgeJunk = (value: string): string => {
    let current = value.trim();
    let previous = '';
    while (current && current !== previous) {
      previous = current;
      current = current
        .replace(/^[`´'"\u2018\u2019\u201c\u201d\uff02\uff07\s]+/g, '')
        .replace(/[,，;；`´'"\u2018\u2019\u201c\u201d\uff02\uff07\s]+$/g, '');
    }
    return current;
  };

  let candidate = raw.trim();
  const urlStart = candidate.search(/https?:\/\//i);
  if (urlStart >= 0) {
    candidate = candidate.slice(urlStart);
  }

  // URL 起始后遇到明显包装符/空白即截断，避免尾部反引号继续穿透。
  const terminator = candidate.search(/[`´'"\u2018\u2019\u201c\u201d\uff02\uff07<>\s]/);
  if (terminator > 0) {
    candidate = candidate.slice(0, terminator);
  }

  candidate = stripEdgeJunk(candidate);
  if (!candidate) return '';

  try {
    const url = new URL(candidate);
    let changed = false;
    const pathname = url.pathname.replace(/[,，;；`´'"\u2018\u2019\u201c\u201d\uff02\uff07\s]+$/g, '');
    if (pathname !== url.pathname) {
      url.pathname = pathname;
      changed = true;
    }
    for (const [key, value] of Array.from(url.searchParams.entries())) {
      const cleaned = stripEdgeJunk(value);
      if (cleaned !== value) {
        url.searchParams.set(key, cleaned);
        changed = true;
      }
    }
    return stripEdgeJunk(changed ? url.toString() : candidate);
  } catch {
    return candidate;
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
    }
  } catch {
    // URL 已经过 sanitizeMediaUrl 兜底；解析失败时只保留已有 headers 与 Accept。
  }

  return Object.keys(headers).length > 0 ? headers : null;
};
