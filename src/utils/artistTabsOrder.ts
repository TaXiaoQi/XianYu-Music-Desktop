// 歌手详情页标签页（歌曲 / 专辑 / 歌手详情）的顺序定义、清洗与持久化。
export type ArtistTabId =
  | 'songs'
  | 'albums'
  | 'details';

/** 标签条目：id + 显示名 */
export type ArtistTabItem = { id: ArtistTabId; name: string };

/** 标签顺序在 localStorage 中的存储键 */
export const ARTIST_TABS_STORAGE_KEY = 'xianyu_artist_tabs_order';

/** 默认顺序：歌曲 → 专辑 → 歌手详情 */
export const DEFAULT_ARTIST_TABS: ArtistTabId[] = [
  'songs', 'albums', 'details',
];

// 标签显示名（UI 文案，保持不变）
const TAB_LABELS: Record<ArtistTabId, string> = {
  songs: '歌曲', albums: '专辑', details: '歌手详情',
};

// 默认顺序的全新副本
const defaultTabs = (): ArtistTabId[] => Array.from(DEFAULT_ARTIST_TABS);

export function isArtistTabId(candidate: unknown): candidate is ArtistTabId {
  return DEFAULT_ARTIST_TABS.includes(candidate as ArtistTabId);
}

/** 清洗持久化顺序：剔除非法项与重复项，缺失的标签按默认次序补到末尾 */
export function sanitizeTabsOrder(rawSavedOrder: unknown): ArtistTabId[] {
  if (!Array.isArray(rawSavedOrder)) {
    return defaultTabs();
  }
  const deduped = Array.from(new Set(rawSavedOrder.filter(isArtistTabId)));
  const missing = DEFAULT_ARTIST_TABS.filter(id => !deduped.includes(id));
  return deduped.concat(missing);
}

/** 读取本地保存的顺序；为空或解析失败时回退默认顺序 */
export function getSavedTabsOrder(): ArtistTabId[] {
  try {
    const storedValue = localStorage.getItem(ARTIST_TABS_STORAGE_KEY);
    if (!storedValue) {
      return defaultTabs();
    }
    return sanitizeTabsOrder(JSON.parse(storedValue));
  } catch {
    return defaultTabs();
  }
}

/** 当前顺序下的首个标签（即默认展示的标签） */
export function getDefaultArtistTab(): ArtistTabId {
  const [firstTab] = getSavedTabsOrder();
  return firstTab ?? 'songs';
}

/** 生成带显示名的有序标签列表 */
export function getOrderedArtistTabs(): ArtistTabItem[] {
  return getSavedTabsOrder().map(id => ({
    id,
    name: TAB_LABELS[id],
  }));
}

/** 把顺序清洗后写回 localStorage；写入失败时静默处理 */
export function saveTabsOrder(nextOrder: ArtistTabId[]): void {
  try {
    const sanitized = sanitizeTabsOrder(nextOrder);
    localStorage.setItem(ARTIST_TABS_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // 静默失败，避免本地写入故障中断主进程或阻塞 UI 响应
  }
}
