/// <reference lib="webworker" />
/**
 * 颜色提取 Web Worker
 *
 * 将图像加载、Canvas 像素采样、HSL 聚类、调色板选择等计算密集型任务
 * 从主线程迁移到 Worker 线程，避免切歌时 UI 卡顿。
 *
 * Worker 内部使用 fetch + createImageBitmap + OffscreenCanvas 替代
 * 主线程的 Image + document.createElement('canvas')，所有逻辑自包含。
 */

// --- 类型定义 ---

interface HslColor {
  h: number;
  s: number;
  l: number;
}

interface BucketAccumulator {
  count: number;
  rSum: number;
  gSum: number;
  bSum: number;
  sSum: number;
  lSum: number;
  hxSum: number;
  hySum: number;
}

interface PaletteCandidate extends HslColor {
  count: number;
  score: number;
}

interface ExtractRequest {
  id: number;
  imageUrl: string;
  count: number;
  colorBoost: number;
  depth: number;
}

interface ExtractResponse {
  id: number;
  palette: string[];
  error?: string;
}

// --- 常量 ---

const FALLBACK_PALETTE = [
  'hsl(220, 28%, 34%)',
  'hsl(196, 58%, 56%)',
  'hsl(340, 52%, 58%)',
  'hsl(42, 72%, 60%)',
];

const CANVAS_SIZE = 56;
const SAMPLE_STEP = 2;

// --- 工具函数 ---

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function normalizeHue(hue: number): number {
  const normalized = hue % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function angularDistance(a: number, b: number): number {
  const diff = Math.abs(normalizeHue(a) - normalizeHue(b));
  return Math.min(diff, 360 - diff);
}

// --- 颜色转换 ---

function rgbToHsl(r: number, g: number, b: number): HslColor {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const lightness = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l: lightness };
  }

  const delta = max - min;
  const saturation =
    lightness > 0.5
      ? delta / (2 - max - min)
      : delta / (max + min);

  let hue = 0;
  if (max === rNorm) {
    hue = (gNorm - bNorm) / delta + (gNorm < bNorm ? 6 : 0);
  } else if (max === gNorm) {
    hue = (bNorm - rNorm) / delta + 2;
  } else {
    hue = (rNorm - gNorm) / delta + 4;
  }

  return {
    h: normalizeHue((hue / 6) * 360),
    s: saturation,
    l: lightness,
  };
}

// --- 聚类 ---

function getBucketKey(color: HslColor): string {
  const lightBucket = Math.round(color.l * 4);

  if (color.s < 0.12) {
    return `neutral-${lightBucket}`;
  }

  const hueBucket = Math.round(normalizeHue(color.h) / 18);
  const satBucket = Math.round(color.s * 5);
  return `${hueBucket}-${satBucket}-${lightBucket}`;
}

function createCandidate(bucket: BucketAccumulator): PaletteCandidate {
  const averageHue = normalizeHue((Math.atan2(bucket.hySum, bucket.hxSum) * 180) / Math.PI);
  const averageSaturation = bucket.sSum / bucket.count;
  const averageLightness = bucket.lSum / bucket.count;
  const midtoneAffinity = 1 - Math.min(1, Math.abs(averageLightness - 0.5) / 0.5) * 0.45;
  const saturationWeight = 0.78 + averageSaturation * 1.4;
  const neutralPenalty = averageSaturation < 0.12 ? 0.52 : 1;
  const extremePenalty = averageLightness < 0.08 || averageLightness > 0.92 ? 0.3 : 1;

  return {
    h: averageHue,
    s: averageSaturation,
    l: averageLightness,
    count: bucket.count,
    score: bucket.count * saturationWeight * midtoneAffinity * neutralPenalty * extremePenalty,
  };
}

// --- 调色板选择与优化 ---

function selectPalette(candidates: PaletteCandidate[], count: number): HslColor[] {
  if (candidates.length === 0) {
    return [];
  }

  const remaining = [...candidates].sort((a, b) => b.score - a.score);
  const selected: PaletteCandidate[] = [remaining.shift() as PaletteCandidate];

  while (selected.length < count && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const minGap = selected.reduce((closest, current) => {
        const hueGap = angularDistance(candidate.h, current.h) / 180;
        const saturationGap = Math.abs(candidate.s - current.s);
        const lightnessGap = Math.abs(candidate.l - current.l);
        const distance = hueGap * 0.65 + saturationGap * 0.2 + lightnessGap * 0.15;
        return Math.min(closest, distance);
      }, Number.POSITIVE_INFINITY);

      const diversifiedScore = candidate.score * (0.8 + minGap * 1.85);
      if (diversifiedScore > bestScore) {
        bestScore = diversifiedScore;
        bestIndex = index;
      }
    }

    selected.push(remaining.splice(bestIndex, 1)[0]);
  }

  return selected.slice(0, count);
}

function polishColor(candidate: HslColor, role: number, colorBoost: number, depth: number): string {
  const hue = Math.round(normalizeHue(candidate.h));
  const saturation = candidate.s * 100;
  const lightness = candidate.l * 100;
  const boost = clamp(colorBoost / 100, 0, 1);
  const depthFactor = clamp(depth / 100, 0, 1);

  if (role === 0) {
    const refinedSaturation = saturation < 14
      ? lerp(18, 30, boost)
      : clamp(saturation * lerp(0.84, 1.02, boost) + lerp(8, 18, boost), 24, lerp(50, 68, boost));
    const refinedLightness = clamp(
      lightness * lerp(0.84, 0.58, depthFactor) + lerp(10, 4, depthFactor),
      lerp(32, 18, depthFactor),
      lerp(54, 38, depthFactor),
    );

    return `hsl(${hue}, ${Math.round(refinedSaturation)}%, ${Math.round(refinedLightness)}%)`;
  }

  const refinedSaturation = saturation < 14
    ? lerp(24 + role * 6, 36 + role * 5, boost)
    : clamp(
      saturation * lerp(0.9, 1.08, boost) + lerp(12, 22, boost),
      lerp(34, 42, boost),
      lerp(66, 82, boost),
    );
  const refinedLightness = clamp(
    lightness * lerp(0.9, 0.7, depthFactor) + lerp(12 + role * 2, 8 + role, depthFactor),
    lerp(46, 34, depthFactor),
    lerp(72, 58, depthFactor),
  );

  return `hsl(${hue}, ${Math.round(refinedSaturation)}%, ${Math.round(refinedLightness)}%)`;
}

function createDerivedAccent(anchor: HslColor, role: number, colorBoost: number, depth: number): string {
  const hueShifts = [24, -28, 52, -58];
  const lightnessShifts = [10, 4, 14, 8];
  const shift = hueShifts[(role - 1) % hueShifts.length];
  const lightnessShift = lightnessShifts[(role - 1) % lightnessShifts.length];
  const saturationBase = anchor.s * 100;
  const lightnessBase = anchor.l * 100;
  const boost = clamp(colorBoost / 100, 0, 1);
  const depthFactor = clamp(depth / 100, 0, 1);

  const hue = Math.round(normalizeHue(anchor.h + shift));
  const saturation = saturationBase < 12
    ? lerp(30 + role * 4, 40 + role * 4, boost)
    : clamp(saturationBase * lerp(0.88, 1.02, boost) + lerp(16, 26, boost), 40, lerp(68, 84, boost));
  const lightness = clamp(
    lightnessBase * lerp(0.92, 0.74, depthFactor) + lerp(lightnessShift, lightnessShift - 6, depthFactor),
    lerp(48, 34, depthFactor),
    lerp(70, 56, depthFactor),
  );

  return `hsl(${hue}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
}

function createFallbackPalette(count: number): string[] {
  return FALLBACK_PALETTE.slice(0, count);
}

// --- 核心处理：像素采样 + 聚类 + 调色板生成 ---

function processPixelData(
  imageData: Uint8ClampedArray,
  count: number,
  colorBoost: number,
  depth: number,
): string[] {
  const buckets = new Map<string, BucketAccumulator>();

  for (let y = 0; y < CANVAS_SIZE; y += SAMPLE_STEP) {
    for (let x = 0; x < CANVAS_SIZE; x += SAMPLE_STEP) {
      const offset = (y * CANVAS_SIZE + x) * 4;
      const alpha = imageData[offset + 3];
      if (alpha < 160) {
        continue;
      }

      const red = imageData[offset];
      const green = imageData[offset + 1];
      const blue = imageData[offset + 2];
      const hsl = rgbToHsl(red, green, blue);

      if (hsl.l < 0.02 || hsl.l > 0.98) {
        continue;
      }

      const key = getBucketKey(hsl);
      const bucket = buckets.get(key) ?? {
        count: 0,
        rSum: 0,
        gSum: 0,
        bSum: 0,
        sSum: 0,
        lSum: 0,
        hxSum: 0,
        hySum: 0,
      };

      bucket.count += 1;
      bucket.rSum += red;
      bucket.gSum += green;
      bucket.bSum += blue;
      bucket.sSum += hsl.s;
      bucket.lSum += hsl.l;
      bucket.hxSum += Math.cos((hsl.h * Math.PI) / 180);
      bucket.hySum += Math.sin((hsl.h * Math.PI) / 180);

      buckets.set(key, bucket);
    }
  }

  const candidates = [...buckets.values()]
    .map(createCandidate)
    .filter(candidate => candidate.count > 3)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return createFallbackPalette(count);
  }

  const selected = selectPalette(candidates, count);
  const polished = selected.map((candidate, index) => polishColor(candidate, index, colorBoost, depth));
  const anchor = selected[0] ?? { h: 220, s: 0.35, l: 0.38 };

  while (polished.length < count) {
    polished.push(createDerivedAccent(anchor, polished.length, colorBoost, depth));
  }

  return polished.slice(0, count);
}

// --- 图像加载与处理 ---

async function extractFromImage(
  imageUrl: string,
  count: number,
  colorBoost: number,
  depth: number,
): Promise<string[]> {
  // 使用 fetch + createImageBitmap 替代 new Image()
  const response = await fetch(imageUrl, { mode: 'cors' });
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status}`);
  }

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  let canvas: OffscreenCanvas | null = null;

  try {
    // 使用 OffscreenCanvas 替代 document.createElement('canvas')
    canvas = new OffscreenCanvas(CANVAS_SIZE, CANVAS_SIZE);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('OffscreenCanvas 2D context unavailable');
    }

    context.drawImage(bitmap, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    const imageData = context.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data;
    return processPixelData(imageData, count, colorBoost, depth);
  } finally {
    bitmap.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

// --- Worker 消息处理 ---

self.onmessage = async (event: MessageEvent<ExtractRequest>) => {
  const { id, imageUrl, count, colorBoost, depth } = event.data;

  try {
    const palette = await extractFromImage(imageUrl, count, colorBoost, depth);
    const response: ExtractResponse = { id, palette };
    (self as unknown as Worker).postMessage(response);
  } catch (error) {
    const response: ExtractResponse = {
      id,
      palette: createFallbackPalette(count),
      error: error instanceof Error ? error.message : String(error),
    };
    (self as unknown as Worker).postMessage(response);
  }
};
