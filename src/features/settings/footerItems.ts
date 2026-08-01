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

export interface FooterItemMeta {
  key: FooterItemKey;
  label: string;
  description: string;
  /** 允许放置的容器列表 */
  allowedContainers: FooterContainerKey[];
  /** lucide 图标名（用于设置面板展示，运行时由 PlayerFooter 内联渲染） */
  icon: 'download' | 'heart' | 'repeat' | 'lyrics' | 'gauge' | 'volume' | 'equalizer' | 'playlist';
}

/**
 * 底部栏可配置控件元数据。
 * 控件与容器的允许关系约束了"移动到"菜单的可选项，避免不合理布局（如下载按钮放到右侧导致菜单定位错乱）。
 */
export const FOOTER_ITEMS: FooterItemMeta[] = [
  { key: 'favorite',       label: '收藏',       description: '当前歌曲收藏切换', allowedContainers: ['left'],       icon: 'heart' },
  { key: 'download',       label: '下载',       description: '在线歌曲下载、本地歌曲显示完成', allowedContainers: ['left'], icon: 'download' },
  { key: 'playMode',       label: '播放模式',   description: '列表循环/单曲循环/随机播放', allowedContainers: ['middleLeft'], icon: 'repeat' },
  { key: 'desktopLyrics', label: '桌面歌词',   description: '开关桌面歌词悬浮窗', allowedContainers: ['middleRight'], icon: 'lyrics' },
  { key: 'quality',        label: '音质',       description: '在线歌曲音质切换、本地歌曲音质标签', allowedContainers: ['right'], icon: 'gauge' },
  { key: 'speed',          label: '倍速',       description: '0.5x ~ 2.0x 播放倍速', allowedContainers: ['right'], icon: 'gauge' },
  { key: 'volume',         label: '音量',       description: '音量调节与静音', allowedContainers: ['right'], icon: 'volume' },
  { key: 'equalizer',      label: '均衡器',     description: 'EQ 频段调节', allowedContainers: ['right'], icon: 'equalizer' },
  { key: 'playlist',       label: '播放队列',   description: '展开当前播放队列', allowedContainers: ['right'], icon: 'playlist' },
];

export const FOOTER_ITEM_KEYS: FooterItemKey[] = FOOTER_ITEMS.map(item => item.key);

const FOOTER_ITEM_KEY_SET = new Set<FooterItemKey>(FOOTER_ITEM_KEYS);

export const getFooterItemMeta = (key: FooterItemKey): FooterItemMeta | undefined =>
  FOOTER_ITEMS.find(item => item.key === key);

/**
 * 默认底部栏布局（与历史版本保持一致）。
 * 左侧：收藏 → 下载
 * 中间：播放模式 → 上一首/播放暂停/下一首 → 桌面歌词
 * 右侧：音质 → 倍速 → 音量 → 均衡器 → 播放队列
 */
export const DEFAULT_FOOTER_LAYOUT: FooterLayoutSettings = {
  left: ['favorite', 'download'],
  middleLeft: 'playMode',
  middleRight: 'desktopLyrics',
  right: ['quality', 'speed', 'volume', 'equalizer', 'playlist'],
};

const isItemAllowedIn = (key: FooterItemKey, container: FooterContainerKey): boolean => {
  const meta = getFooterItemMeta(key);
  return meta ? meta.allowedContainers.includes(container) : false;
};

/**
 * 将任意输入归一化为合法的底部栏布局：
 * - 剔除非法 key、去重
 * - 超出容器容量的尾部项自动溢出
 * - 缺失的 key 补回到其允许的第一个仍有空位的容器（若已满则进入折叠）
 * - middleLeft / middleRight 为单值，若 key 非法或已占用则置 null
 */
export const normalizeFooterLayout = (value: unknown): FooterLayoutSettings => {
  const base = typeof value === 'object' && value !== null ? value as Partial<FooterLayoutSettings> : {};
  const seen = new Set<FooterItemKey>();

  const cleanList = (raw: unknown, container: FooterContainerKey): FooterItemKey[] => {
    const limit = FOOTER_CONTAINER_LIMITS[container];
    if (!Array.isArray(raw)) return [];
    const result: FooterItemKey[] = [];
    for (const item of raw) {
      if (result.length >= limit) break;
      if (typeof item !== 'string') continue;
      const key = item as FooterItemKey;
      if (!FOOTER_ITEM_KEY_SET.has(key) || seen.has(key)) continue;
      if (!isItemAllowedIn(key, container)) continue;
      seen.add(key);
      result.push(key);
    }
    return result;
  };

  const cleanSingle = (raw: unknown, container: FooterContainerKey): FooterItemKey | null => {
    if (typeof raw !== 'string') return null;
    const key = raw as FooterItemKey;
    if (!FOOTER_ITEM_KEY_SET.has(key) || seen.has(key)) return null;
    if (!isItemAllowedIn(key, container)) return null;
    seen.add(key);
    return key;
  };

  // 用 let 让后续补齐循环可以直接赋值
  const left = cleanList(base.left, 'left');
  const right = cleanList(base.right, 'right');
  let middleLeft = cleanSingle(base.middleLeft, 'middleLeft');
  let middleRight = cleanSingle(base.middleRight, 'middleRight');

  // 补齐缺失项：按元数据顺序，把未分配的 key 放回其允许的第一个仍有空位的容器
  for (const key of FOOTER_ITEM_KEYS) {
    if (seen.has(key)) continue;
    const meta = getFooterItemMeta(key);
    if (!meta) continue;
    for (const container of meta.allowedContainers) {
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
    // 所有允许容器都满时，留在折叠区
  }

  return { left, middleLeft, middleRight, right };
};

/** 计算未分配到任何容器的控件（即折叠收纳菜单中的项目） */
export const computeCollapsedItems = (layout: FooterLayoutSettings): FooterItemKey[] => {
  const assigned = new Set<FooterItemKey>([
    ...layout.left,
    ...(layout.middleLeft ? [layout.middleLeft] : []),
    ...(layout.middleRight ? [layout.middleRight] : []),
    ...layout.right,
  ]);
  return FOOTER_ITEM_KEYS.filter(key => !assigned.has(key));
};

/** 将控件从原位置移除并尝试放入目标容器；目标已满或 key 不被允许时返回 null */
export const moveFooterItem = (
  layout: FooterLayoutSettings,
  key: FooterItemKey,
  target: FooterContainerKey,
): FooterLayoutSettings | null => {
  const meta = getFooterItemMeta(key);
  if (!meta || !meta.allowedContainers.includes(target)) return null;
  const limit = FOOTER_CONTAINER_LIMITS[target];

  // 从所有容器移除该 key
  const next: FooterLayoutSettings = {
    left: layout.left.filter(k => k !== key),
    middleLeft: layout.middleLeft === key ? null : layout.middleLeft,
    middleRight: layout.middleRight === key ? null : layout.middleRight,
    right: layout.right.filter(k => k !== key),
  };

  if (target === 'middleLeft') {
    if (next.middleLeft !== null) return null; // 已占用
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
