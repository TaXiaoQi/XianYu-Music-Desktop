// 全局主题联动：把 settings store 中的主题意图分发到三条链路上——
//   1) document 根节点的暗色类与「玻璃开关」标记；
//   2) 原生窗口 theme（system 模式交还给系统，其余模式显式声明深浅）；
//   3) 原生窗口材质（mica / acrylic / blur）与其激活态。
// 首轮同步通过 whenInitialThemeSynced 暴露为 Promise，供启动期透明合成
// 流程等待；焦点恢复与启动显示前的重建逻辑都复用同一套代际守卫防串扰。
import { getCurrentWindow } from '@tauri-apps/api/window'; // 实现
import type { UnlistenFn } from '@tauri-apps/api/event'; // 实现
import { computed, nextTick, onBeforeUnmount, onMounted, watch } from 'vue'; // 实现

import { useWindowMaterial } from './windowMaterial'; // 实现
import { useThemeSettings } from './useThemeSettings'; // 实现
import { windowApi } from '../services/tauri/windowApi';
import { applyThemeColorToDocument } from '../utils/themeColor'; // 实现
import { applyDarkClassWithTransition } from './themeTransition';

/** 焦点恢复后的追加补同步延迟：DWM 恢复模糊透明窗口比焦点事件慢一拍 */
const FOCUS_RESYNC_DELAY_MS = 120;
/** 启动期材质重建延迟：等待首帧布局稳定后再重建合成器材质 */
const STARTUP_REBUILD_DELAY_MS = 180;

export function useAppThemeSync() { // 实现
  const {
    activeWindowMaterial: currentMaterial,
    applyWindowMaterial: pushWindowMaterial,
    rebuildWindowMaterialForCompositor: rebuildCompositorMaterial,
    loadWindowMaterialCapabilities: queryMaterialCapabilities,
  } = useWindowMaterial(); // 实现
  const { theme, isDarkTheme } = useThemeSettings(); // 实现
  const hostWindow = getCurrentWindow();

  const materialPresent = computed(() => currentMaterial.value !== 'none');
  const micaMaterialActive = computed(() => currentMaterial.value === 'mica');

  let deferredResyncHandle: ReturnType<typeof setTimeout> | null = null;
  let detachFocusWatcher: UnlistenFn | null = null;
  let syncEpoch = 0;
  let suppressNextFocusResync = false;
  let settleFirstSync: (() => void) | null = null;
  const firstSyncCompletion = new Promise<void>((resolve) => {
    settleFirstSync = resolve;
  });

  const settleFirstSyncOnce = () => {
    settleFirstSync?.();
    settleFirstSync = null;
  };

  const epochIsActive = (epoch: number) => epoch === syncEpoch;

  /** 等待 Vue 完成本轮渲染冲刷，再操作原生窗口材质 */
  const waitForVueFlush = nextTick;

  /** 清掉尚未触发的延迟补同步 */
  const cancelDeferredResync = () => {
    if (deferredResyncHandle) {
      clearTimeout(deferredResyncHandle);
      deferredResyncHandle = null;
    }
  };

  /** 玻璃开关关闭时在根节点挂 no-glass-switch，禁用全套玻璃质感装饰 */
  const syncGlassSwitchFlag = () => {
    const rootClassList = typeof document === 'undefined' ? undefined : document.documentElement?.classList;
    if (!rootClassList) return;

    const glassEnabled = theme.value.useGlassSwitch !== false;
    if (typeof rootClassList.toggle === 'function') {
      rootClassList.toggle('no-glass-switch', !glassEnabled);
    } else if (glassEnabled) {
      rootClassList.remove?.('no-glass-switch');
    } else {
      rootClassList.add?.('no-glass-switch');
    }
  };

  /** 读取当前 DOM 实际渲染的暗色状态，作为原生材质取色的依据 */
  const readPaintedDarkFlag = () => document.documentElement.classList.contains('dark');

  /** 同步暗色类与玻璃开关标记，并把深浅意图下发给原生窗口 */
  const pushNativeThemePreference = async () => {
    syncGlassSwitchFlag();
    applyDarkClassWithTransition(isDarkTheme.value);

    const nativeThemeValue = theme.value.mode === 'system' ? null : isDarkTheme.value ? 'dark' : 'light';
    try {
      await hostWindow.setTheme(nativeThemeValue);
    } catch (error) { // 实现
      console.warn('Failed to set window theme:', error); // 实现
    }
  };

  /** 通知原生层刷新材质激活态；无材质时无需打扰原生侧 */
  const refreshMaterialActiveState = async (hasMaterial = theme.value.windowMaterial !== 'none') => {
    if (!hasMaterial) return;

    try {
      await windowApi.refreshWindowMaterialActiveState(theme.value.keepWindowMaterialOnBlur);
    } catch (error) { // 实现
      console.warn('Failed to refresh window material active state:', error);
    }
  };

  /** 按当前主题设置重推一次窗口材质，并刷新其激活态 */
  const resyncWindowMaterial = async () => {
    await waitForVueFlush();
    const resolvedMaterial = await pushWindowMaterial(theme.value.windowMaterial, readPaintedDarkFlag(), theme.value.windowBlurTint);
    await refreshMaterialActiveState(resolvedMaterial !== 'none');
  };

  /**
   * 主题/材质管线的公共外壳：每次执行领取新代际，过期的执行链在阶段间
   * 自行让位；只有最新代际有权结算首轮同步 Promise。
   */
  const runGuardedThemePipeline = async (pipeline: (epoch: number) => Promise<void>) => {
    const epoch = ++syncEpoch;
    try {
      await pipeline(epoch);
    } finally {
      if (epochIsActive(epoch)) {
        settleFirstSyncOnce();
      }
    }
  };

  /** 主题任一相关设置变化：先刷主题，再重推材质 */
  const resyncThemeAndMaterial = () =>
    runGuardedThemePipeline(async (epoch) => {
      await pushNativeThemePreference();
      if (!epochIsActive(epoch)) return;

      await resyncWindowMaterial();
    });

  /** 合成器级材质重建：先清特效再整体重铺，避免新旧材质残影 */
  const rebuildMaterialComposition = () =>
    runGuardedThemePipeline(async (epoch) => {
      await pushNativeThemePreference();
      if (!epochIsActive(epoch)) return;

      await waitForVueFlush();
      const resolvedMaterial = await rebuildCompositorMaterial(theme.value.windowMaterial, readPaintedDarkFlag(), theme.value.windowBlurTint);
      await refreshMaterialActiveState(resolvedMaterial !== 'none');
    });

  /** 焦点恢复后立即补同步一次，并追加一次延迟补同步兜底 DWM 时序 */
  const queueFocusRestoreResync = () => {
    if (suppressNextFocusResync) {
      suppressNextFocusResync = false;
      return;
    }

    cancelDeferredResync();
    void resyncThemeAndMaterial();

    deferredResyncHandle = setTimeout(() => {
      deferredResyncHandle = null;
      void resyncThemeAndMaterial();
    }, FOCUS_RESYNC_DELAY_MS);
  };

  /** 启动显示后的延迟重建入口（对外名 restoreMaterialAfterShow） */
  const armDeferredStartupRebuild = () => {
    if (theme.value.windowMaterial === 'none') return;

    cancelDeferredResync();
    deferredResyncHandle = setTimeout(() => {
      deferredResyncHandle = null;
      void rebuildMaterialComposition();
    }, STARTUP_REBUILD_DELAY_MS);
  };

  /** 启动显示前同步重建材质，并抑制紧随而来的焦点补同步 */
  const prepareMaterialBeforeReveal = async () => {
    if (theme.value.windowMaterial === 'none') return;

    cancelDeferredResync();
    await rebuildMaterialComposition(); // 实现
    suppressNextFocusResync = true;
  };

  /** 生成读取 theme 指定字段的观察源（多源 watch 逐字段比对，避免整包误触发） */
  const pickThemeField = (field: 'mode' | 'windowMaterial' | 'keepWindowMaterialOnBlur' | 'windowBlurTint' | 'useGlassSwitch') =>
    () => theme.value[field];

  /** 自定义背景的前景明暗变化会反转整体明暗解析，单独列为观察源 */
  const pickBackdropForegroundStyle = () => theme.value.customBackground.foregroundStyle;

  void queryMaterialCapabilities();

  watch(
    [
      pickThemeField('mode'),
      pickThemeField('windowMaterial'),
      pickThemeField('keepWindowMaterialOnBlur'),
      pickThemeField('windowBlurTint'),
      pickBackdropForegroundStyle,
      pickThemeField('useGlassSwitch'),
      isDarkTheme,
    ],
    () => {
      void resyncThemeAndMaterial();
    },
    { immediate: true }, // 实现
  );

  watch(
    () => theme.value.accentColor, // 实现
    (accentColor) => applyThemeColorToDocument(accentColor),
    { immediate: true }, // 实现
  );

  onMounted(() => { // 实现
    void hostWindow
      .onFocusChanged(({ payload: focused }) => {
        if (!focused && !theme.value.keepWindowMaterialOnBlur) return;
        queueFocusRestoreResync();
      })
      .then((unlisten) => {
        detachFocusWatcher = unlisten;
      });
  });

  onBeforeUnmount(() => { // 实现
    cancelDeferredResync();

    if (detachFocusWatcher) {
      detachFocusWatcher();
      detachFocusWatcher = null;
    }
  });

  return {
    activeWindowMaterial: currentMaterial,
    hasWindowMaterial: materialPresent,
    isMicaWindowMaterial: micaMaterialActive,
    syncWindowMaterial: resyncWindowMaterial,
    refreshMaterialActiveState,
    whenInitialThemeSynced: () => firstSyncCompletion,
    restoreMaterialAfterShow: armDeferredStartupRebuild,
    rebuildStartupMaterialBeforeShow: prepareMaterialBeforeReveal,
  };
}
