/**
 * 侧边栏滑动指示块的几何计算（纯函数，与 DOM 解耦）。
 *
 * 输入：导航项在列表中的偏移/高度（按渲染顺序）与激活下标；
 * 输出：指示块相对列表顶部的偏移、高度，以及是否需要显示。
 *
 * 抽成纯函数是为了让 vitest 能直接覆盖：首/中/末项激活、空列表、
 * 窗口尺寸变化后的重算、激活下标越界（回退为隐藏）等情况。
 */

export interface NavItemGeometry {
  /** 导航项相对列表顶部的偏移 */
  offsetTop: number;
  /** 导航项高度 */
  offsetHeight: number;
}

export interface NavIndicatorGeometry {
  /** 指示块相对列表顶部的偏移 */
  top: number;
  /** 指示块高度 */
  height: number;
  /** 是否应显示；越界或尺寸无效时为 false（回退为隐藏） */
  visible: boolean;
}

const hiddenGeometry = (): NavIndicatorGeometry => ({ top: 0, height: 0, visible: false });

/**
 * 计算指示块几何。
 *
 * @param items 导航项几何，按渲染顺序排列
 * @param activeIndex 激活项下标；空列表或越界时回退为隐藏
 */
export function computeNavIndicatorGeometry(
  items: readonly NavItemGeometry[],
  activeIndex: number,
): NavIndicatorGeometry {
  if (
    !Number.isInteger(activeIndex) ||
    activeIndex < 0 ||
    activeIndex >= items.length
  ) {
    return hiddenGeometry();
  }

  const item = items[activeIndex];
  if (!item || item.offsetHeight <= 0) {
    return hiddenGeometry();
  }

  return { top: item.offsetTop, height: item.offsetHeight, visible: true };
}
