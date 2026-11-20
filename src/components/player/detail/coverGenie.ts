// AMLL 封面 genie 式进出过渡：纯数学模块（无 DOM，可完整单测）。
// 对应 Mac 窗口最小化动画的 UV 收缩思路（CSDN chase0128/110487710），
// 由 Canvas2D 逐行切片绘制实现：顶边向底部锚点收缩最强、底边保持全宽，
// 纵向压缩在时间后半段才介入，t=0 恒等、t=1 收缩为锚点线。

/** genie 动画时长（ms），对齐 morph-stage 的 700ms 容器过渡 */
export const GENIE_DURATION_MS = 700;

/** 每条切片的设备像素行高（480px 封面 ≈ 240 条/帧；实测掉帧可提到 4 减半切片） */
export const GENIE_SLICE_PX = 2;

/** 切片行数上下限（极小封面也保证曲线平滑，极大封面限制每帧 drawImage 数） */
export const GENIE_MIN_SLICES = 8;
export const GENIE_MAX_SLICES = 240;

/** 曲率指数：越大则顶行相对底行收缩越强（文章 pow(1-y,2) 即 2） */
export const GENIE_CURVE_EXPONENT = 2;

export interface GenieSlice {
  /** 归一化目标矩形（0..1），相对封面盒；行 i 的源图内容绘制于此 */
  dstX: number;
  dstY: number;
  dstW: number;
  dstH: number;
}

/**
 * cubic-bezier(x1,y1,x2,y2) 求解器（二分，24 次迭代），与 CSS transition
 * timing function 同曲线，保证内容形变与容器飞行同步。
 */
export function genieEaseSolve(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (t: number) => number {
  const curve = (a: number, b: number, s: number) =>
    3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let s = t;
    for (let i = 0; i < 24; i += 1) {
      s = (lo + hi) / 2;
      if (curve(x1, x2, s) < t) lo = s;
      else hi = s;
    }
    return curve(y1, y2, s);
  };
}

/** 与 morph-stage CSS 一致的缓动曲线 */
export const genieEase = genieEaseSolve(0.22, 1, 0.36, 1);

/** 按目标高度（设备像素）决定切片行数 */
export function genieSliceCount(heightPx: number): number {
  return Math.max(
    GENIE_MIN_SLICES,
    Math.min(GENIE_MAX_SLICES, Math.round(heightPx / GENIE_SLICE_PX)),
  );
}

/**
 * 计算 t 时刻每行切片的归一化目标矩形。
 * v = 行位置（0 顶 → 1 底/锚点侧）：
 *   dstW(v) = 1 - t * pow(1 - v, 2)        行宽向中心线收缩，顶行最强
 *   dstX    = (1 - dstW) / 2               水平对称
 *   k(t)    = max(2t - 1, 0)               纵向压缩仅时间后半段介入
 *   dstY    = rowTop + (1 - rowTop) * k    整幅向底边（锚点）压拢，t=0 恒等
 *   dstH    = (1 / slices) * (1 - k)       行高同步压扁
 */
export function computeGenieSlices(t: number, slices: number): GenieSlice[] {
  const clamped = Math.max(0, Math.min(1, t));
  const rows = Math.max(GENIE_MIN_SLICES, Math.floor(slices));
  const gate = Math.max(0, 2 * clamped - 1);
  const rowH = (1 / rows) * (1 - gate);
  const out: GenieSlice[] = [];
  for (let i = 0; i < rows; i += 1) {
    // v：曲线位置（0 顶 → 1 底锚点侧，端点齐全）；rowTop：该行自身顶边位置（恒等映射基准）
    const v = rows === 1 ? 0 : i / (rows - 1);
    const rowTop = i / rows;
    const dstW = 1 - clamped * Math.pow(1 - v, GENIE_CURVE_EXPONENT);
    out.push({
      dstX: (1 - dstW) / 2,
      dstY: rowTop + (1 - rowTop) * gate,
      dstW,
      dstH: rowH,
    });
  }
  return out;
}
