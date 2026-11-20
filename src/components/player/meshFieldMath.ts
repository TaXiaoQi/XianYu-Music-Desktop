// 封面 → 低频色场的纯函数预处理（node 环境可单测，不依赖 DOM）。
// 组件里只负责 drawImage 降采样取像素与 GL 上传；调色/模糊在这里。
//
// 管线顺序：对比度 → 饱和度（相对亮度混色）→ 亮度倍率 → 线性缩放+抬升 → 盒式模糊。
// polygon 预设必须与历史行为逐位一致：out = luma + (c - luma) * 0.64 + 26。

export interface CoverFieldPreset {
    /** 色场边长（正方形） */
    size: number;
    /** 对比度系数：1 为不处理；<1 向中灰压平细节 */
    contrast: number;
    /** 饱和度：相对亮度的混色系数，1 为原色 */
    saturation: number;
    /** 亮度倍率 */
    brightness: number;
    /** 输出线性缩放（在抬升前） */
    liftScale: number;
    /** 输出抬升量（暗部保底） */
    lift: number;
    /** 盒式模糊半径；0 为不模糊 */
    blurRadius: number;
    /** 盒式模糊遍数 */
    blurPasses: number;
}

/** 多边形流光：低分辨率色场 + 抬暗部，不做模糊（片元内平涂自带块面感） */
export const POLYGON_FIELD_PRESET: CoverFieldPreset = {
    size: 14,
    contrast: 1,
    saturation: 0.64,
    brightness: 1,
    liftScale: 1,
    lift: 26,
    blurRadius: 0,
    blurPasses: 0,
};

/** 流体网格：64×64 + 压对比 + 提饱和 + 两轮盒式模糊，得到平滑可连续采样的色场 */
export const FLUID_FIELD_PRESET: CoverFieldPreset = {
    size: 64,
    contrast: 0.52,
    saturation: 1.7,
    brightness: 1.12,
    liftScale: 0.8,
    lift: 12,
    blurRadius: 6,
    blurPasses: 2,
};

const clamp255 = (value: number): number =>
    Math.max(0, Math.min(255, Math.round(value)));

/** 逐像素调色：对比度 → 饱和度 → 亮度 → 缩放+抬升。alpha 恒为 255。 */
export function applyCoverFieldTone(
    src: Uint8ClampedArray | Uint8Array,
    preset: CoverFieldPreset,
): Uint8Array {
    const out = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i += 4) {
        let r = src[i];
        let g = src[i + 1];
        let b = src[i + 2];

        if (preset.contrast !== 1) {
            r = (r - 128) * preset.contrast + 128;
            g = (g - 128) * preset.contrast + 128;
            b = (b - 128) * preset.contrast + 128;
        }

        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = luma + (r - luma) * preset.saturation;
        g = luma + (g - luma) * preset.saturation;
        b = luma + (b - luma) * preset.saturation;

        if (preset.brightness !== 1) {
            r *= preset.brightness;
            g *= preset.brightness;
            b *= preset.brightness;
        }

        out[i] = clamp255(r * preset.liftScale + preset.lift);
        out[i + 1] = clamp255(g * preset.liftScale + preset.lift);
        out[i + 2] = clamp255(b * preset.liftScale + preset.lift);
        out[i + 3] = 255;
    }
    return out;
}

const channelIndex = (
    line: number,
    pos: number,
    horizontal: boolean,
    size: number,
): number => (horizontal ? line * size + pos : pos * size + line) * 4;

/** 单遍滑动窗口盒式模糊（边缘 clamp 取样），仅模糊 RGB */
function blurPass(
    src: Uint8Array,
    size: number,
    radius: number,
    horizontal: boolean,
): Uint8Array {
    const out = new Uint8Array(src.length);
    const windowSize = radius * 2 + 1;
    const clampPos = (value: number) => Math.max(0, Math.min(size - 1, value));

    for (let line = 0; line < size; line++) {
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        for (let offset = -radius; offset <= radius; offset++) {
            const idx = channelIndex(line, clampPos(offset), horizontal, size);
            sumR += src[idx];
            sumG += src[idx + 1];
            sumB += src[idx + 2];
        }
        for (let pos = 0; pos < size; pos++) {
            const outIdx = channelIndex(line, pos, horizontal, size);
            out[outIdx] = Math.round(sumR / windowSize);
            out[outIdx + 1] = Math.round(sumG / windowSize);
            out[outIdx + 2] = Math.round(sumB / windowSize);
            out[outIdx + 3] = 255;

            const addIdx = channelIndex(line, clampPos(pos + radius + 1), horizontal, size);
            const subIdx = channelIndex(line, clampPos(pos - radius), horizontal, size);
            sumR += src[addIdx] - src[subIdx];
            sumG += src[addIdx + 1] - src[subIdx + 1];
            sumB += src[addIdx + 2] - src[subIdx + 2];
        }
    }
    return out;
}

/** 横竖各一遍为一轮的可分离盒式模糊 */
export function boxBlurField(
    src: Uint8Array,
    size: number,
    radius: number,
    passes: number,
): Uint8Array {
    if (radius <= 0 || passes <= 0 || size <= 0) return src.slice();
    let current = src;
    for (let pass = 0; pass < passes; pass++) {
        current = blurPass(current, size, radius, true);
        current = blurPass(current, size, radius, false);
    }
    return current;
}

/** 调色 + 模糊一条龙：组件拿到 getImageData 后直接调用 */
export function buildCoverFieldFromPixels(
    src: Uint8ClampedArray | Uint8Array,
    preset: CoverFieldPreset,
): Uint8Array {
    const toned = applyCoverFieldTone(src, preset);
    return boxBlurField(toned, preset.size, preset.blurRadius, preset.blurPasses);
}
