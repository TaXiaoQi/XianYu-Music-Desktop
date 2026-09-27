import { pinyin } from 'pinyin-pro';

// 字母索引分组的固定次序：数字组在最前，“#” 兜底组在最后。
export const ALPHABET_INDEX_KEYS = [
  '0', 'A', 'B', 'C', 'D', 'E',
  'F', 'G', 'H', 'I', 'J', 'K',
  'L', 'M', 'N', 'O', 'P', 'Q',
  'R', 'S', 'T', 'U', 'V', 'W',
  'X', 'Y', 'Z', '#',
] as const;

export type AlphabetIndexKey = (typeof ALPHABET_INDEX_KEYS)[number];

/** 可变副本：供下拉选择等场景直接遍历 */
export const INDEX_KEYS: AlphabetIndexKey[] = Array.from(ALPHABET_INDEX_KEYS);

/** 索引键 → 排序序号的查找表 */
export const INDEX_ORDER: Map<AlphabetIndexKey, number> = (() => {
  const orderMap = new Map<AlphabetIndexKey, number>();
  ALPHABET_INDEX_KEYS.forEach((key, order) => orderMap.set(key, order));
  return orderMap;
})();

// “#” 兜底分组的键值
const FALLBACK_GROUP: AlphabetIndexKey = '#';

// 未收录索引键的兜底序号（排在最后）
const FALLBACK_INDEX_RANK = 999;

// localeCompare 统一使用英文区域 + 数值感知 + 忽略大小写差异
const LOCALE_COMPARE_OPTIONS: Intl.CollatorOptions = { numeric: true, sensitivity: 'base' };

// 成对出现的包裹符号：整体剥除用（正则与符号均为行为规格，保持原样）
const PAIRED_WRAP_SYMBOLS: ReadonlyArray<readonly [string, string]> = [
  ['《', '》'], ['【', '】'], ['[', ']'],
  ['(', ')'], ['（', '）'],
  ['「', '」'], ['『', '』'],
];

const LEADING_WRAP_PATTERN = /^[《》【】[\]()（）「」『』]/;

// —— 归一化辅助 ——

// 全角字符折叠为半角、全角空格转为普通空格
function toHalfWidth(text: string): string {
  const noIdeographicSpace = text.replace(/\u3000/g, ' ');
  return noIdeographicSpace.replace(/[\uFF01-\uFF5E]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xFEE0));
}

/** 索引归一化：全角转半角，并剥掉标题开头的包裹符号 */
export function normalizeTitleForIndex(title: string | null | undefined): string {
  let clean = toHalfWidth(String(title ?? '').trim());
  while (LEADING_WRAP_PATTERN.test(clean)) {
    clean = clean.slice(1).trim();
  }
  return clean;
}

/** 排序归一化：在索引归一化基础上整体剥除成对包裹符号，再清理残余符号与空白 */
export function normalizeTitleForSort(title: string | null | undefined): string {
  let clean = normalizeTitleForIndex(title);
  // 成对包裹符号整体剥除，直到无法继续
  for (let progress = true; progress; ) {
    progress = false;
    if (clean.length < 2) continue;
    for (const [open, close] of PAIRED_WRAP_SYMBOLS) {
      if (clean.startsWith(open) && clean.endsWith(close)) {
        clean = clean.slice(1, -1).trim();
        progress = true;
        break;
      }
    }
  }
  const withoutSymbols = clean.replace(/[《》【】[\]()（）「」『』]/g, ' ');
  return withoutSymbols.replace(/\s+/g, ' ').trim().toLowerCase();
}

// —— 索引与排序键 ——

/** 推导标题所属的字母索引分组 */
export function getAlphabetIndexKey(title: string | null | undefined): AlphabetIndexKey {
  const clean = normalizeTitleForIndex(title);
  if (clean.length === 0) return FALLBACK_GROUP;

  const [firstChar] = Array.from(clean);
  if (firstChar === undefined) return FALLBACK_GROUP;

  // 数字开头归入 “0” 组，英文字母直接大写归组
  if (/^\d$/.test(firstChar)) {
    return '0';
  }
  if (/^[A-Za-z]$/.test(firstChar)) {
    const upper = firstChar.toUpperCase();
    return upper as AlphabetIndexKey;
  }

  // 其余字符（中文等）尝试取拼音首字母
  try {
    const initial = pinyin(firstChar, { pattern: 'first', toneType: 'none', type: 'string' }).trim();
    const letter = initial[0]?.toUpperCase();
    if (letter && /^[A-Z]$/.test(letter)) {
      return letter as AlphabetIndexKey;
    }
  } catch {
    // 拼音转换失败时归入 “#” 组
  }
  return FALLBACK_GROUP;
}

/** 生成用于字典序比较的拼音排序键 */
export function getAlphabetSortKey(title: string | null | undefined): string {
  const normalizedTitle = normalizeTitleForSort(title);
  try {
    const converted = pinyin(normalizedTitle, { toneType: 'none', nonZh: 'consecutive', type: 'string' });
    return converted.toLowerCase().trim();
  } catch {
    return normalizedTitle.toLowerCase().trim();
  }
}

// —— 比较与排序 ——

const indexRankOf = (key: AlphabetIndexKey) => INDEX_ORDER.get(key) ?? FALLBACK_INDEX_RANK;

const indexOrderOfTitle = (title: string) => {
  const rank = INDEX_ORDER.get(getAlphabetIndexKey(title));
  return rank === undefined ? 0 : rank;
};

/** 先按索引分组序号比较，同组内再按拼音排序键比较 */
export function compareByAlphabetIndex(left: string, right: string): number {
  const orderDiff = indexOrderOfTitle(left) - indexOrderOfTitle(right);
  if (orderDiff !== 0) return orderDiff;
  return getAlphabetSortKey(left).localeCompare(getAlphabetSortKey(right), 'en', LOCALE_COMPARE_OPTIONS);
}

/** 对任意条目按标题字母序排序；索引键与排序键均只预计算一次 */
export function sortItemsByAlphabetIndex<T>(items: T[], getTitle: (item: T) => string): T[] {
  if (!items?.length) return [];

  const decorated = items.map((item, position) => {
    const titleText = getTitle(item) || '';
    return { item, position, indexKey: getAlphabetIndexKey(titleText), sortKey: getAlphabetSortKey(titleText) };
  });

  decorated.sort((a, b) => {
    if (a.indexKey !== b.indexKey) {
      return indexRankOf(a.indexKey) - indexRankOf(b.indexKey);
    }
    const bySortKey = a.sortKey.localeCompare(b.sortKey, 'en', LOCALE_COMPARE_OPTIONS);
    return bySortKey !== 0 ? bySortKey : a.position - b.position;
  });

  return decorated.map((entry) => entry.item);
}
