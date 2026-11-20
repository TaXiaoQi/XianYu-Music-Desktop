// AMLL 封面 genie 式进出过渡（屏幕空间版）：纯数学模块（无 DOM，可完整单测）。
// 对应 Mac 窗口最小化动画的 UV 收缩思路（CSDN chase0128/110487710），由 Canvas2D
// 逐行切片绘制：内容在视口坐标里从展开 rect "飞"向 dock rect，越远离锚点边的行
// 收缩越强，t=1 收敛进 dock 矩形（锚点行保宽、远端行缩为线）。

/** genie 动画时长（ms），对齐容器 700ms 过渡节奏 */
export const GENIE_DURATION_MS = 700;

/** 设备像素每条切片行高（480px 封面 ≈ 240 条/帧；实测掉帧可提到 4 减半切片） */
export const GENIE_SLICE_PX = 2;

/** 切片行数上下限（极小也保证曲线平滑，极大限制每帧 drawImage 数） */
export const GENIE_MIN_SLICES = 8;
export const GENIE_MAX_SLICES = 240;

/** 曲率指数：越大则远端行相对锚点行收缩越强（文章 pow(1-y,2) 即 2） */
export const GENIE_CURVE_EXPONENT = 2;

/** 视口坐标矩形（getBoundingClientRect 同系） */
export interface GenieRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 某时刻某行的目标矩形（视口坐标） */
export interface GenieRow {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** object-cover 归一化裁切区（相对源图 0..1） */
export interface GenieCrop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * cubic-bezier(x1,y1,x2,y2) 求解器（二分 24 次，稳定且够快），与 CSS
 * transition timing function 同曲线，保证形变与缓动同步。
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

/** 与容器 CSS cubic-bezier(0.22,1,0.36,1) 一致的缓动曲线 */
export const genieEase = genieEaseSolve(0.22, 1, 0.36, 1);

/** 按目标高度（设备像素）决定切片行数 */
export function genieSliceCount(heightPx: number): number {
  return Math.max(
    GENIE_MIN_SLICES,
    Math.min(GENIE_MAX_SLICES, Math.round(heightPx / GENIE_SLICE_PX)),
  );
}

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** t 时刻的插值外框（边缘线性 lerp）；t=0→from，t=1→to */
export function genieRectAt(t: number, from: GenieRect, to: GenieRect): GenieRect {
  const c = clamp01(t);
  return {
    x: from.x + (to.x - from.x) * c,
    y: from.y + (to.y - from.y) * c,
    w: from.w + (to.w - from.w) * c,
    h: from.h + (to.h - from.h) * c,
  };
}

/** 锚点边：目标在下方→底边为锚（行自顶向下吸入）；在上方→顶边为锚 */
export function genieAnchorBottom(to: GenieRect, from: GenieRect): boolean {
  return to.y + to.h / 2 >= from.y + from.h / 2;
}

/**
 * 屏幕空间 genie：t 时刻每行切片的目标矩形（视口坐标）。
 * rect(t) = genieRectAt(from→to)；行按 rect 均匀铺行；
 * 行宽 rowW = rect.w * (1 - t * pow(1 - u, 2))，u=距锚点边的归一化距离
 * （锚点侧 u=1 不收缩，远端 u=0 收缩最强），水平关于 rect 中线对称。
 * t=0 严格铺满 from（恒等交接给原生 img），t=1 收敛进 to。
 */
export function computeGenieRectSlices(
  t: number,
  slices: number,
  from: GenieRect,
  to: GenieRect,
): GenieRow[] {
  const clamped = clamp01(t);
  const rows = Math.max(GENIE_MIN_SLICES, Math.floor(slices));
  const rect = genieRectAt(clamped, from, to);
  const anchorBottom = genieAnchorBottom(to, from);
  const out: GenieRow[] = [];
  for (let i = 0; i < rows; i += 1) {
    const v = rows === 1 ? 0.5 : i / (rows - 1);
    const u = anchorBottom ? v : 1 - v;
    const contract = clamped * Math.pow(1 - u, GENIE_CURVE_EXPONENT);
    const rowW = rect.w * (1 - contract);
    out.push({
      x: rect.x + (rect.w - rowW) / 2,
      y: rect.y + (rect.h * i) / rows,
      w: rowW,
      h: rect.h / rows,
    });
  }
  return out;
}

/**
 * CSS object-cover 等效的源图裁切区（归一化）。飞行中外框宽高比在变，
 * 每帧按当前外框重算裁切，保证内容与容器里 img 的取景一致。
 */
export function genieSourceCrop(
  naturalWidth: number,
  naturalHeight: number,
  boxWidth: number,
  boxHeight: number,
): GenieCrop {
  if (naturalWidth <= 0 || naturalHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return { sx: 0, sy: 0, sw: 1, sh: 1 };
  }
  const scale = Math.max(boxWidth / naturalWidth, boxHeight / naturalHeight);
  const visW = Math.min(naturalWidth, boxWidth / scale);
  const visH = Math.min(naturalHeight, boxHeight / scale);
  return {
    sx: (naturalWidth - visW) / 2 / naturalWidth,
    sy: (naturalHeight - visH) / 2 / naturalHeight,
    sw: visW / naturalWidth,
    sh: visH / naturalHeight,
  };
}
