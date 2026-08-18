import { Effect, getCurrentWindow, type Color } from '@tauri-apps/api/window';
import { nextTick, ref } from 'vue';
import { windowApi, type WindowMaterialCapabilities as TauriWindowMaterialCapabilities } from '../services/tauri/windowApi';

export type WindowMaterialMode = 'none' | 'mica' | 'acrylic' | 'blur';
export type ResolvedWindowMaterial = 'none' | 'mica' | 'acrylic' | 'blur';

export interface WindowMaterialCapabilities {
  isWindows: boolean;
  supportsAcrylic: boolean;
  supportsMica: boolean;
  supportsBlur: boolean;
  systemTransparencyEnabled: boolean | null;
  windowsBuildNumber: number | null;
}

const defaultCapabilities = (): WindowMaterialCapabilities => ({
  isWindows: false,
  supportsAcrylic: false,
  supportsMica: false,
  supportsBlur: false,
  systemTransparencyEnabled: null,
  windowsBuildNumber: null,
});

const capabilities = ref<WindowMaterialCapabilities>(defaultCapabilities());
const activeWindowMaterial = ref<ResolvedWindowMaterial>('none');
const isWindowMaterialReady = ref(false);

/**
 * 材质卸载过渡遮罩：在 clearEffects() 前显示、原生侧稳定后隐藏，
 * 防止材质移除瞬间 DWM 合成器短暂透出桌面的一帧。
 */
const materialTransitionMaskVisible = ref(false);

/**
 * 材质切换中标志：为 true 时 MainShell 根元素添加 .material-switching 类，
 * 通过 CSS !important 禁用所有子元素的 transition，使背景色从半透明→不透明瞬间完成，
 * 避免过渡期间半透明背景导致文字透出重叠。
 */
const materialSwitching = ref(false);

let loadPromise: Promise<WindowMaterialCapabilities> | null = null;

const MICA_DARK_EFFECT = 'micaDark' as Effect;
const MICA_LIGHT_EFFECT = 'micaLight' as Effect;

function normalizeCapabilities(
  value: Partial<WindowMaterialCapabilities> | null | undefined,
): WindowMaterialCapabilities {
  return {
    ...defaultCapabilities(),
    ...value,
  };
}

export function resolveWindowMaterial(
  mode: WindowMaterialMode,
  value: WindowMaterialCapabilities = capabilities.value,
): ResolvedWindowMaterial {
  const isWindows11 = value.isWindows && value.windowsBuildNumber !== null && value.windowsBuildNumber >= 22000;

  if (value.systemTransparencyEnabled === false) {
    return 'none';
  }

  if (mode === 'mica') {
    return isWindows11 && value.supportsMica ? 'mica' : 'none';
  }

  if (mode === 'acrylic') {
    return isWindows11 && value.supportsAcrylic ? 'acrylic' : 'none';
  }

  if (mode === 'blur') {
    return value.isWindows && value.supportsBlur ? 'blur' : 'none';
  }

  return 'none';
}

function getAcrylicTint(isDark: boolean): Color {
  return isDark ? [18, 18, 18, 140] : [248, 248, 248, 125];
}

function normalizeTintValue(value = 50): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function getBlurTint(isDark: boolean, tintValue = 50): Color {
  const value = normalizeTintValue(tintValue);
  const alpha = isDark
    ? 50 + Math.round(value * 1.2)
    : 40 + value;
  return isDark ? [18, 18, 18, alpha] : [248, 248, 248, alpha];
}

function getBaseWindowColor(isDark: boolean): Color {
  // 匹配 DOM 背景色（dark:bg-[#262626] / bg-white），
  // 使窗口背景与 DOM 半透明背景叠加后的有效颜色一致，消除材质卸载时的色差闪烁
  return isDark ? [38, 38, 38, 255] : [255, 255, 255, 255];
}

function getTransparentWindowColor(): Color {
  return [0, 0, 0, 0];
}

function waitForCompositorFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return new Promise(resolve => setTimeout(resolve, 16));
  }

  return new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

async function trySetWindowBackgroundColor(color: Color): Promise<void> {
  const appWindow = getCurrentWindow();

  try {
    await appWindow.setBackgroundColor(color);
  } catch (error) {
    console.warn('Failed to set window background color:', error);
  }
}

/**
 * 显示材质过渡遮罩并等待 DOM 绘制完成，确保遮罩在 clearEffects() 前已铺满窗口。
 */
async function showTransitionMask(): Promise<void> {
  materialTransitionMaskVisible.value = true;
  await nextTick();
  await waitForCompositorFrame();
}

/**
 * 等待原生合成器稳定后隐藏遮罩。
 */
async function hideTransitionMask(): Promise<void> {
  await waitForCompositorFrame();
  materialTransitionMaskVisible.value = false;
}

async function trySetWindowShadow(enabled: boolean): Promise<void> {
  const appWindow = getCurrentWindow();

  try {
    if (appWindow.setShadow) {
      await appWindow.setShadow(enabled);
    }
  } catch (error) {
    console.warn('Failed to set window shadow:', error);
  }
}

export async function loadWindowMaterialCapabilities(force = false): Promise<WindowMaterialCapabilities> {
  if (isWindowMaterialReady.value && !force) {
    return capabilities.value;
  }

  if (loadPromise && !force) {
    return loadPromise;
  }

  loadPromise = windowApi.getWindowMaterialCapabilities()
    .then((result) => {
      const normalized = normalizeCapabilities(result as TauriWindowMaterialCapabilities);
      capabilities.value = normalized;
      isWindowMaterialReady.value = true;
      return normalized;
    })
    .catch((error) => {
      console.error('Failed to query window material capabilities:', error);
      const fallback = defaultCapabilities();
      capabilities.value = fallback;
      isWindowMaterialReady.value = true;
      return fallback;
    })
    .finally(() => {
      loadPromise = null;
    });

  return loadPromise;
}

export async function applyWindowMaterial(
  mode: WindowMaterialMode,
  isDark: boolean,
  blurTint = 50,
): Promise<ResolvedWindowMaterial> {
  const value = await loadWindowMaterialCapabilities();
  const resolved = resolveWindowMaterial(mode, value);
  const appWindow = getCurrentWindow();

  try {
    if (resolved === 'mica') {
      await trySetWindowBackgroundColor(getTransparentWindowColor());
      await appWindow.setEffects({
        effects: [isDark ? MICA_DARK_EFFECT : MICA_LIGHT_EFFECT],
      });
      await trySetWindowShadow(true);
    } else if (resolved === 'acrylic') {
      await trySetWindowBackgroundColor(getTransparentWindowColor());
      await windowApi.setDarkModeForWindow(isDark);
      await appWindow.setEffects({
        effects: [Effect.Acrylic],
        color: getAcrylicTint(isDark),
      });
      await trySetWindowShadow(true);
    } else if (resolved === 'blur') {
      await trySetWindowBackgroundColor(getTransparentWindowColor());
      await windowApi.setDarkModeForWindow(isDark);
      await appWindow.setEffects({
        effects: [Effect.Blur],
        color: getBlurTint(isDark, blurTint),
      });
      await trySetWindowShadow(false);
    } else {
      const baseColor = getBaseWindowColor(isDark);
      const prev = activeWindowMaterial.value;
      const needsTransitionMask = prev !== 'none';

      if (prev === 'acrylic' || prev === 'blur') {
        // 先将材质 tint 调至完全不透明的目标色，使 acrylic/blur 从"半透明模糊桌面"
        // 变为"纯色"，后续清除材质时不再有可见变化
        const effect = prev === 'acrylic' ? Effect.Acrylic : Effect.Blur;
        await appWindow.setEffects({ effects: [effect], color: baseColor });
        await waitForCompositorFrame();
        // tint 已为纯色，设置窗口背景（用户不可见，被不透明 tint 遮盖）
        await trySetWindowBackgroundColor(baseColor);
      } else if (prev === 'mica') {
        // mica：先设置不透明背景色并等待渲染生效
        await trySetWindowBackgroundColor(baseColor);
        await waitForCompositorFrame();
      }

      // 在 clearEffects() 前显示不透明遮罩，防止 DWM 移除材质瞬间透出桌面
      if (needsTransitionMask) {
        await showTransitionMask();
      }

      // 禁用 CSS 过渡：activeWindowMaterial 变更会触发多个组件的
      // transition-colors duration-500，导致背景在 500ms 内处于半透明态，
      // 造成文字透出重叠。禁用后背景色瞬间切换到不透明。
      //
      // 仅在材质确实发生变化（prev !== 'none'）时才禁用。none → none 属于
      // 无材质下的常规重同步（深浅色切换、窗口聚焦都会走到这里），此时并没有
      // 半透明中间态需要规避；若照样置 true，MainShell 的
      // `.material-switching * { transition: none !important }` 会把整棵树的
      // 过渡一并掐掉，深浅色切换的渐变就永远不生效。
      const shouldSuppressTransitions = needsTransitionMask;
      if (shouldSuppressTransitions) {
        materialSwitching.value = true;
        await nextTick();
      }

      try {
        // 更新 DOM 背景（bg-transparent → bg-white/30 dark:bg-[#262626]/60），
        // 窗口背景色已与之匹配，不会产生色差
        activeWindowMaterial.value = 'none';
        await nextTick();
        await appWindow.clearEffects();
        await trySetWindowShadow(true);
        await waitForCompositorFrame();
      } finally {
        // 原生侧已稳定（或出错），先恢复 CSS 过渡（无值变化，不会触发动画）
        if (shouldSuppressTransitions) {
          materialSwitching.value = false;
        }
        // 再淡出遮罩（此时背景已完全不透明，遮罩下无可透内容）
        if (needsTransitionMask) {
          await hideTransitionMask();
        }
      }
    }

    activeWindowMaterial.value = resolved;
  } catch (error) {
    console.error('Failed to apply window material:', error);
    activeWindowMaterial.value = 'none';
  }

  return activeWindowMaterial.value;
}

interface RebuildWindowMaterialDeps {
  clearEffects: () => Promise<unknown>;
  waitForRepaint: () => Promise<unknown>;
  applyMaterial: (mode: WindowMaterialMode, isDark: boolean, blurTint: number) => Promise<ResolvedWindowMaterial>;
}

export async function rebuildWindowMaterialForCompositor(
  mode: WindowMaterialMode,
  isDark: boolean,
  blurTint = 50,
  deps?: Partial<RebuildWindowMaterialDeps>,
): Promise<ResolvedWindowMaterial> {
  const clearEffects = deps?.clearEffects ?? (() => getCurrentWindow().clearEffects());
  const waitForRepaint = deps?.waitForRepaint ?? waitForCompositorFrame;
  const applyMaterial = deps?.applyMaterial ?? applyWindowMaterial;

  if (mode === 'none') {
    return applyMaterial(mode, isDark, blurTint);
  }

  // 重建材质时 clearEffects() 会短暂移除材质，DOM 仍为透明态，
  // 显示遮罩防止透出桌面；同时禁用 CSS 过渡防止半透明背景闪烁
  try {
    await showTransitionMask();
    materialSwitching.value = true;
    await nextTick();
    await clearEffects();
    activeWindowMaterial.value = 'none';
    await waitForRepaint();
  } catch (error) {
    console.warn('Failed to rebuild window material compositor:', error);
  }

  try {
    return await applyMaterial(mode, isDark, blurTint);
  } finally {
    // 新材质已应用，等待 DOM 更新后恢复过渡并隐藏遮罩
    await nextTick();
    await waitForCompositorFrame();
    materialSwitching.value = false;
    await hideTransitionMask();
  }
}

export function useWindowMaterial() {
  return {
    capabilities,
    activeWindowMaterial,
    isWindowMaterialReady,
    materialTransitionMaskVisible,
    materialSwitching,
    loadWindowMaterialCapabilities,
    applyWindowMaterial,
    rebuildWindowMaterialForCompositor,
  };
}
