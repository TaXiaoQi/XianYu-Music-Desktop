import type {
  TopBarContainerKey,
  TopBarItemKey,
  TopBarLayoutSettings,
} from '../../types';

export const TOPBAR_MAX_VISIBLE_CONTROLS = 5;

export const TOPBAR_CONTAINERS: TopBarContainerKey[] = ['left', 'right'];

export const TOPBAR_FIXED_ITEMS: TopBarItemKey[] = ['search', 'settings'];

export const DEFAULT_TOPBAR_LAYOUT: TopBarLayoutSettings = {
  left: ['back'],
  right: ['theme', 'colorScheme', 'settings', 'account'],
  hidden: ['announcement'],
};

export const TOPBAR_CONTAINER_LABELS: Record<TopBarContainerKey, { label: string; hint: string }> = {
  left: { label: '左侧容器', hint: '紧邻窗口左边缘' },
  right: { label: '右侧容器', hint: '紧邻设置与窗口控制' },
};

export type TopBarMoveTarget = TopBarContainerKey | 'collapsed';

export interface TopBarItemMeta {
  key: TopBarItemKey;
  label: string;
  description: string;
  fixed: boolean;
  icon: 'back' | 'search' | 'mic' | 'moon' | 'bell' | 'settings' | 'user' | 'palette';
}

export const TOPBAR_ITEMS: TopBarItemMeta[] = [
  { key: 'back',           label: '后退',     description: '返回上一个页面', icon: 'back',      fixed: false },
  { key: 'search',         label: '搜索框',   description: '全局搜索（始终居中）', icon: 'search', fixed: true },
  { key: 'theme',          label: '主题切换', description: '浅色 / 深色切换', icon: 'moon',      fixed: false },
  { key: 'announcement',   label: '公告',     description: '查看最新公告', icon: 'bell',      fixed: false },
  { key: 'settings',       label: '设置',     description: '打开设置页面（不可关闭）', icon: 'settings', fixed: true },
  { key: 'account',        label: '账号',     description: '登录 / 个人中心', icon: 'user',      fixed: false },
  { key: 'colorScheme',    label: '配色方案', description: '外观配色方案快速入口', icon: 'palette', fixed: false },
];

export const TOPBAR_CONTROL_KEYS: TopBarItemKey[] = TOPBAR_ITEMS
  .filter(item => item.key !== 'search')
  .map(item => item.key);

export const TOPBAR_DISPLAY_KEYS: TopBarItemKey[] = TOPBAR_ITEMS.map(item => item.key);

export const getTopBarItemMeta = (key: TopBarItemKey): TopBarItemMeta | undefined =>
  TOPBAR_ITEMS.find(item => item.key === key);

const CONTROL_KEY_SET = new Set<TopBarItemKey>(TOPBAR_CONTROL_KEYS);

const FIXED_KEY_SET = new Set<TopBarItemKey>(TOPBAR_FIXED_ITEMS);

const HIDEABLE_KEY_SET = new Set<TopBarItemKey>(
  TOPBAR_CONTROL_KEYS.filter(key => key !== 'settings'),
);

export const normalizeTopBarLayout = (value: unknown): TopBarLayoutSettings => {
  const base = typeof value === 'object' && value !== null ? value as Partial<TopBarLayoutSettings> : {};
  const seen = new Set<TopBarItemKey>();
  const hiddenSet = new Set<TopBarItemKey>();

  if (Array.isArray(base.hidden)) {
    for (const item of base.hidden) {
      if (typeof item !== 'string') continue;
      const key = item as TopBarItemKey;
      if (!HIDEABLE_KEY_SET.has(key) || hiddenSet.has(key)) continue;
      hiddenSet.add(key);
    }
  }

  const cleanList = (raw: unknown): TopBarItemKey[] => {
    if (!Array.isArray(raw)) return [];
    const result: TopBarItemKey[] = [];
    for (const item of raw) {
      if (typeof item !== 'string') continue;
      const key = item as TopBarItemKey;
      if (!CONTROL_KEY_SET.has(key) || seen.has(key) || hiddenSet.has(key)) continue;
      seen.add(key);
      result.push(key);
    }
    return result;
  };

  let left = cleanList(base.left);
  let right = cleanList(base.right);

  if (!seen.has('settings') && !hiddenSet.has('settings')) {
    seen.add('settings');
    right.push('settings');
  }

  for (const key of TOPBAR_CONTROL_KEYS) {
    if (seen.has(key) || hiddenSet.has(key)) continue;
    const total = left.length + right.length;
    if (total >= TOPBAR_MAX_VISIBLE_CONTROLS) {
      hiddenSet.add(key);
      continue;
    }
    if (DEFAULT_TOPBAR_LAYOUT.left.includes(key)) {
      left.push(key);
    } else {
      right.push(key);
    }
    seen.add(key);
  }

  const overflow = () => {
    const total = left.length + right.length;
    while (total > TOPBAR_MAX_VISIBLE_CONTROLS) {
      const removed = right.length > 0 ? right.pop() : left.pop();
      if (!removed) break;
      hiddenSet.add(removed);
    }
  };
  overflow();

  return {
    left,
    right,
    hidden: [...hiddenSet],
  };
};

export const computeTopBarCollapsedItems = (layout: TopBarLayoutSettings): TopBarItemKey[] => {
  const assigned = new Set<TopBarItemKey>([...layout.left, ...layout.right]);
  const hidden = new Set(layout.hidden);
  return TOPBAR_CONTROL_KEYS.filter(key => key !== 'settings' && (hidden.has(key) || !assigned.has(key)));
};

export const findTopBarItemContainer = (
  layout: TopBarLayoutSettings,
  key: TopBarItemKey,
): TopBarMoveTarget => {
  if (layout.left.includes(key)) return 'left';
  if (layout.right.includes(key)) return 'right';
  return 'collapsed';
};

export const moveTopBarItemTo = (
  layout: TopBarLayoutSettings,
  key: TopBarItemKey,
  target: TopBarMoveTarget,
): TopBarLayoutSettings | null => {
  if (key === 'search') return normalizeTopBarLayout(layout);
  if (key === 'settings' && target === 'collapsed') return normalizeTopBarLayout(layout);

  const next: TopBarLayoutSettings = {
    left: layout.left.filter(k => k !== key),
    right: layout.right.filter(k => k !== key),
    hidden: layout.hidden.filter(k => k !== key),
  };

  if (target === 'collapsed') {
    return normalizeTopBarLayout({ ...next, hidden: [...next.hidden, key] });
  }

  if (next.left.length + next.right.length >= TOPBAR_MAX_VISIBLE_CONTROLS) {
    return null;
  }
  next[target].push(key);
  return normalizeTopBarLayout(next);
};

export type TopBarPreviewSlot =
  | 'left-0' | 'left-1' | 'left-2' | 'left-3' | 'left-4'
  | 'right-0' | 'right-1' | 'right-2' | 'right-3' | 'right-4';

export const TOPBAR_PREVIEW_SLOTS: TopBarPreviewSlot[] = [
  'left-0', 'left-1', 'left-2', 'left-3', 'left-4',
  'right-0', 'right-1', 'right-2', 'right-3', 'right-4',
];

export const TOPBAR_LEFT_SLOTS: TopBarPreviewSlot[] = ['left-0', 'left-1', 'left-2', 'left-3', 'left-4'];
export const TOPBAR_RIGHT_SLOTS: TopBarPreviewSlot[] = ['right-0', 'right-1', 'right-2', 'right-3', 'right-4'];

export type TopBarPreviewSlotItems = Record<TopBarPreviewSlot, TopBarItemKey | null>;

export const getTopBarPreviewSlotItems = (value: TopBarLayoutSettings): TopBarPreviewSlotItems => {
  const layout = normalizeTopBarLayout(value);
  const hidden = new Set(layout.hidden);
  const visibleItem = (key: TopBarItemKey | null | undefined): TopBarItemKey | null =>
    key && !hidden.has(key) ? key : null;

  const result = {} as TopBarPreviewSlotItems;
  for (let i = 0; i < 5; i++) {
    result[`left-${i}` as TopBarPreviewSlot] = visibleItem(layout.left[i]);
    result[`right-${i}` as TopBarPreviewSlot] = visibleItem(layout.right[i]);
  }
  return result;
};

const layoutFromPreviewSlots = (
  slots: TopBarPreviewSlotItems,
  hidden: TopBarItemKey[],
): TopBarLayoutSettings => normalizeTopBarLayout({
  left: TOPBAR_LEFT_SLOTS.map(slot => slots[slot]).filter((key): key is TopBarItemKey => key !== null),
  right: TOPBAR_RIGHT_SLOTS.map(slot => slots[slot]).filter((key): key is TopBarItemKey => key !== null),
  hidden,
});

export const moveTopBarItemToPreviewSlot = (
  value: TopBarLayoutSettings,
  key: TopBarItemKey,
  targetSlot: TopBarPreviewSlot,
): TopBarLayoutSettings => {
  const layout = normalizeTopBarLayout(value);
  const slots = getTopBarPreviewSlotItems(layout);
  const sourceSlot = TOPBAR_PREVIEW_SLOTS.find(slot => slots[slot] === key);
  if (!sourceSlot || sourceSlot === targetSlot) return layout;

  const displacedItem = slots[targetSlot];
  slots[targetSlot] = key;
  slots[sourceSlot] = displacedItem;
  return layoutFromPreviewSlots(slots, layout.hidden.filter(item => item !== key));
};

export const setTopBarItemVisibility = (
  value: TopBarLayoutSettings,
  key: TopBarItemKey,
  visible: boolean,
): TopBarLayoutSettings => {
  const layout = normalizeTopBarLayout(value);
  const hidden = layout.hidden.filter(item => item !== key);

  if (!visible) {
    if (FIXED_KEY_SET.has(key)) return layout;
    const left = layout.left.filter(k => k !== key);
    const right = layout.right.filter(k => k !== key);
    return normalizeTopBarLayout({ left, right, hidden: [...hidden, key] });
  }

  if (layout.left.includes(key) || layout.right.includes(key)) {
    return normalizeTopBarLayout({ ...layout, hidden });
  }

  const defaultLeftIndex = DEFAULT_TOPBAR_LAYOUT.left.indexOf(key);
  if (defaultLeftIndex >= 0) {
    const left = [...layout.left];
    left.splice(Math.min(defaultLeftIndex, left.length), 0, key);
    return normalizeTopBarLayout({ ...layout, left, hidden });
  }
  const defaultRightIndex = DEFAULT_TOPBAR_LAYOUT.right.indexOf(key);
  if (defaultRightIndex >= 0) {
    const right = [...layout.right];
    right.splice(Math.min(defaultRightIndex, right.length), 0, key);
    return normalizeTopBarLayout({ ...layout, right, hidden });
  }
  const right = [...layout.right, key];
  return normalizeTopBarLayout({ ...layout, right, hidden });
};