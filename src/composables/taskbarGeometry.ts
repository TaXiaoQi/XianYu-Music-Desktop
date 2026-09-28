// 任务栏迷你播放器的纯几何求解模块：
// 物理像素 → 逻辑像素换算、任务栏停靠朝向判定、窗口锚点计算与工作区边界收敛。
// 不依赖 Tauri / Vue 运行时，可独立复用与单测。

/** Win32 层上报的物理像素矩形（左/上/右/下） */
export interface PhysicalBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 逻辑像素矩形 */
export interface LogicalBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 主屏工作区（逻辑像素）：原点 + 尺寸 */
export interface WorkAreaBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelAnchorRequest {
  /** 任务栏矩形（逻辑像素） */
  bar: LogicalBox;
  /** 通知区域矩形（逻辑像素），Rust 层未测量到时为 null */
  tray: LogicalBox | null;
  /** 几何来源是否为托盘实测（taskbar_fallback 时不可用于避让） */
  trayAnchored: boolean;
  /** 主屏工作区 */
  area: WorkAreaBox;
  /** 播控窗口逻辑尺寸 */
  winW: number;
  winH: number;
  /** 用户拖拽记忆的横向位置，存在时优先于一切自动计算 */
  rememberedX: number | null;
}

/** 避让托盘时，窗口右缘与托盘左缘之间的呼吸间隙 */
const TRAY_BREATHING_GAP = 12;
/** 未能避让托盘时，窗口右缘距任务栏右缘的内边距 */
const EDGE_FALLBACK_INSET = 16;
/** 左右任务栏兜底时，窗口距工作区底缘的悬浮间隙 */
const BOTTOM_FLOAT_GAP = 8;

/** 物理像素矩形按当前 DPI 一次性换算为逻辑像素 */
export const toLogicalBox = (box: PhysicalBox, dpi: number): LogicalBox => ({
  left: box.left / dpi,
  top: box.top / dpi,
  right: box.right / dpi,
  bottom: box.bottom / dpi,
});

/** 把 value 收敛进 [lower, upper]，与 Math.max(lower, Math.min(upper, value)) 等价 */
const keepWithin = (value: number, lower: number, upper: number) =>
  value < lower ? lower : value > upper ? upper : value;

/**
 * 求解播控窗口锚点：
 * - 水平停靠（顶/底任务栏）：纵向在任务栏矩形内居中；横向优先按托盘左缘避让，
 *   未实测到托盘时改为贴任务栏右缘；
 * - 其余情况（左右任务栏或异常布局）：悬浮于主屏工作区底部横向居中；
 * - 用户记忆位置（rememberedX）始终覆盖横向自动结果；
 * - 最终横向值收敛进工作区范围，避免飞出屏幕。
 */
export function solvePanelAnchor(request: PanelAnchorRequest): { x: number; y: number } {
  const { bar, tray, area, winW, winH } = request;
  const barSpanX = bar.right - bar.left;
  const barSpanY = bar.bottom - bar.top;
  const horizontalBar = barSpanX > barSpanY;
  const dockedToEdge = horizontalBar && (bar.top > area.y || bar.top === 0);

  let x: number;
  let y: number;
  if (dockedToEdge) {
    y = bar.top + (barSpanY - winH) / 2;
    x = tray && request.trayAnchored
      ? tray.left - winW - TRAY_BREATHING_GAP
      : bar.right - EDGE_FALLBACK_INSET - winW;
  } else {
    x = area.x + (area.width - winW) / 2;
    y = area.y + area.height - winH - BOTTOM_FLOAT_GAP;
  }

  if (request.rememberedX !== null) {
    x = request.rememberedX;
  }

  return { x: keepWithin(x, area.x, area.x + area.width - winW), y };
}
