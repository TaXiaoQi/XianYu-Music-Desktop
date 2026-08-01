/**
 * 音乐元数据格式化通用工具
 */

import he from 'he';

/** HTML 实体解码 */
export function decodeName(str: string | null | undefined): string {
  if (!str) return '';
  try { return he.decode(str); } catch { return str; }
}

/** 格式化歌手名（兼容数组和字符串输入） */
export function formatSingerName(
  singers: any[] | string | null | undefined,
  nameKey = 'name',
  join = '、',
): string {
  if (Array.isArray(singers)) {
    const names: string[] = [];
    for (const item of singers) {
      if (item && typeof item === 'object') {
        const name = item[nameKey];
        if (name && typeof name === 'string' && name.trim()) {
          names.push(decodeName(name));
        }
      }
    }
    return names.join(join);
  }
  return decodeName(String(singers ?? ''));
}
