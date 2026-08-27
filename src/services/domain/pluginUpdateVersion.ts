/**
 * 版本号比较：返回 >0 表示 a 更新，<0 表示 b 更新，0 表示相同。
 *
 * 兼容语义化版本（"1.0.5"、"2.0.0-beta.1"），也兼容落雪/时迁酱等插件常用的
 * 字母前缀/后缀版本（"v7"、"v10"、"1.2.0-fix7"）。解析时：
 *   - 去掉首字母 "v"/"V" 前缀；
 *   - 在数字与字母交界处插入分隔符（"fix7" → "fix.7"）；
 *   - 按 . - _ + 拆分，纯数字段按数值比较，字符串段按字典序比较；
 *   - 数字段 > 字符串段（"1.1.0" 大于 "1.1.0-beta"），缺失尾部按数值 0 处理。
 *
 * 旧实现把每个非数字段一律 parseInt 成 0，导致 "v7" → "v8"、"v9" → "v10" 这类
 * 版本方案比较时两边全等于 0，永远判定为"已是最新版本"，插件无法更新。
 */
function parseVersionParts(v: string): Array<number | string> {
  const s = String(v)
    .trim()
    .replace(/^[vV]\s*/, '')
    .replace(/(\d)([a-zA-Z])/g, '$1.$2')
    .replace(/([a-zA-Z])(\d)/g, '$1.$2');
  const parts = s.split(/[.\-_+]+/).filter(p => p.length > 0);
  return parts.map(p => (/^\d+$/.test(p) ? parseInt(p, 10) : p.toLowerCase()));
}

function compareVersionToken(a: number | string, b: number | string): number {
  const aNum = typeof a === 'number';
  const bNum = typeof b === 'number';
  if (aNum && bNum) return a - b;
  if (aNum) return 1; // 数字段 > 字符串段
  if (bNum) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareVersions(a: string, b: string): number {
  const va = parseVersionParts(a);
  const vb = parseVersionParts(b);
  const maxLen = Math.max(va.length, vb.length);
  for (let i = 0; i < maxLen; i++) {
    const ta = i < va.length ? va[i] : 0;
    const tb = i < vb.length ? vb[i] : 0;
    const diff = compareVersionToken(ta, tb);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * 从 MusicFree/Baka 脚本中提取版本号（不执行脚本）。
 *
 * [修复] 旧正则 /version\s*[=:]\s*['"]([^'"]+)['"]/ 会匹配脚本中任意出现的
 * "version = '...'" 字符串，包括注释、变量声明、API URL 参数等，导致提取到
 * 错误的版本号。Baka 插件尤其容易在 return 对象之前出现其他 version 字符串。
 *
 * 新策略：
 * 1. 优先匹配对象属性形式的 version（前面是 { 或 ,），取最后一个匹配
 *    （return 对象通常在脚本末尾）
 * 2. 回退到旧正则（向后兼容）
 */
export function extractMusicFreeVersion(script: string): string | null {
  // 策略 1：匹配对象属性 { version: '1.0.0' } 或 , version: '1.0.0'
  // 使用 matchAll 找所有匹配，取最后一个（最可能是 return 对象的 version）
  const propMatches = [...script.matchAll(/[{,]\s*version\s*:\s*['"]([^'"]+)['"]/g)];
  if (propMatches.length > 0) {
    return propMatches[propMatches.length - 1][1];
  }

  // 策略 2（回退）：旧正则，匹配任意 version = '...' 或 version: '...'
  const match = script.match(/version\s*[=:]\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

/**
 * 从 MusicFree/Baka 脚本中提取 srcUrl（不执行脚本）。
 *
 * [修复] 同 extractMusicFreeVersion，使用对象属性匹配避免误匹配。
 */
export function extractMusicFreeSrcUrl(script: string): string | null {
  // 策略 1：匹配对象属性 { srcUrl: '...' } 或 , srcUrl: '...'
  const propMatches = [...script.matchAll(/[{,]\s*srcUrl\s*:\s*['"]([^'"]+)['"]/g)];
  if (propMatches.length > 0) {
    return propMatches[propMatches.length - 1][1];
  }

  // 策略 2（回退）：旧正则
  const match = script.match(/srcUrl\s*[=:]\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}