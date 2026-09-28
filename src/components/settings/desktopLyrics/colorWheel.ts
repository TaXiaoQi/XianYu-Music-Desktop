import { normalizeHexColor } from '../../../composables/lyrics';

/**
 * 桌面歌词自定义配色面板所依赖的颜色换算。
 * 全部函数只做纯计算，不持有任何状态。
 */

export interface RgbChannels {
  r: number;
  g: number;
  b: number;
}

export interface HsvChannels {
  h: number;
  s: number;
  v: number;
}

/** 收敛到 0~255 的整数通道值，非有限输入按 0 处理。 */
export function clampChannelInput(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.min(255, Math.max(0, Math.round(raw)));
}

/** 收敛到 0~100 的百分比，非有限输入按 0 处理。 */
export function clampPercentInput(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.min(100, Math.max(0, raw));
}

/** 任意十六进制串 → 0~255 的 RGB 通道。 */
export function hexToRgbChannels(hex: string): RgbChannels {
  const stable = normalizeHexColor(hex, '#000000');
  return {
    r: Number.parseInt(stable.slice(1, 3), 16),
    g: Number.parseInt(stable.slice(3, 5), 16),
    b: Number.parseInt(stable.slice(5, 7), 16),
  };
}

/** RGB 通道 → 大写 `#RRGGBB`。 */
export function rgbChannelsToHex(channels: RgbChannels): string {
  const body = [channels.r, channels.g, channels.b]
    .map((byte) => clampChannelInput(byte).toString(16).padStart(2, '0'))
    .join('');
  return `#${body}`.toUpperCase();
}

/** RGB → HSV（h: 0~359，s/v: 0~100）。 */
export function rgbChannelsToHsv(channels: RgbChannels): HsvChannels {
  const red = clampChannelInput(channels.r) / 255;
  const green = clampChannelInput(channels.g) / 255;
  const blue = clampChannelInput(channels.b) / 255;
  const peak = Math.max(red, green, blue);
  const trough = Math.min(red, green, blue);
  const span = peak - trough;

  let hue = 0;
  if (span > 0) {
    const viaRed = 60 * (((green - blue) / span) % 6);
    const viaGreen = 60 * ((blue - red) / span + 2);
    const viaBlue = 60 * ((red - green) / span + 4);
    hue = peak === red ? viaRed : peak === green ? viaGreen : viaBlue;
  }
  if (hue < 0) hue += 360;

  return {
    h: Math.round(hue),
    s: peak === 0 ? 0 : Math.round((span / peak) * 100),
    v: Math.round(peak * 100),
  };
}

/** HSV → `#RRGGBB`，色相自动折回 0~359，饱和度/明度按百分比钳制。 */
export function hsvToHex(hueInput: number, satInput: number, valInput: number): string {
  const hue = ((hueInput % 360) + 360) % 360;
  const satRatio = clampPercentInput(satInput) / 100;
  const valRatio = clampPercentInput(valInput) / 100;

  const chroma = valRatio * satRatio;
  const secondary = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const floor = valRatio - chroma;

  let redPart = 0;
  let greenPart = 0;
  let bluePart = 0;
  if (hue < 60) {
    redPart = chroma;
    greenPart = secondary;
  } else if (hue < 120) {
    redPart = secondary;
    greenPart = chroma;
  } else if (hue < 180) {
    greenPart = chroma;
    bluePart = secondary;
  } else if (hue < 240) {
    greenPart = secondary;
    bluePart = chroma;
  } else if (hue < 300) {
    redPart = secondary;
    bluePart = chroma;
  } else {
    redPart = chroma;
    bluePart = secondary;
  }

  return rgbChannelsToHex({
    r: (redPart + floor) * 255,
    g: (greenPart + floor) * 255,
    b: (bluePart + floor) * 255,
  });
}
