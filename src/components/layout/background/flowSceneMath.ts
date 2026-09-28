// 流光背景的纯计算部分：调色板收敛、底色渐变合成与漂移周期换算。
// 该模块不持有任何响应式状态，便于上游场景组合层复用。
import type { CSSProperties } from 'vue';

/** 流光层生命周期：进场 → 在场 → 退场 */
export type FlowLayerPhase = 'entering' | 'current' | 'previous';

/** 单个流光层在某一时刻的完整呈现快照 */
export interface FlowLayerSnapshot {
  layerKey: number;
  phase: FlowLayerPhase;
  shellTone: string;
  palette: string[];
  basePaint: CSSProperties;
  blobOpacity: number;
  noiseOpacity: number;
  overlayTone: string;
  overlayOpacity: number;
  motionVars: Record<string, string>;
  motionFrozen: boolean;
}

/** 场景切换交接时长：新层完成进场后旧层即被丢弃 */
export const SCENE_HANDOFF_MS = 1180;

/** 主色不足时启用的兜底四色 */
export const RESERVED_PALETTE = [
  'hsl(220, 28%, 34%)',
  'hsl(196, 58%, 56%)',
  'hsl(340, 52%, 58%)',
  'hsl(42, 72%, 60%)',
];

/** 过滤无效色值；有效色不足三个时回退到保留色板 */
export function stabilizePalette(colors: string[]): string[] {
  const usable = colors.filter((color) => color && color !== 'transparent');
  return usable.length >= 3 ? usable : [...RESERVED_PALETTE];
}

/** 由底色/强调色/边缘色合成背景渐变叠层 */
export function composeBasePaint(palette: string[], baseOpacity: number, depth: number): CSSProperties {
  const [base, accent, edge, glow] = palette;
  return {
    opacity: baseOpacity,
    background: [
      `radial-gradient(circle at 18% 18%, ${accent} 0%, transparent ${38 + depth * 8}%)`,
      `radial-gradient(circle at 82% 78%, ${glow || edge || base} 0%, transparent ${42 + depth * 10}%)`,
      `linear-gradient(135deg, ${base} 0%, ${edge || accent || base} 100%)`,
    ].join(', '),
  };
}

/** 把速度偏好换算成三组光斑的 CSS 动画时长变量 */
export function composeMotionVars(speed: number): Record<string, string> {
  const period = (anchor: number, span: number) => `${(anchor - speed * span).toFixed(2)}s`;
  return {
    '--mesh-duration-1': period(18, 8),
    '--mesh-duration-2': period(22, 9),
    '--mesh-duration-3': period(26, 10),
  };
}
