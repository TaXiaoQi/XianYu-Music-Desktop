// 原生窗口材质编排：负责能力探测（一次性缓存）、材质降级解析，以及
// mica / acrylic / blur / none 四种归宿的实际下发。材质切换涉及合成器
// 时序，因此这里的每一步都围绕「先铺底色 → 再挂特效 → 最后修阴影」
// 的顺序展开；从材质退回 none 时用过渡遮罩抑制 CSS 过渡抖动。
import { type Color, Effect, getCurrentWindow } from '@tauri-apps/api/window';
import { ref, nextTick } from 'vue';
import { windowApi } from '../services/tauri/windowApi';
import type { WindowMaterialCapabilities as TauriWindowMaterialCapabilities } from '../services/tauri/windowApi';

import {
  buildAcrylicTint,
  buildBlurTint,
  buildOpaqueSurfaceColor,
  NATIVE_MICA_EFFECT_BY_DARKNESS,
  runsOnWindows11,
  TRANSLUCENT_SURFACE_COLOR,
  type WindowMaterialCapabilities,
} from './windowMaterialPalette';

export type WindowMaterialMode = 'none' | 'mica' | 'acrylic' | 'blur'; // 实现
export type ResolvedWindowMaterial = 'none' | 'mica' | 'acrylic' | 'blur'; // 实现

export type { WindowMaterialCapabilities } from './windowMaterialPalette';

/** 无材质可用的统一归宿值 */
const INERT_MATERIAL: ResolvedWindowMaterial = 'none';

/** 能力探测尚未落地时的兜底快照：全平台视为不支持 */
const blankCapabilitySnapshot = (): WindowMaterialCapabilities => ({
  isWindows: false, supportsAcrylic: false, supportsMica: false, supportsBlur: false,
  systemTransparencyEnabled: null, windowsBuildNumber: null,
});

// ---- 模块级共享状态（多窗口组件共用同一份能力与激活态） ----

const capabilitySnapshot = ref<WindowMaterialCapabilities>(blankCapabilitySnapshot());
const activeMaterialState = ref<ResolvedWindowMaterial>(INERT_MATERIAL);
const capabilityQuerySettled = ref(false);
const transitionMaskVisible = ref(false);
const materialSwitching = ref(false);

let capabilityQueryInFlight: Promise<WindowMaterialCapabilities> | null = null;

/** 等待 Vue 完成本轮渲染冲刷后再继续操作原生窗口 */
const flushVueRenderPass = nextTick;

/** 各模式对平台能力的资格判定；未列出的模式一律不放行 */
const eligibilityTests: Partial<Record<WindowMaterialMode, (snapshot: WindowMaterialCapabilities) => boolean>> = {
  mica: (snapshot) => runsOnWindows11(snapshot.isWindows, snapshot.windowsBuildNumber) && snapshot.supportsMica,
  acrylic: (snapshot) => runsOnWindows11(snapshot.isWindows, snapshot.windowsBuildNumber) && snapshot.supportsAcrylic,
  blur: (snapshot) => snapshot.isWindows && snapshot.supportsBlur,
};

const isSystemTransparencyDisabled = (snapshot: WindowMaterialCapabilities) =>
  snapshot.systemTransparencyEnabled === false;

/**
 * 将用户选择的模式解析为当前平台真正可用的材质：
 * 系统透明度被关闭时全部回退 none，其余按资格表判定。
 */
export function resolveWindowMaterial(mode: WindowMaterialMode, value: WindowMaterialCapabilities = capabilitySnapshot.value): ResolvedWindowMaterial {
  if (isSystemTransparencyDisabled(value)) {
    return INERT_MATERIAL;
  }

  const eligibilityTest = eligibilityTests[mode];
  return eligibilityTest?.(value) ? (mode as ResolvedWindowMaterial) : INERT_MATERIAL;
}

// ---- 原生窗口的基础写入（失败仅告警，不中断编排） ----

async function paintWindowBackgroundSafely(color: Color): Promise<void> {
  try {
    await getCurrentWindow().setBackgroundColor(color);
  } catch (error) { // 实现
    console.warn('Failed to set window background color:', error);
  }
}

async function toggleWindowShadowSafely(enabled: boolean): Promise<void> {
  const hostWindow = getCurrentWindow();
  try {
    if (hostWindow.setShadow) {
      await hostWindow.setShadow(enabled);
    }
  } catch (error) { // 实现
    console.warn('Failed to set window shadow:', error);
  }
}

/**
 * 等待两个合成器帧：特效/底色变更需要跨越一整个合成周期才会稳定，
 * 连续两次 rAF（无 rAF 环境退化为 16ms 定时器）可确保时序可靠。
 */
function awaitNextCompositorFrame(): Promise<void> {
  const scheduleFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
  if (!scheduleFrame) {
    return new Promise((resolve) => { setTimeout(resolve, 16); });
  }

  return new Promise((resolve) => {
    scheduleFrame(() => {
      scheduleFrame(() => resolve());
    });
  });
}

/** 升起过渡遮罩：材质切换期间冻结根节点的 CSS 过渡 */
async function revealTransitionMask(): Promise<void> {
  transitionMaskVisible.value = true;
  await flushVueRenderPass();
  await awaitNextCompositorFrame();
}

/** 落下过渡遮罩：先再等一帧，确认合成器稳定后再恢复过渡 */
async function concealTransitionMask(): Promise<void> {
  await awaitNextCompositorFrame();
  transitionMaskVisible.value = false;
}

// ---- 能力探测 ----

/** 把原生层上报的能力快照补齐为完整结构（缺失字段取安全默认值） */
function adoptReportedCapabilities(reported?: Partial<WindowMaterialCapabilities> | null): WindowMaterialCapabilities {
  return {
    isWindows: reported?.isWindows ?? false,
    supportsAcrylic: reported?.supportsAcrylic ?? false,
    supportsMica: reported?.supportsMica ?? false,
    supportsBlur: reported?.supportsBlur ?? false,
    systemTransparencyEnabled: reported?.systemTransparencyEnabled ?? null,
    windowsBuildNumber: reported?.windowsBuildNumber ?? null,
  };
}

async function fetchAndStoreCapabilities(): Promise<WindowMaterialCapabilities> {
  try {
    const reported = await windowApi.getWindowMaterialCapabilities();
    const adopted = adoptReportedCapabilities(reported as TauriWindowMaterialCapabilities);
    capabilitySnapshot.value = adopted;
    capabilityQuerySettled.value = true;
    return adopted;
  } catch (error) { // 实现
    console.error('Failed to query window material capabilities:', error);
    const fallback = blankCapabilitySnapshot();
    capabilitySnapshot.value = fallback;
    capabilityQuerySettled.value = true;
    return fallback;
  } finally {
    capabilityQueryInFlight = null;
  }
}

/**
 * 拉取并缓存材质能力：成功/失败都视为「已探测」，后续调用直接命中
 * 缓存；并发调用共享同一次在途查询，force 时强制重探。
 */
export async function loadWindowMaterialCapabilities(force = false): Promise<WindowMaterialCapabilities> { // 实现
  if (capabilityQuerySettled.value && !force) {
    return capabilitySnapshot.value;
  }
  if (capabilityQueryInFlight && !force) {
    return capabilityQueryInFlight;
  }

  capabilityQueryInFlight = fetchAndStoreCapabilities();
  return capabilityQueryInFlight;
}

// ---- 材质下发 ----

export async function applyWindowMaterial(mode: WindowMaterialMode, isDark: boolean, blurTint = 50): Promise<ResolvedWindowMaterial> {
  const snapshot = await loadWindowMaterialCapabilities();
  const resolved = resolveWindowMaterial(mode, snapshot);
  const hostWindow = getCurrentWindow();

  try {
    if (resolved === 'mica') { // 实现
      await paintWindowBackgroundSafely(TRANSLUCENT_SURFACE_COLOR);
      await hostWindow.setEffects({ effects: [isDark ? NATIVE_MICA_EFFECT_BY_DARKNESS.dark : NATIVE_MICA_EFFECT_BY_DARKNESS.light] });
      await toggleWindowShadowSafely(true);
    } else if (resolved === 'acrylic') { // 实现
      await paintWindowBackgroundSafely(TRANSLUCENT_SURFACE_COLOR);
      await windowApi.setDarkModeForWindow(isDark); // 实现
      await hostWindow.setEffects({ effects: [Effect.Acrylic], color: buildAcrylicTint(isDark) });
      await toggleWindowShadowSafely(true);
    } else if (resolved === 'blur') { // 实现
      await paintWindowBackgroundSafely(TRANSLUCENT_SURFACE_COLOR);
      await windowApi.setDarkModeForWindow(isDark); // 实现
      await hostWindow.setEffects({ effects: [Effect.Blur], color: buildBlurTint(isDark, blurTint) });
      await toggleWindowShadowSafely(false);
    } else {
      const surfaceColor = buildOpaqueSurfaceColor(isDark);
      const previousMaterial = activeMaterialState.value;
      const needsTransitionMask = previousMaterial !== INERT_MATERIAL;

      // 退回 none：先用旧特效兜住底色过渡，再统一清干净特效
      if (previousMaterial === 'acrylic' || previousMaterial === 'blur') {
        const staleEffect = previousMaterial === 'acrylic' ? Effect.Acrylic : Effect.Blur;
        await hostWindow.setEffects({ effects: [staleEffect], color: surfaceColor });
        await awaitNextCompositorFrame();
        await paintWindowBackgroundSafely(surfaceColor);
      } else if (previousMaterial === 'mica') {
        await paintWindowBackgroundSafely(surfaceColor);
        await awaitNextCompositorFrame();
      }

      if (needsTransitionMask) {
        await revealTransitionMask();
      }

      const shouldSuppressTransitions = needsTransitionMask;
      if (shouldSuppressTransitions) {
        materialSwitching.value = true;
        await flushVueRenderPass();
      }

      try {
        activeMaterialState.value = INERT_MATERIAL;
        await flushVueRenderPass();
        await hostWindow.clearEffects();
        await toggleWindowShadowSafely(true);
        await awaitNextCompositorFrame();
      } finally {
        if (shouldSuppressTransitions) {
          materialSwitching.value = false;
        }
        if (needsTransitionMask) {
          await concealTransitionMask();
        }
      }
    }

    activeMaterialState.value = resolved;
  } catch (error) { // 实现
    console.error('Failed to apply window material:', error); // 实现
    activeMaterialState.value = INERT_MATERIAL;
  }

  return activeMaterialState.value;
}

// ---- 合成器级重建 ----

type EffectDisposer = () => Promise<unknown>;
type RepaintWaiter = () => Promise<unknown>;
type MaterialApplier = (mode: WindowMaterialMode, isDark: boolean, blurTint: number) => Promise<ResolvedWindowMaterial>;

/** 重建流程的可注入依赖（测试与特殊窗口可替换默认实现） */
interface RebuildWindowMaterialDeps { // 实现
  clearEffects?: EffectDisposer;
  waitForRepaint?: RepaintWaiter;
  applyMaterial?: MaterialApplier;
}

/**
 * 合成器级重建：先升起过渡遮罩并清空现有特效，等一帧确认清空
 * 生效后，再整体重铺目标材质。mode 为 none 时退化为普通应用。
 */
export async function rebuildWindowMaterialForCompositor(mode: WindowMaterialMode, isDark: boolean, blurTint = 50, deps?: Partial<RebuildWindowMaterialDeps>): Promise<ResolvedWindowMaterial> {
  const disposeNativeEffects = deps?.clearEffects ?? (async () => getCurrentWindow().clearEffects());
  const awaitReportedRepaint = deps?.waitForRepaint ?? awaitNextCompositorFrame;
  const pushTargetMaterial = deps?.applyMaterial ?? applyWindowMaterial;

  if (mode === INERT_MATERIAL) {
    return pushTargetMaterial(mode, isDark, blurTint);
  }

  try {
    await revealTransitionMask();
    materialSwitching.value = true;
    await flushVueRenderPass();
    await disposeNativeEffects();
    activeMaterialState.value = INERT_MATERIAL;
    await awaitReportedRepaint();
  } catch (error) { // 实现
    console.warn('Failed to rebuild window material compositor:', error); // 实现
  }

  try {
    return await pushTargetMaterial(mode, isDark, blurTint);
  } finally {
    await flushVueRenderPass();
    await awaitNextCompositorFrame();
    materialSwitching.value = false;
    await concealTransitionMask();
  }
}

/** 供各窗口组件读取材质状态 / 复用编排逻辑的组合入口 */
export function useWindowMaterial() { // 实现
  const queryCapabilities = loadWindowMaterialCapabilities;
  const pushMaterial = applyWindowMaterial;
  const rebuildMaterial = rebuildWindowMaterialForCompositor;

  return {
    capabilities: capabilitySnapshot,
    activeWindowMaterial: activeMaterialState,
    isWindowMaterialReady: capabilityQuerySettled,
    materialTransitionMaskVisible: transitionMaskVisible,
    materialSwitching,
    loadWindowMaterialCapabilities: queryCapabilities,
    applyWindowMaterial: pushMaterial,
    rebuildWindowMaterialForCompositor: rebuildMaterial,
  };
}
