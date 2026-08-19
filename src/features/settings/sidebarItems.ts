import type { SidebarItemKey, SidebarSettings } from '../../types';

/**
 * 侧边栏项目元数据（单一数据源）
 *
 * 侧边栏渲染与「设置 → 侧边栏管理」共用这份定义，避免图标/文案在两处重复维护。
 * 注意：「首页」固定置顶、不可隐藏、不参与排序，因此不在此列表中。
 */
export interface SidebarItemMeta {
  key: SidebarItemKey;
  /** 显示名称 */
  label: string;
  /** 对应 SidebarSettings 中控制可见性的字段 */
  visibilityKey: keyof SidebarSettings;
  /** 图标渲染方式：普通 path，或专辑的双同心圆 */
  iconKind: 'path' | 'albums';
  /** iconKind 为 'path' 时的 svg path d 属性 */
  iconPath?: string;
  /** 设置页中是否禁止隐藏（核心功能） */
  lockedVisible?: boolean;
  /** 设置页中的补充说明 */
  description?: string;
}

export const SIDEBAR_ITEMS: SidebarItemMeta[] = [
  {
    key: 'topLists',
    label: '榜单',
    visibilityKey: 'showTopLists',
    iconKind: 'path',
    iconPath: 'M3 17l5-5 4 4 6-8 3 3V5h-6l2 2-4 5-4-4-6 6z',
  },
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

/** 默认排列顺序（与历史上硬编码的顺序保持一致，榜单默认排在首页下） */
export const DEFAULT_SIDEBAR_ORDER: SidebarItemKey[] = [
  'topLists',
  ...SIDEBAR_ITEMS.filter(item => item.key !== 'topLists').map(item => item.key),
];

const SIDEBAR_ITEM_KEY_SET = new Set<SidebarItemKey>(DEFAULT_SIDEBAR_ORDER);

/** 按 key 查询元数据 */
export const getSidebarItemMeta = (key: SidebarItemKey): SidebarItemMeta | undefined =>
  SIDEBAR_ITEMS.find(item => item.key === key);

/**
 * 归一化侧边栏顺序，保证向后兼容与健壮性：
 * - 剔除非法/已废弃的 key
 * - 去重
 * - 补齐缺失项（按默认顺序追加到末尾），因此新增侧边栏项不会丢失
 * - 输入无效时回落到默认顺序
 */
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

  // 榜单是新功能：老用户的已存顺序里没有它，默认插到首页下方（而不是追加到末尾）
  if (!seen.has('topLists')) {
    result.unshift('topLists');
    seen.add('topLists');
  }

  for (const key of DEFAULT_SIDEBAR_ORDER) {
    if (!seen.has(key)) {
      result.push(key);
    }
  }

  return result;
};
