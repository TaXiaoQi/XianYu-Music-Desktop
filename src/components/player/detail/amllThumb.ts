// AMLL 皮肤顶部拖拽条（thumb）手势判定：纯函数便于单测。
// 语义：向下拖拽超过阈值 = 收起详情页；轻点（未触发拖拽）= 收起详情页。

/** 向下拖拽触发收起的位移阈值（px） */
export const AMLL_THUMB_DRAG_THRESHOLD = 48;

/** 拖拽过程中判定：达到阈值即触发收起（只触发一次由调用方保证） */
export function resolveThumbDrag(
    dy: number,
    threshold: number = AMLL_THUMB_DRAG_THRESHOLD,
): "none" | "collapse" {
    return dy >= threshold ? "collapse" : "none";
}

/** 抬手时判定：未触发过拖拽且位移在阈值内 = 轻点，收起 */
export function resolveThumbTap(
    dy: number,
    threshold: number = AMLL_THUMB_DRAG_THRESHOLD,
): boolean {
    return Math.abs(dy) < threshold;
}
