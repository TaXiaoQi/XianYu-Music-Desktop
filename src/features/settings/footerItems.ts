import type {
  FooterContainerKey,
  FooterItemKey,
  FooterLayoutSettings,
} from '../../types';

/** 各容器允许的最大控件数（超出会自动溢出到折叠收纳菜单） */
export const FOOTER_CONTAINER_LIMITS: Record<FooterContainerKey, number> = {
  left: 2,
  middleLeft: 1,
  middleRight: 1,
  right: 5,
};

/** 所有容器（用于设置面板遍历） */
export const FOOTER_CONTAINERS: FooterContainerKey[] = ['left', 'middleLeft', 'middleRight', 'right'];

/** 默认底部栏布局（恢复默认时使用） */
export const DEFAULT_FOOTER_LAYOUT: FooterLayoutSettings = {
  left: ['favorite', 'download'],
  middleLeft: 'playMode',
  middleRight: 'desktopLyrics',
  right: ['quality', 'volume', 'equalizer', 'playlist', 'comment'],
  hidden: [],
};

/** 容器显示信息 */
export const FOOTER_CONTAINER_LABELS: Record<FooterContainerKey, { label: string; hint: string }> = {
  left: { label: '左侧容器', hint: '紧邻封面与歌曲信息' },
  middleLeft: { label: '中间左侧', hint: '紧邻上一首按钮' },
  middleRight: { label: '中间右侧', hint: '紧邻下一首按钮' },
  right: { label: '右侧容器', hint: '紧邻窗口右边缘' },
};

/** 移动目标（包括收纳菜单） */
export type FooterMoveTarget = FooterContainerKey | 'collapsed';

export interface FooterItemMeta {
  key: FooterItemKey;
  label: string;
  description: string;
  /** lucide 图标名（用于设置面板展示，运行时由 PlayerFooter 内联渲染） */
  icon: 'download' | 'heart' | 'repeat' | 'lyrics' | 'gauge' | 'volume' | 'equalizer' | 'playlist' | 'message-circle' | 'play';
}

/**
 * 底部栏可配置控件元数据。
 * 每个控件均可放置到任意容器中，实现完全自定义布局。
 */
export const FOOTER_ITEMS: FooterItemMeta[] = [
  { key: 'favorite',       label: '收藏',       description: '当前歌曲收藏切换', icon: 'heart' },
  { key: 'download',       label: '下载',       description: '在线歌曲下载、本地歌曲显示完成', icon: 'download' },
  { key: 'playMode',       label: '播放模式',   description: '列表循环/单曲循环/随机播放', icon: 'repeat' },
  { key: 'desktopLyrics',  label: '桌面歌词',   description: '开关桌面歌词悬浮窗', icon: 'lyrics' },
  { key: 'quality',        label: '音质',       description: '在线歌曲音质切换、本地歌曲音质标签', icon: 'gauge' },
  { key: 'volume',         label: '音量',       description: '音量调节与静音', icon: 'volume' },
  { key: 'equalizer',      label: '均衡器',     description: 'EQ 频段调节', icon: 'equalizer' },
  { key: 'playlist',       label: '播放队列',   description: '展开当前播放队列', icon: 'playlist' },
  { key: 'comment',        label: '评论区',     description: '打开当前歌曲评论（仅插件在线歌曲可用）', icon: 'message-circle' },
  { key: 'mv',             label: 'MV',         description: '播放当前歌曲的 MV 背景视频（仅插件歌曲可用，只在播放详情页底栏显示）', icon: 'play' },
];

export const FOOTER_ITEM_KEYS: FooterItemKey[] = FOOTER_ITEMS.map(item => item.key);

const FOOTER_ITEM_KEY_SET = new Set<FooterItemKey>(FOOTER_ITEM_KEYS);

export const getFooterItemMeta = (key: FooterItemKey): FooterItemMeta | undefined =>
  FOOTER_ITEMS.find(item => item.key === key);

/** 所有容器（含中间），按优先补齐顺序排列 */
const ALL_CONTAINERS_ORDERED: FooterContainerKey[] = ['left', 'middleLeft', 'middleRight', 'right'];

/**
 * 将任意输入归一化为合法的底部栏布局：
 * - 剔除非法 key、去重
 * - 超出容器容量的尾部项自动溢出
 * - 缺失的 key 补回到第一个仍有空位的容器（若已满则进入折叠）
 * - middleLeft / middleRight 为单值，若 key 非法或已占用则置 null
 * 每个控件均可放入任意容器，无 allowedContainers 限制。
 */
export const normalizeFooterLayout = (value: unknown): FooterLayoutSettings => {
  const base = typeof value === 'object' && value !== null ? value as Partial<FooterLayoutSettings> : {};
  const seen = new Set<FooterItemKey>();
  const hiddenSeen = new Set<FooterItemKey>();

  const hidden = Array.isArray(base.hidden)
    ? base.hidden.filter((item): item is FooterItemKey => {
        if (typeof item !== 'string') return false;
        const key = item as FooterItemKey;
        if (!FOOTER_ITEM_KEY_SET.has(key) || hiddenSeen.has(key)) return false;
        hiddenSeen.add(key);
        return true;
      })
    : [];
  const hiddenSet = new Set(hidden);

  const cleanList = (raw: unknown, container: FooterContainerKey): FooterItemKey[] => {
    const limit = FOOTER_CONTAINER_LIMITS[container];
    if (!Array.isArray(raw)) return [];
    const result: FooterItemKey[] = [];
    for (const item of raw) {
      if (result.length >= limit) break;
      if (typeof item !== 'string') continue;
      const key = item as FooterItemKey;
      if (!FOOTER_ITEM_KEY_SET.has(key) || seen.has(key)) continue;
      seen.add(key);
      result.push(key);
    }
    return result;
  };

  const cleanSingle = (raw: unknown): FooterItemKey | null => {
    if (typeof raw !== 'string') return null;
    const key = raw as FooterItemKey;
    if (!FOOTER_ITEM_KEY_SET.has(key) || seen.has(key)) return null;
    seen.add(key);
    return key;
  };

  const left = cleanList(base.left, 'left');
  const right = cleanList(base.right, 'right');
  let middleLeft = cleanSingle(base.middleLeft);
  let middleRight = cleanSingle(base.middleRight);

  // 旧配置只保存了 hidden，没有保留其槽位。迁移时把隐藏项补成不可见占位符：
  // 左区靠左，因此占位符放末尾；右区靠右，因此占位符放开头。
  for (const key of hidden) {
    if (seen.has(key)) continue;
    if (DEFAULT_FOOTER_LAYOUT.left.includes(key) && left.length < FOOTER_CONTAINER_LIMITS.left) {
      left.push(key);
    } else if (DEFAULT_FOOTER_LAYOUT.middleLeft === key && middleLeft === null) {
      middleLeft = key;
    } else if (DEFAULT_FOOTER_LAYOUT.middleRight === key && middleRight === null) {
      middleRight = key;
    } else if (DEFAULT_FOOTER_LAYOUT.right.includes(key) && right.length < FOOTER_CONTAINER_LIMITS.right) {
      right.unshift(key);
    } else if (right.length < FOOTER_CONTAINER_LIMITS.right) {
      right.unshift(key);
    } else if (left.length < FOOTER_CONTAINER_LIMITS.left) {
      left.push(key);
    }
    seen.add(key);
  }

  // 补齐缺失项：按元数据顺序，把未分配的 key 放回第一个仍有空位的容器
  for (const key of FOOTER_ITEM_KEYS) {
    if (seen.has(key) || hiddenSet.has(key)) continue;
    for (const container of ALL_CONTAINERS_ORDERED) {
      if (container === 'middleLeft') {
        if (middleLeft === null) {
          middleLeft = key;
          seen.add(key);
          break;
        }
        continue;
      }
      if (container === 'middleRight') {
        if (middleRight === null) {
          middleRight = key;
          seen.add(key);
          break;
        }
        continue;
      }
      const list = container === 'left' ? left : right;
      const limit = FOOTER_CONTAINER_LIMITS[container];
      if (list.length < limit) {
        list.push(key);
        seen.add(key);
        break;
      }
    }
    // 所有容器都满时，留在折叠区
  }

  return { left, middleLeft, middleRight, right, hidden };
};

/** 计算折叠收纳菜单中的控件：包含未分配项 + 在设置页关闭主栏显示的项 */
export const computeCollapsedItems = (layout: FooterLayoutSettings): FooterItemKey[] => {
  const assigned = new Set<FooterItemKey>([
    ...layout.left,
    ...(layout.middleLeft ? [layout.middleLeft] : []),
    ...(layout.middleRight ? [layout.middleRight] : []),
    ...layout.right,
  ]);
  const hidden = new Set(layout.hidden);
  return FOOTER_ITEM_KEYS.filter(key => hidden.has(key) || !assigned.has(key));
};

/** 查找控件当前所在的容器（不在任何容器则返回 'collapsed'） */
export const findItemContainer = (
  layout: FooterLayoutSettings,
  key: FooterItemKey,
): FooterMoveTarget => {
  if (layout.left.includes(key)) return 'left';
  if (layout.middleLeft === key) return 'middleLeft';
  if (layout.middleRight === key) return 'middleRight';
  if (layout.right.includes(key)) return 'right';
  return 'collapsed';
};

/**
 * 将控件移动到目标容器（或收入折叠）。
 * - 移动到 collapsed：从所有容器移除
 * - 移动到列表容器（left/right）：若已满则返回 null
 * - 移动到中间容器（middleLeft/middleRight）：若已占用则返回 null
 * 返回 null 表示目标已满/已占用，调用方应给出提示。
 */
export const moveFooterItemTo = (
  layout: FooterLayoutSettings,
  key: FooterItemKey,
  target: FooterMoveTarget,
): FooterLayoutSettings | null => {
  // 从所有容器移除该 key
  const next: FooterLayoutSettings = {
    left: layout.left.filter(k => k !== key),
    middleLeft: layout.middleLeft === key ? null : layout.middleLeft,
    middleRight: layout.middleRight === key ? null : layout.middleRight,
    right: layout.right.filter(k => k !== key),
    hidden: layout.hidden.filter(k => k !== key),
  };

  // 收入折叠：移除即可
  if (target === 'collapsed') {
    return normalizeFooterLayout(next);
  }

  const limit = FOOTER_CONTAINER_LIMITS[target];

  if (target === 'middleLeft') {
    if (next.middleLeft !== null) return null;
    next.middleLeft = key;
    return normalizeFooterLayout(next);
  }
  if (target === 'middleRight') {
    if (next.middleRight !== null) return null;
    next.middleRight = key;
    return normalizeFooterLayout(next);
  }
  const list = target === 'left' ? next.left : next.right;
  if (list.length >= limit) return null;
  list.push(key);
  return normalizeFooterLayout(next);
};

export type FooterPreviewSlot =
  | 'left-0'
  | 'left-1'
  | 'middle-left'
  | 'middle-right'
  | 'right-0'
  | 'right-1'
  | 'right-2'
  | 'right-3'
  | 'right-4';

export const FOOTER_PREVIEW_SLOTS: FooterPreviewSlot[] = [
  'left-0',
  'left-1',
  'middle-left',
  'middle-right',
  'right-0',
  'right-1',
  'right-2',
  'right-3',
  'right-4',
];

export type FooterPreviewSlotItems = Record<FooterPreviewSlot, FooterItemKey | null>;

export const getFooterPreviewSlotItems = (value: FooterLayoutSettings): FooterPreviewSlotItems => {
  const layout = normalizeFooterLayout(value);
  const hidden = new Set(layout.hidden);
  const visibleItem = (key: FooterItemKey | null | undefined): FooterItemKey | null =>
    key && !hidden.has(key) ? key : null;

  return {
    'left-0': visibleItem(layout.left[0]),
    'left-1': visibleItem(layout.left[1]),
    'middle-left': visibleItem(layout.middleLeft),
    'middle-right': visibleItem(layout.middleRight),
    'right-0': visibleItem(layout.right[0]),
    'right-1': visibleItem(layout.right[1]),
    'right-2': visibleItem(layout.right[2]),
    'right-3': visibleItem(layout.right[3]),
    'right-4': visibleItem(layout.right[4]),
  };
};

const getRawFooterPreviewSlotItems = (value: FooterLayoutSettings): FooterPreviewSlotItems => {
  const layout = normalizeFooterLayout(value);
  return {
    'left-0': layout.left[0] ?? null,
    'left-1': layout.left[1] ?? null,
    'middle-left': layout.middleLeft,
    'middle-right': layout.middleRight,
    'right-0': layout.right[0] ?? null,
    'right-1': layout.right[1] ?? null,
    'right-2': layout.right[2] ?? null,
    'right-3': layout.right[3] ?? null,
    'right-4': layout.right[4] ?? null,
  };
};

const layoutFromPreviewSlots = (
  slots: FooterPreviewSlotItems,
  hidden: FooterItemKey[],
): FooterLayoutSettings => normalizeFooterLayout({
  left: [slots['left-0'], slots['left-1']].filter((key): key is FooterItemKey => key !== null),
  middleLeft: slots['middle-left'],
  middleRight: slots['middle-right'],
  right: [
    slots['right-0'],
    slots['right-1'],
    slots['right-2'],
    slots['right-3'],
    slots['right-4'],
  ].filter((key): key is FooterItemKey => key !== null),
  hidden,
});

/** 在可视化预览的两个槽位之间交换控件。 */
export const moveFooterItemToPreviewSlot = (
  value: FooterLayoutSettings,
  key: FooterItemKey,
  targetSlot: FooterPreviewSlot,
): FooterLayoutSettings => {
  const layout = normalizeFooterLayout(value);
  const slots = getRawFooterPreviewSlotItems(layout);
  const sourceSlot = FOOTER_PREVIEW_SLOTS.find(slot => slots[slot] === key);
  if (!sourceSlot || sourceSlot === targetSlot) return layout;

  const displacedItem = slots[targetSlot];
  slots[targetSlot] = key;
  slots[sourceSlot] = displacedItem;
  return layoutFromPreviewSlots(slots, layout.hidden.filter(item => item !== key));
};

const DEFAULT_SLOT_BY_ITEM = Object.fromEntries(
  Object.entries(getFooterPreviewSlotItems(DEFAULT_FOOTER_LAYOUT))
    .filter((entry): entry is [FooterPreviewSlot, FooterItemKey] => entry[1] !== null)
    .map(([slot, key]) => [key, slot]),
) as Partial<Record<FooterItemKey, FooterPreviewSlot>>;

/** 切换控件显示状态；重新开启时优先回到默认位置，否则放入第一个空槽位。 */
export const setFooterItemVisibility = (
  value: FooterLayoutSettings,
  key: FooterItemKey,
  visible: boolean,
): FooterLayoutSettings => {
  const layout = normalizeFooterLayout(value);
  const slots = getRawFooterPreviewSlotItems(layout);
  const currentSlot = FOOTER_PREVIEW_SLOTS.find(slot => slots[slot] === key);

  if (!visible) {
    const hidden = [...layout.hidden.filter(item => item !== key), key];
    if (layout.right.includes(key)) {
      return normalizeFooterLayout({
        ...layout,
        right: [key, ...layout.right.filter(item => item !== key)],
        hidden,
      });
    }
    if (layout.left.includes(key)) {
      return normalizeFooterLayout({
        ...layout,
        left: [...layout.left.filter(item => item !== key), key],
        hidden,
      });
    }
    return normalizeFooterLayout({ ...layout, hidden });
  }

  if (currentSlot) {
    return layout.hidden.includes(key)
      ? normalizeFooterLayout({ ...layout, hidden: layout.hidden.filter(item => item !== key) })
      : layout;
  }
  const hidden = layout.hidden.filter(item => item !== key);
  const defaultLeftIndex = DEFAULT_FOOTER_LAYOUT.left.indexOf(key);
  if (defaultLeftIndex >= 0 && layout.left.length < FOOTER_CONTAINER_LIMITS.left) {
    const left = [...layout.left];
    left.splice(Math.min(defaultLeftIndex, left.length), 0, key);
    return normalizeFooterLayout({ ...layout, left, hidden });
  }
  if (DEFAULT_FOOTER_LAYOUT.middleLeft === key && layout.middleLeft === null) {
    return normalizeFooterLayout({ ...layout, middleLeft: key, hidden });
  }
  if (DEFAULT_FOOTER_LAYOUT.middleRight === key && layout.middleRight === null) {
    return normalizeFooterLayout({ ...layout, middleRight: key, hidden });
  }
  const defaultRightIndex = DEFAULT_FOOTER_LAYOUT.right.indexOf(key);
  if (defaultRightIndex >= 0 && layout.right.length < FOOTER_CONTAINER_LIMITS.right) {
    const right = [...layout.right];
    right.splice(Math.min(defaultRightIndex, right.length), 0, key);
    return normalizeFooterLayout({ ...layout, right, hidden });
  }

  const preferredSlot = DEFAULT_SLOT_BY_ITEM[key];
  const targetSlot = preferredSlot && slots[preferredSlot] === null
    ? preferredSlot
    : FOOTER_PREVIEW_SLOTS.find(slot => slots[slot] === null);
  if (!targetSlot) return layout;

  slots[targetSlot] = key;
  return layoutFromPreviewSlots(slots, hidden);
};
