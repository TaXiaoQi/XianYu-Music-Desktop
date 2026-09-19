export type ArtistTabId = 'songs' | 'albums' | 'details';

export interface ArtistTabItem {
  id: ArtistTabId;
  name: string;
}

export const ARTIST_TABS_STORAGE_KEY = 'xianyu_artist_tabs_order';

export const DEFAULT_ARTIST_TABS: ArtistTabId[] = ['songs', 'albums', 'details'];

const TABS_NAME_MAP: Record<ArtistTabId, string> = {
  songs: '歌曲',
  albums: '专辑',
  details: '歌手详情',
};

export function isArtistTabId(value: unknown): value is ArtistTabId {
  return value === 'songs' || value === 'albums' || value === 'details';
}

export function sanitizeTabsOrder(rawOrder: unknown): ArtistTabId[] {
  if (!Array.isArray(rawOrder)) {
    return [...DEFAULT_ARTIST_TABS];
  }
  const validSavedIds = rawOrder.filter(isArtistTabId);
  const dedupedSavedIds = Array.from(new Set(validSavedIds));
  const missingIds = DEFAULT_ARTIST_TABS.filter(id => !dedupedSavedIds.includes(id));
  return [...dedupedSavedIds, ...missingIds];
}

export function getSavedTabsOrder(): ArtistTabId[] {
  try {
    const raw = localStorage.getItem(ARTIST_TABS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_ARTIST_TABS];
    return sanitizeTabsOrder(JSON.parse(raw));
  } catch {
    return [...DEFAULT_ARTIST_TABS];
  }
}

export function getDefaultArtistTab(): ArtistTabId {
  const order = getSavedTabsOrder();
  return order[0] || 'songs';
}

export function getOrderedArtistTabs(): ArtistTabItem[] {
  const order = getSavedTabsOrder();
  return order.map(id => ({
    id,
    name: TABS_NAME_MAP[id] || '',
  }));
}

export function saveTabsOrder(order: ArtistTabId[]): void {
  try {
    localStorage.setItem(
      ARTIST_TABS_STORAGE_KEY,
      JSON.stringify(sanitizeTabsOrder(order)),
    );
  } catch {
    // 静默失败，避免本地写入故障中断主进程或阻塞 UI 响应
  }
}
