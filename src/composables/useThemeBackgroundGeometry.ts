/**
 * 自定义皮肤与全局背景共用的封面几何推算
 */

export interface BackgroundGeometry {
  width: number;
  height: number;
}

/**
 * 按 object-fit:cover 规则推算图片铺进容器后的真实绘制尺寸。
 * 任一入参非正数即视为非法，返回 null。
 */
export function calculateCoverGeometry(boxWidth: number, boxHeight: number, imgWidth: number, imgHeight: number): BackgroundGeometry | null {
  const hasInvalidInput = [boxWidth, boxHeight, imgWidth, imgHeight].some((size) => size <= 0);
  if (hasInvalidInput) return null;

  const imgRatio = imgWidth / imgHeight;

  // 图片比容器更"宽"：贴住容器上下边，宽度按比例向外延展
  if (imgRatio > boxWidth / boxHeight) {
    return { width: boxHeight * imgRatio, height: boxHeight };
  }
  // 图片更"窄"或比例恰好一致：贴住容器左右边，高度按比例补齐
  return { width: boxWidth, height: boxWidth / imgRatio };
}
