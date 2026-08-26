import type {
  TopBarContainerKey,
  TopBarItemKey,
  TopBarLayoutSettings,
} from '../../types';

/** 顶部栏可展示的自定义控件总数上限（超出部分自动进入隐藏；搜索框固定居中补齐剩余空间） */
export const TOPBAR_MAX_VISIBLE_CONTROLS = 5;

/** 所有可编排容器（用于设置面板遍历） */
export const TOPBAR_CONTAINERS: TopBarContainerKey[] = ['left', 'right'];

/** 固定控件：搜索框始终居中；设置始终显示但可调整位置（均不可关闭） */
export const TOPBAR_FIXED_ITEMS: TopBarItemKey[] = ['search', 'settings'];

/** 默认顶部栏布局（恢复默认时使用；与当前布局一致） */
export const DEFAULT_TOPBAR_LAYOUT: TopBarLayoutSettings = {
  left: ['back'],
  right: ['theme', 'colorScheme', 'settings', 'account'],
  hidden: ['announcement'],
};

/** 容器显示信息 */
export const TOPBAR_CONTAINER_LABELS: Record<TopBarContainerKey, { label: string; hint: string }> = {
  left: { label: '左侧容器', hint: '紧邻窗口左边缘' },
  right: { label: '右侧容器', hint: '紧邻设置与窗口控制' },
};

/** 移动目标（包括收纳菜单） */
export type TopBarMoveTarget = TopBarContainerKey | 'collapsed';

export interface TopBarItemMeta {
  key: TopBarItemKey;
  label: string;
  description: string;
  /** 固定不可关闭（设置/搜索框），开关会禁用 */
  fixed: boolean;
  /** 图标名（设置面板展示用，运行时由 TitleBar 内联渲染） */
  icon: 'back' | 'search' | 'mic' | 'moon' | 'bell' | 'settings' | 'user' | 'palette';
}

/**
 * 顶部栏可配置控件元数据。
 * - search 固定居中，不参与编排但展示在列表中。
 * - settings 固定不可关闭，但可在 left/right 之间调整位置。
 * - 其余控件可自由开关与摆放。
 * 窗口控制（迷你窗/最小化/最大化/关闭）为固定区域，不属于自定义池。
 * 注意：听歌识曲为搜索框内固定内容，随搜索框移动，不在此自定义池中。
 */
export const TOPBAR_ITEMS: TopBarItemMeta[] = [
  { key: 'back',           label: '后退',     description: '返回上一个页面', icon: 'back',      fixed: false },
  { key: 'search',         label: '搜索框',   description: '全局搜索（始终居中）', icon: 'search', fixed: true },
  { key: 'theme',          label: '主题切换', description: '浅色 / 深色切换', icon: 'moon',      fixed: false },
  { key: 'announcement',   label: '公告',     description: '查看最新公告', icon: 'bell',      fixed: false },
  { key: 'settings',       label: '设置',     description: '打开设置页面（不可关闭）', icon: 'settings', fixed: true },
  { key: 'account',        label: '账号',     description: '登录 / 个人中心', icon: 'user',      fixed: false },
  { key: 'colorScheme',    label: '配色方案', description: '外观配色方案快速入口', icon: 'palette', fixed: false },
];

/** 参与编排的控件（不含固定居中的搜索框） */
export const TOPBAR_CONTROL_KEYS: TopBarItemKey[] = TOPBAR_ITEMS
  .filter(item => item.key !== 'search')
  .map(item => item.key);

/** 设置面板展示的控件（含固定项，用于显示开关） */
export const TOPBAR_DISPLAY_KEYS: TopBarItemKey[] = TOPBAR_ITEMS.map(item => item.key);

export const getTopBarItemMeta = (key: TopBarItemKey): TopBarItemMeta | undefined =>
  TOPBAR_ITEMS.find(item => item.key === key);

const CONTROL_KEY_SET = new Set<TopBarItemKey>(TOPBAR_CONTROL_KEYS);

/** 固定不可关闭的控件集合 */
const FIXED_KEY_SET = new Set<TopBarItemKey>(TOPBAR_FIXED_ITEMS);

/** 参与编排且可隐藏的控件（排除 search 与 settings） */
const HIDEABLE_KEY_SET = new Set<TopBarItemKey>(
  TOPBAR_CONTROL_KEYS.filter(key => key !== 'settings'),
);

/**
 * 将任意输入归一化为合法的顶部栏布局：
 * - 剔除非法 key、去重
 * - search 固定居中，始终不作为 left/right/hidden 成员
 * - settings 固定不可关闭，缺失时强制补回右侧
 * - 可隐藏项（recognize/theme/announcement/account/colorScheme）可进入 hidden
 * - 可见控件总数不超过 TOPBAR_MAX_VISIBLE_CONTROLS，超出部分自动进入 hidden
 * - 缺失的 key 按默认容器优先补齐，容器全满则进入 hidden
 */
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

  // settings 固定不可关闭：若未出现在任何容器且未在 hidden，强制补回右侧
  if (!seen.has('settings') && !hiddenSet.has('settings')) {
    seen.add('settings');
    right.push('settings');
  }

  // 补齐缺失项（除 search 外）：优先回到默认容器，容器全满则进入 hidden
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

  // 可见总数超限时，把多出的项移入 hidden（优先溢出右侧末尾，其次左侧末尾）
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

/** 计算收纳控件：未分配到任何容器的可隐藏项（固定项除外） */
export const computeTopBarCollapsedItems = (layout: TopBarLayoutSettings): TopBarItemKey[] => {
  const assigned = new Set<TopBarItemKey>([...layout.left, ...layout.right]);
  const hidden = new Set(layout.hidden);
  return TOPBAR_CONTROL_KEYS.filter(key => key !== 'settings' && (hidden.has(key) || !assigned.has(key)));
};

/** 查找控件当前所在的容器（不在任何容器则返回 'collapsed'） */
export const findTopBarItemContainer = (
  layout: TopBarLayoutSettings,
  key: TopBarItemKey,
): TopBarMoveTarget => {
  if (layout.left.includes(key)) return 'left';
  if (layout.right.includes(key)) return 'right';
  return 'collapsed';
};

/**
 * 将控件移动到目标容器（或收入折叠）。
 * - 移动到 collapsed：从所有容器移除（settings 除外，固定不可关闭）
 * - 移动到 left/right：若可见总数已达上限则返回 null
 * 返回 null 表示目标已满，调用方应给出提示。
 */
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

/** 可视化预览槽位：左侧 up-to-5、右侧 up-to-5（可见总数由 normalize 约束为 5） */
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

/** 在可视化预览的两个槽位之间交换控件。 */
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

/** 切换控件显示状态；重新开启时优先回到默认位置，否则放入第一个空槽位。 */
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

  // 优先放回默认位置
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