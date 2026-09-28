import { smoothVisualizerLevel } from './audioVisualizerMath';

// 页脚频谱画布的绘制参数与纯函数。
// AudioVisualizer.vue 只负责采样节奏与生命周期，像素层面的事情都在这里。

// 后端一次给出的频段数量
export const SOURCE_BAND_COUNT = 48;
// 画布上实际绘制的柱数（对源频段做线性插值得到）
export const RENDERED_BAR_COUNT = 112;
// 柱子的最小像素高度（dpr 缩放前）
const MIN_BAR_PX = 3;

// 基线与画布底边的留白（乘以 dpr）
const BASELINE_INSET = 2;
// 柱宽的上下限与稀疏系数（乘以 dpr 或参与除法）
const BAR_WIDTH_FLOOR = 1.2;
const BAR_WIDTH_CEILING = 2.4;
const GAP_FLOOR = 3.5;
const SLOT_DENSITY = 3.5;
// 柱体最高能占据画布高度的比例
const PEAK_OCCUPANCY = 0.88;
// 两端柱子的额外压暗强度
const EDGE_DIMMING = 0.16;
// 低频段增益及其向高频段的线性衰减
const BASS_BOOST = 1.12;
const BASS_TILT = 0.28;
// 目标电平的伽马压缩指数
const LEVEL_GAMMA = 0.72;
// 静止 / 发光两种状态的透明度参数
const DIM_ALPHA = 0.2;
const GLOW_BASE_ALPHA = 0.36;
const GLOW_LEVEL_ALPHA = 0.42;
// 渐变上下两档的透明度系数
const TOP_ALPHA_FACTOR = 0.86;
const BOTTOM_ALPHA_FACTOR = 0.72;
// 阴影参数
const SHADOW_BLUR = 7;
const SHADOW_TINT = 'rgba(151, 191, 211, 0.36)';
// 渐变三档的 RGB 配色
const TOP_TINT = '184, 219, 236';
const MID_TINT = '137, 183, 207';
const BOTTOM_TINT = '95, 145, 174';

/** 柱子从中心向两端的压暗系数 */
const edgeFadeFactor = (barIndex: number, bars: number) => {
  const distanceFromCenter = Math.abs(barIndex - (bars - 1) / 2) / (bars / 2);
  return 1 - distanceFromCenter ** 2 * EDGE_DIMMING;
};

/** 低频增益向高频线性衰减 */
const bassTiltFactor = (barIndex: number, bars: number) => {
  const bandPosition = barIndex / Math.max(1, bars - 1);
  return BASS_BOOST - bandPosition * BASS_TILT;
};

/** 由插值电平推目标电平：暂停时归零，播放时做伽马压缩 */
const targetLevelOf = (level: number, tilt: number, isPlaying: boolean) =>
  isPlaying ? Math.min(1, Math.pow(level, LEVEL_GAMMA) * tilt) : 0;

/** 柱体透明度：播放时随电平发光，静止时保持暗态 */
const alphaOf = (level: number, isPlaying: boolean) =>
  isPlaying ? GLOW_BASE_ALPHA + level * GLOW_LEVEL_ALPHA : DIM_ALPHA;

/** 从源频段线性插值出第 barIndex 根柱子的电平 */
const interpolatedLevelOf = (sourceBins: readonly number[], barIndex: number, bars: number) => {
  const span = Math.max(1, bars - 1);
  const sourcePosition = (barIndex / span) * (sourceBins.length - 1);
  const lowerIndex = Math.floor(sourcePosition);
  const upperIndex = Math.min(sourceBins.length - 1, lowerIndex + 1);
  const mix = sourcePosition - lowerIndex;
  const lower = sourceBins[lowerIndex] ?? 0;
  const upper = sourceBins[upperIndex] ?? lower;

  return lower + (upper - lower) * mix;
};

/** 计算柱阵几何布局（全部为物理像素） */
const layoutOf = (width: number, height: number, dpr: number, bars: number) => {
  const baseline = height - BASELINE_INSET * dpr;
  const barWidth = Math.max(
    BAR_WIDTH_FLOOR * dpr,
    Math.min(BAR_WIDTH_CEILING * dpr, width / (bars * SLOT_DENSITY)),
  );
  const gap = Math.max(GAP_FLOOR * dpr, (width - barWidth * bars) / (bars - 1));
  const occupied = barWidth * bars + gap * (bars - 1);
  const originX = (width - occupied) / 2;

  return { baseline, barWidth, gap, originX };
};

const barGradientOf = (
  ctx: CanvasRenderingContext2D,
  topY: number,
  baseline: number,
  alpha: number,
) => {
  const gradient = ctx.createLinearGradient(0, topY, 0, baseline);
  gradient.addColorStop(0, `rgba(${TOP_TINT}, ${alpha * TOP_ALPHA_FACTOR})`);
  gradient.addColorStop(0.45, `rgba(${MID_TINT}, ${alpha})`);
  gradient.addColorStop(1, `rgba(${BOTTOM_TINT}, ${alpha * BOTTOM_ALPHA_FACTOR})`);
  return gradient;
};

/** 把画布后备存储对齐到 CSS 尺寸 × dpr（只在尺寸变化时写入） */
export const fitBackingStore = (canvas: HTMLCanvasElement, dpr: number) => {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
};

export interface SpectrumFrameInput {
  ctx: CanvasRenderingContext2D;
  sourceBins: readonly number[];
  renderedBins: number[];
  isPlaying: boolean;
  dpr: number;
}

/** 画一帧频谱：清屏 → 逐柱推进平滑电平 → 圆角柱 + 辉光 */
export const paintSpectrumFrame = ({
  ctx,
  sourceBins,
  renderedBins,
  isPlaying,
  dpr,
}: SpectrumFrameInput) => {
  const { width, height } = ctx.canvas;
  const bars = RENDERED_BAR_COUNT;
  const { baseline, barWidth, gap, originX } = layoutOf(width, height, dpr, bars);

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.shadowBlur = SHADOW_BLUR * dpr;
  ctx.shadowColor = SHADOW_TINT;

  for (let barIndex = 0; barIndex < bars; barIndex += 1) {
    const sampled = Math.max(0, interpolatedLevelOf(sourceBins, barIndex, bars));
    const previous = renderedBins[barIndex] ?? 0;
    const level = smoothVisualizerLevel(
      previous,
      targetLevelOf(sampled, bassTiltFactor(barIndex, bars), isPlaying),
    );

    renderedBins[barIndex] = level;

    const fade = edgeFadeFactor(barIndex, bars);
    const barHeight = Math.max(MIN_BAR_PX * dpr, level * height * PEAK_OCCUPANCY * fade);
    const x = originX + barIndex * (barWidth + gap);
    const y = baseline - barHeight;
    const radius = Math.min(barWidth / 2, 2 * dpr);

    ctx.fillStyle = barGradientOf(ctx, y, baseline, alphaOf(level, isPlaying));
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barHeight, radius);
    ctx.fill();
  }

  ctx.restore();
};
