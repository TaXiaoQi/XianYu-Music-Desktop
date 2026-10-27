import type { SidebarItemKey, SidebarSettings } from '../../types';

export interface SidebarItemMeta {
  key: SidebarItemKey;
  label: string;
  visibilityKey: keyof SidebarSettings;
  iconKind: 'path' | 'albums';
  iconPath?: string;
  lockedVisible?: boolean;
  description?: string;
}

export const SIDEBAR_ITEMS: SidebarItemMeta[] = [
  {
    key: 'localMusic',
    label: '本地音乐',
    visibilityKey: 'showLocalMusic',
    iconKind: 'path',
    iconPath: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3',
    lockedVisible: true,
    description: '核心功能 (不可隐藏)',
  },
  {
    key: 'cloud',
    label: '网盘音乐',
    visibilityKey: 'showCloud',
    iconKind: 'path',
    iconPath: 'M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z',
  },
  {
    key: 'artists',
    label: '歌手',
    visibilityKey: 'showArtists',
    iconKind: 'path',
    iconPath: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  },
  {
    key: 'albums',
    label: '专辑',
    visibilityKey: 'showAlbums',
    iconKind: 'albums',
  },
  {
    key: 'favorites',
    label: '我的收藏',
    visibilityKey: 'showFavorites',
    iconKind: 'path',
    iconPath: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
  },
  {
    key: 'recent',
    label: '最近播放',
    visibilityKey: 'showRecent',
    iconKind: 'path',
    iconPath: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    key: 'folders',
    label: '文件夹',
    visibilityKey: 'showFolders',
    iconKind: 'path',
    iconPath: 'M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  },
  {
    key: 'plugins',
    label: '插件管理',
    visibilityKey: 'showPlugins',
    iconKind: 'path',
    iconPath: 'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z',
  },
  {
    key: 'account',
    label: '个人中心',
    visibilityKey: 'showAccount',
    iconKind: 'path',
    iconPath: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  },
];

export const DEFAULT_SIDEBAR_ORDER: SidebarItemKey[] = [
  'artists',
  'albums',
  'folders',
  'plugins',
  'account',
  'localMusic',
  'cloud',
  'recent',
  'favorites',
];

const SIDEBAR_ITEM_KEY_SET = new Set<SidebarItemKey>(DEFAULT_SIDEBAR_ORDER);
const DEFAULT_KEY_RANK = new Map<SidebarItemKey, number>(
  DEFAULT_SIDEBAR_ORDER.map((key, index) => [key, index]),
);

export const normalizeSidebarOrder = (value: unknown): SidebarItemKey[] => {
  if (!Array.isArray(value)) {
    return [...DEFAULT_SIDEBAR_ORDER];
  }

  const seen = new Set<SidebarItemKey>();
  const result: SidebarItemKey[] = [];

  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const key = raw as SidebarItemKey;
    if (!SIDEBAR_ITEM_KEY_SET.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }

  // 缺失项（新版本新增的侧栏项）按默认顺序插到「默认顺序里最近的前驱」之后，
  // 而非整体追加到末尾——保证新项落在设计的默认位置（如网盘音乐在本地音乐下方）
  for (const key of DEFAULT_SIDEBAR_ORDER) {
    if (seen.has(key)) continue;
    seen.add(key);
    const rank = DEFAULT_KEY_RANK.get(key) ?? 0;
    let insertAt = 0;
    for (let i = result.length - 1; i >= 0; i--) {
      if ((DEFAULT_KEY_RANK.get(result[i]) ?? 0) < rank) {
        insertAt = i + 1;
        break;
      }
    }
    result.splice(insertAt, 0, key);
  }

  return result;
};
