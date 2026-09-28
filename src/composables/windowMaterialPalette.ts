// 窗口材质的「配色与资格」纯函数集：所有发往原生层的 RGBA 取值、
// mica 效果标识以及 Windows 版本资格判定都集中在这里，便于单独核对
// 数值口径；本文件不含任何副作用。
import { type Color, Effect } from '@tauri-apps/api/window';

/** 材质能力快照的结构口径（由 tauri 侧 get_window_material_capabilities 上报） */
export interface WindowMaterialCapabilities {
  isWindows: boolean;
  supportsAcrylic: boolean;
  supportsMica: boolean;
  supportsBlur: boolean;
  systemTransparencyEnabled: boolean | null;
  windowsBuildNumber: number | null;
}

/** 半透明材质下窗口底色必须完全透明，由系统特效负责绘制 */
export const TRANSLUCENT_SURFACE_COLOR: Color = [0, 0, 0, 0];

/** mica 效果没有暴露在 TS 枚举里，只能按字符串下发（Rust 侧可识别） */
export const NATIVE_MICA_EFFECT_BY_DARKNESS: Record<'dark' | 'light', Effect> = {
  dark: 'micaDark' as Effect,
  light: 'micaLight' as Effect,
};

/** Windows 11 最低 build 号：mica / acrylic 仅在该版本及以上放行 */
const WINDOWS11_MIN_BUILD = 22000;

/** acyrylic 特效着色：暗色偏深、透明度更高，亮色偏浅 */
export function buildAcrylicTint(isDark: boolean): Color {
  return isDark ? [18, 18, 18, 140] : [248, 248, 248, 125];
}

/** blur 特效的 RGB 底色（透明度随主题与用户滑杆动态计算） */
const BLUR_TINT_RGB: Record<'dark' | 'light', [number, number, number]> = {
  dark: [18, 18, 18],
  light: [248, 248, 248],
};

/** 把用户侧 0~100 的模糊着色强度夹取到合法区间并取整 */
export function clampTintPercentage(rawTint = 50): number {
  return Math.min(100, Math.max(0, Math.round(rawTint)));
}

/** blur 特效着色：暗色下透明度随强度增幅更大，避免暗色发灰 */
export function buildBlurTint(isDark: boolean, tintPercentage = 50): Color {
  const tint = clampTintPercentage(tintPercentage);
  const alpha = isDark ? 50 + Math.round(tint * 1.2) : 40 + tint;
  const [r, g, b] = BLUR_TINT_RGB[isDark ? 'dark' : 'light'];
  return [r, g, b, alpha];
}

/** 关闭材质回退到普通窗口时使用的实底色（跟随明暗基调） */
export function buildOpaqueSurfaceColor(isDark: boolean): Color {
  return isDark ? [38, 38, 38, 255] : [255, 255, 255, 255];
}

/** 是否运行在 Windows 11 及以上（mica / acrylic 的硬性门槛） */
export function runsOnWindows11(isWindows: boolean, buildNumber: number | null): boolean {
  return isWindows && buildNumber !== null && buildNumber >= WINDOWS11_MIN_BUILD;
}
