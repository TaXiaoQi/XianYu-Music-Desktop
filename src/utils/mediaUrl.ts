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
