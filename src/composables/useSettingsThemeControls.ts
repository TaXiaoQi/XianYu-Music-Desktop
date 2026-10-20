// 设置页主题控制中枢：把主题模式、窗口材质、动态背景、播放详情外观等
// 控件装配成统一的读写接口。字段绑定与数值收拢的实现见 ./themeControlBindings。
import { ref, computed, onMounted } from 'vue';

import { useUiStore } from '../shared/stores/ui';
import type { ThemeSettings, VinylPlatterStyle, VinylPlinthMaterial } from '../types';
import { DEFAULT_THEME_COLOR, normalizeThemeColor } from '../utils/themeColor';
import {
  createThemeFieldBinding,
  submitPercentThemeField,
  type ThemePatchSink,
  type ThemeSnapshotReader,
} from './themeControlBindings';
import { useThemeSettings as withThemeSettingsStore } from './useThemeSettings';
import { type WindowMaterialMode, useWindowMaterial } from './windowMaterial';

/** 用户可直接点选的窗口材质档位；none 由「关闭材质」语义独占 */
type PickableMaterialMode = Exclude<WindowMaterialMode, 'none'>;
/** 材质控件不可用的原因标签；null 表示当前可用 */
type MaterialBlockerKind = 'windows' | 'windows11' | 'transparency' | 'theme-conflict' | null;

export function useSettingsThemeControls() {
  const themeControls = withThemeSettingsStore();
  const {
    theme,
    patchTheme: submitThemePatch,
    setThemeMode: applyThemeMode,
    setDynamicBackgroundType: applyDynamicBgType,
    setWindowMaterial: applyMaterialSetting,
  } = themeControls;
  const {
    capabilities,
    loadWindowMaterialCapabilities: probeMaterialCapabilities,
  } = useWindowMaterial();
  const uiStore = useUiStore();

  const readTheme: ThemeSnapshotReader = () => theme.value;
  const writeThemePatch: ThemePatchSink = (patch) => submitThemePatch(patch);

  // —— 弹窗与微调面板的可见性 ——
  const showCustomModal = computed({
    get: () => uiStore.showCustomSkinModal,
    set: (visible: boolean) => { uiStore.showCustomSkinModal = visible; },
  });
  const showFlowTuning = ref(false);
  const blurTuningPanelVisible = ref(false);

  // —— theme 单字段绑定：读快照、写单键补丁 ——
  const bindThemeField = <K extends Exclude<keyof ThemeSettings, 'customBackground'>>(
    key: K,
    absentValue?: ThemeSettings[K],
  ) => createThemeFieldBinding(readTheme, writeThemePatch, { key, absentValue });

  const keepWindowMaterialOnBlur = bindThemeField('keepWindowMaterialOnBlur');
  const useCustomTrayMenu = bindThemeField('useCustomTrayMenu');
  const useGlassSwitch = bindThemeField('useGlassSwitch', false);
  const showLeaderboard = bindThemeField('showLeaderboard');
  const playerDetailCoverBehavior = bindThemeField('playerDetailCoverBehavior');
  const playerDetailStyle = bindThemeField('playerDetailStyle');
  const playerDetailMeshBackground = bindThemeField('playerDetailMeshBackground');
  const playerDetailMeshAntiAlias = bindThemeField('playerDetailMeshAntiAlias');
  const playerDetailVinylMaterial = bindThemeField('playerDetailVinylMaterial');
  const playerDetailVinylPlatterStyle = bindThemeField('playerDetailVinylPlatterStyle');

  // 主题模式走专用提交通道：system 需刷新系统探测，custom 需联动关停特效。
  const colorScheme = computed<ThemeSettings['mode']>({
    get: () => readTheme().mode,
    set: (nextMode) => {
      applyThemeMode(nextMode);
    },
  });

  // 窗口材质同理：启用任何材质档位都会顺带关闭动态背景。
  const materialMode = computed<WindowMaterialMode>({
    get: () => readTheme().windowMaterial,
    set: (nextMaterial: WindowMaterialMode) => {
      applyMaterialSetting(nextMaterial);
    },
  });

  // —— 可用性判定链：平台门槛 → 全局阻断（系统透明度 / 主题冲突）→ 档位门禁 ——
  const isWindows11 = computed(() => {
    const caps = capabilities.value;
    return caps.isWindows && (caps.windowsBuildNumber ?? 0) >= 22000;
  });

  const hasWindowMaterialSelected = computed(() => readTheme().windowMaterial !== 'none');

  const themeBlocksMaterial = computed(
    () => colorScheme.value === 'custom' || readTheme().dynamicBgType !== 'none',
  );

  // 全局阻断只看环境：系统透明度被关闭，或自定义皮肤 / 动态背景仍占用着表面。
  const globalMaterialBlocker = computed<Exclude<MaterialBlockerKind, 'windows' | 'windows11'>>(() => (
    capabilities.value.systemTransparencyEnabled === false
      ? 'transparency'
      : themeBlocksMaterial.value
        ? 'theme-conflict'
        : null
  ));

  const windowMaterialDisabledReason = computed<MaterialBlockerKind>(() => {
    if (globalMaterialBlocker.value) {
      return globalMaterialBlocker.value;
    }
    return capabilities.value.isWindows ? null : 'windows';
  });

  const isWindowMaterialDisabled = computed(() => Boolean(windowMaterialDisabledReason.value));

  const isDynamicBgDisabled = computed(() => colorScheme.value === 'custom' || hasWindowMaterialSelected.value);

  // 单个材质档位的平台门禁：mica/acrylic 仅 Win11，blur 依赖 Windows 模糊支持。
  const materialModeBlocker = (mode: PickableMaterialMode): MaterialBlockerKind => {
    const requiresWindows11 = mode === 'mica' || mode === 'acrylic';
    const requiresWindowsBlur = mode === 'blur';
    const missingPlatformSupport = (requiresWindows11 && !isWindows11.value)
      || (requiresWindowsBlur && (!capabilities.value.isWindows || !capabilities.value.supportsBlur));

    if (missingPlatformSupport) {
      return requiresWindows11 ? 'windows11' : 'windows';
    }

    return globalMaterialBlocker.value;
  };

  const getWindowMaterialModeDisabledReason = (mode: PickableMaterialMode): MaterialBlockerKind =>
    materialModeBlocker(mode);

  const isWindowMaterialModeDisabled = (mode: PickableMaterialMode) =>
    materialModeBlocker(mode) !== null;

  const isWindowMaterialButtonDisabled = (mode: PickableMaterialMode) =>
    materialMode.value !== mode && materialModeBlocker(mode) !== null;

  // —— 动作入口 ——
  const setColorScheme = (mode: 'light' | 'dark' | 'custom' | 'system') => {
    colorScheme.value = mode;
  };

  const setAccentColor = (value: string) => {
    submitThemePatch({ accentColor: normalizeThemeColor(value, theme.value.accentColor) });
  };

  const resetAccentColor = () => {
    submitThemePatch({ accentColor: DEFAULT_THEME_COLOR });
  };

  const setDynamicType = (dynamicKind: 'none' | 'flow' | 'blur') => {
    if (isDynamicBgDisabled.value) return;

    applyDynamicBgType(dynamicKind);
    // 非流光模式用不到微调面板，顺手收起。
    if (dynamicKind !== 'flow') {
      showFlowTuning.value = false;
    }
  };

  // 点击材质档位：同档位再点一次视为关闭；切档时收起毛玻璃微调面板。
  const toggleWindowMaterial = (mode: PickableMaterialMode) => {
    const isSelected = materialMode.value === mode;

    if (isSelected) {
      applyMaterialSetting('none');
      if (mode === 'blur') { blurTuningPanelVisible.value = false; }
      return;
    }

    if (isWindowMaterialModeDisabled(mode)) return;

    applyMaterialSetting(mode);
    if (mode !== 'blur') { blurTuningPanelVisible.value = false; }
  };

  const openCustomModal = () => { showCustomModal.value = true; };

  const toggleFlowTuning = () => {
    if (isDynamicBgDisabled.value) return;

    const flowAlreadyActive = readTheme().dynamicBgType === 'flow';
    if (!flowAlreadyActive) {
      applyDynamicBgType('flow');
    }

    showFlowTuning.value = flowAlreadyActive ? !showFlowTuning.value : true;
  };

  const toggleBlurPanel = () => {
    const blurAlreadyActive = materialMode.value === 'blur';

    if (!blurAlreadyActive) {
      if (isWindowMaterialModeDisabled('blur')) return;
      applyMaterialSetting('blur');
    }

    blurTuningPanelVisible.value = blurAlreadyActive ? !blurTuningPanelVisible.value : true;
  };

  // —— 数值滑杆：统一收拢为 0-100 整数后写入 ——
  const setFlowColorBoost = (value: number) => submitPercentThemeField(writeThemePatch, 'flowColorBoost', value);
  const setFlowDepth = (value: number) => submitPercentThemeField(writeThemePatch, 'flowDepth', value);
  const setFlowSpeed = (value: number) => submitPercentThemeField(writeThemePatch, 'flowSpeed', value);
  const setFlowTexture = (value: number) => submitPercentThemeField(writeThemePatch, 'flowTexture', value);
  const setWindowBlurTint = (value: number) => submitPercentThemeField(writeThemePatch, 'windowBlurTint', value);

  // —— 布尔 / 枚举开关的命令式 setter ——
  const setKeepWindowMaterialOnBlur = (value: boolean) => { keepWindowMaterialOnBlur.value = value; };
  const setUseCustomTrayMenu = (value: boolean) => { useCustomTrayMenu.value = value; };
  const setUseGlassSwitch = (value: boolean) => { useGlassSwitch.value = value; };
  const setShowLeaderboard = (value: boolean) => { showLeaderboard.value = value; };
  const setPlayerDetailCoverBehavior = (value: 'show' | 'hide' | 'remember') => { playerDetailCoverBehavior.value = value; };
  const setPlayerDetailStyle = (value: 'classic' | 'vinyl') => { playerDetailStyle.value = value; };
  const setPlayerDetailMeshBackground = (value: boolean) => { playerDetailMeshBackground.value = value; };
  const setPlayerDetailMeshAntiAlias = (value: boolean) => { playerDetailMeshAntiAlias.value = value; };
  const setPlayerDetailVinylMaterial = (value: VinylPlinthMaterial) => { playerDetailVinylMaterial.value = value; };
  const setPlayerDetailVinylPlatterStyle = (value: VinylPlatterStyle) => { playerDetailVinylPlatterStyle.value = value; };

  onMounted(() => void probeMaterialCapabilities());

  return {
    theme,
    showCustomModal,
    colorScheme, materialMode,
    keepWindowMaterialOnBlur, useCustomTrayMenu, useGlassSwitch,
    showLeaderboard,
    playerDetailCoverBehavior, playerDetailStyle, playerDetailVinylMaterial, playerDetailVinylPlatterStyle,
    playerDetailMeshBackground, playerDetailMeshAntiAlias,
    isWindows11, hasWindowMaterialSelected,
    isWindowMaterialDisabled, isWindowMaterialButtonDisabled,
    getWindowMaterialModeDisabledReason, windowMaterialDisabledReason,
    isDynamicBgDisabled,
    showFlowTuning, showBlurTuning: blurTuningPanelVisible,
    setColorScheme, setAccentColor, resetAccentColor, setDynamicType, setUseGlassSwitch,
    toggleWindowMaterial, openCustomModal, toggleFlowTuning, toggleBlurTuning: toggleBlurPanel,
    setFlowColorBoost, setFlowDepth, setFlowSpeed, setFlowTexture, setWindowBlurTint,
    setKeepWindowMaterialOnBlur, setUseCustomTrayMenu, setShowLeaderboard,
    setPlayerDetailCoverBehavior, setPlayerDetailStyle,
    setPlayerDetailMeshBackground, setPlayerDetailMeshAntiAlias, setPlayerDetailVinylMaterial,
    setPlayerDetailVinylPlatterStyle,
  };
}
